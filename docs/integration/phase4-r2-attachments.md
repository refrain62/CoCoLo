# Phase 4 R2添付機能の統合契約

この文書は、FS-FIL-001とFS-FIL-002を実装した機能境界と、中央アプリケーションへ接続する条件を記録します。

## 実装範囲

添付ファイルは、チーム専用の非公開ストレージへ直接送信します。

APIは開始時に認証済みの所属からテナントと所有者を決め、利用者が送信した所有者IDやテナントIDを受け付けません。

許可するMIMEは`image/jpeg`、`image/png`、`application/pdf`です。

最大サイズは20 MiB、アップロードセッションの有効期間は900秒、完了検証の再試行回数は同一セッションあたり3回です。

SVGはMIMEを偽装しても、許可MIMEの一覧とマジックバイト検証の両方で拒否します。

## モジュール境界

| 境界 | 実装 | 責務 |
| --- | --- | --- |
| 契約 | `packages/contracts/src/upload-contract.mjs` | MIME、サイズ、SHA-256、UUIDの入力制約 |
| ドメイン | `packages/domain/src/attachment-domain.ts` | マジックバイト、実体サイズ、SHA-256、UUIDv7の検証 |
| API | `apps/api/src/features/attachments/attachment-app.ts` | 認証、所属、所有者、署名URL、状態遷移、cleanup |
| ストレージ | `apps/api/src/features/attachments/attachment-storage.ts` | R2に依存しない署名、読み取り、削除のadapter契約 |
| R2 adapter | `apps/api/src/features/attachments/r2-attachment-storage.ts` | Cloudflare固有のSDKをAPIから隔離する委譲境界 |
| local adapter | `apps/api/src/features/attachments/fake-attachment-storage.ts` | 期限、PUT、上書き禁止、読み取り、削除のローカル再現 |
| DB repository | `packages/db/src/attachment-repository.ts` | RLS context、所属再確認、行ロック、状態遷移、監査 |
| Web | `apps/web/src/features/attachments/attachment-uploader.tsx` | 署名URLへの直接PUTとAPIのcomplete呼び出し |

## API契約

API routerはPR #102で中央`apps/api/src/app.ts`へmount済みです。

中央認証から選択中tenantと利用者を解決し、同じDB repository、R2 adapter、認証済みrate limit、response契約へ接続しています。R2 endpoint、bucket、access key、secretはstaging / production WorkflowからAPI起動経路へ渡します。

Web画面も中央`apps/web/src/main.tsx`を変更できる統合段階で、現在の認証sessionから作った`AttachmentApi`を`AttachmentUploader`へ渡して表示します。

### アップロード開始

`POST /api/v1/uploads`へ次のJSONを送信します。

```json
{
  "mediaType": "image/png",
  "byteSize": 1024
}
```

レスポンスには`attachmentId`、短期の`uploadUrl`、`expiresAt`、`maxBytes`、`mediaType`を返します。

`ownerUserId`と`tenantId`は入力にもレスポンスにも含めません。

### 直接PUT

Webは`uploadUrl`へ`Content-Type`を付けて一度だけPUTします。

このPUTへAPIのBearer tokenを転送しません。

署名URLの期限は900秒を超えないことをAPIが確認します。

ストレージadapterは既存オブジェクトの上書きを拒否する署名条件を設定します。

### 完了検証

`POST /api/v1/uploads/{id}/complete`へ`sha256`と`byteSize`を送信します。

APIはDBに保存したMIME、サイズ、所有者、テナント、期限を使い、ストレージから読み取った実体を検証します。

検証成功時だけ`available`とし、検証失敗時は`rejected`として保存本体の削除を試みます。

ストレージが未反映または読み取り障害の場合、3回までは`uploaded`のまま再試行できます。

3回目でも検証できなければ`rejected`へ遷移します。

### ダウンロード

`GET /api/v1/uploads/{id}/download`は、DBで`available`かつ認可済みの添付だけに短期ダウンロードURLを発行します。

公開URL、R2管理画面URL、R2秘密情報、オブジェクトキーは返しません。

ダウンロードURLの有効期間は300秒以下です。

### cleanup

検証失敗後の削除に失敗した場合、`POST /api/v1/uploads/{id}/cleanup`で同じ削除を再試行できます。

完了操作を呼ばないまま900秒を過ぎたセッションは、`POST /api/v1/uploads/cleanup-expired`で管理者または運用ジョブが最大100件ずつ拒否して削除します。

削除失敗は`cleanup_completed_at`を設定せず、次回のcleanup対象として残します。

## DBとRLS

添付テーブルは`packages/db/prisma/migrations/20260822130000_phase4_attachments/migration.sql`で作成します。

この担当では、並行作業の競合を避けるためPrisma schemaと共有indexを変更していません。

そのためrepositoryはPrismaのモデルAPIではなく、添付テーブルへraw SQLでアクセスします。

将来Prisma modelへ移行する場合も、RLS policy、状態遷移trigger、`cleanup_completed_at`の意味を維持してから切り替えます。

DBは`uploaded → available`、`uploaded → rejected`だけを許可します。

完了検証は添付行を`FOR UPDATE`でロックし、同じセッションの同時completeを直列化します。

所属確認はSELECT専用のRLS policyと競合しないようSELECTで行い、添付行だけを更新ロックします。

## 外部R2への接続条件

本番adapterは、次の4操作をCloudflare R2へ接続します。

- `signUpload`：オブジェクトキー、MIME、サイズ、期限を署名条件へ反映します。
- `read`：オブジェクト本体と保存MIMEを返します。
- `signDownload`：`available`のオブジェクトだけへ短期URLを発行します。
- `remove`：検証失敗、期限切れ、cleanup再試行のオブジェクトを削除します。

R2バケットは環境ごとに分離し、公開アクセスを無効にします。

CORSは環境ごとの公開Web URLだけに限定し、PUTと必要なヘッダーだけを許可します。

R2秘密鍵はAPIのSecretへ投入し、WebのVite環境変数、ログ、artifact、監査metadataへ出力しません。

## 検証コマンド

依存関係はNode.js 24とpnpmを使ってlockfileどおりにインストールします。

```text
pnpm install --frozen-lockfile
pnpm generate:openapi
pnpm test:unit
pnpm test:integration
pnpm typecheck
pnpm build
pnpm lint:biome
```

実DB検証では、PostgreSQL 17の専用DBへ全migrationを適用し、`cocolo_app` roleでRLS統合テストを実行します。

stagingではR2の実バケットを使い、別テナント拒否、署名URL期限、実体検証、cleanup再試行、認可済みダウンロードをE2Eで確認します。
