# Phase 4 FS-ANN-001 回覧板・既読管理の統合手順

更新日: 2026-08-22

## 1. 対象と正本

本書はFS-ANN-001「回覧板・既読管理」の中央登録手順です。

機能仕様の正本は[`docs/functional-specification.md`](../functional-specification.md)です。

実装計画の正本は[`docs/implementation-plan.md`](../implementation-plan.md)です。

このfeatureは回覧の掲載、本文と添付メタデータの参照、ユーザー単位の既読記録、掲載者だけの未読者一覧を提供します。

## 2. featureの構成

中央登録点を変更せず、次のfeature固有ファイルへ実装を閉じ込めています。

| 層 | ファイル | 役割 |
| --- | --- | --- |
| Contract | `packages/contracts/src/bulletin-board-contract.ts` | 本文、添付ID、ページングの入力制約 |
| Domain | `packages/domain/src/bulletin-board-domain.ts` | 掲載権限、掲載者判定、公開状態の規則 |
| DB adapter | `packages/db/src/bulletin-board-repository.ts` | raw SQL、RLS context、transaction、監査 |
| API | `apps/api/src/features/bulletin-board/bulletin-board-app.ts` | 認証、active membership、認可、DTO投影 |
| Web | `apps/web/src/features/bulletin-board/bulletin-board-page.tsx` | 一覧、詳細、既読、掲載、未読者表示 |
| DB migration | `packages/db/prisma/migrations/20260822140000_phase4_bulletin_board/migration.sql` | テーブル、複合キー、RLS、状態guard |

次の中央登録点は本featureでは変更していません。

- `apps/api/src/app.ts`
- `apps/web/src/main.tsx`
- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/index.ts`

## 3. 中央APIへの接続

統合担当は最新`origin/develop`上でfeatureのAPI appへ依存を注入します。

```ts
import { createBulletinBoardApp } from './features/bulletin-board/bulletin-board-app.js';
import { createBulletinBoardRepositories } from '@cocolo/db/bulletin-board';

const { bulletinBoardRepository } = createBulletinBoardRepositories(
  prisma,
  { attachmentLookup: attachmentLookupAdapter },
);
const bulletinBoardApp = createBulletinBoardApp({
  verifyToken,
  membershipRepository,
  bulletinBoardRepository,
});
app.route('/', bulletinBoardApp);
```

中央`app.ts`がすでにrequest IDや認証を提供する場合でも、feature appの認証middlewareを省略しないでください。

feature appを中央appへmountした後は、同じリクエストで二重に異なるtenantを解決しないことを確認してください。

Webは`BulletinBoardPage`へ中央のrole解決結果を渡します。

`owner`、`admin`、`staff`だけに掲載フォームを表示しますが、最終的な認可はAPIとDBで再確認します。

`guardian`には掲載フォームを表示せず、一覧、詳細、既読操作だけを提供します。

## 4. API契約

すべてのエンドポイントは`Authorization: Bearer <Supabase JWT>`とactive membershipを要求します。

| Method | Path | 許可 | 概要 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/announcements` | active membership | 公開済み回覧の一覧と自分の既読状態 |
| `POST` | `/api/v1/announcements` | owner/admin/staff | 回覧を掲載 |
| `GET` | `/api/v1/announcements/:announcementId` | active membership | 本文と添付メタデータを取得 |
| `POST` | `/api/v1/announcements/:announcementId/read` | active membership | 初回既読時刻を記録 |
| `GET` | `/api/v1/announcements/:announcementId/unread` | 掲載者本人 | active membershipの未読者一覧 |

掲載入力は`title`、`body`、`attachmentIds`だけを受け付けます。

`title`は1文字以上200文字以下です。

`body`は1文字以上20000文字以下です。

`attachmentIds`はUUIDを最大10件まで受け付け、同じIDの重複を拒否します。

`tenantId`、`authorUserId`、`publishedAt`、`readAt`はリクエスト本文から受け付けません。

存在しない回覧、別テナントの回覧、掲載者でない利用者の未読一覧は`404 ANNOUNCEMENT_NOT_FOUND`へ収束します。

存在しない添付、別テナントの添付、availableでない添付は`404 ATTACHMENT_NOT_FOUND`へ収束します。

この収束により、添付IDや回覧IDの存在をレスポンス差分から推測できません。

## 5. レスポンスと個人情報

回覧DTOは`tenantId`と`authorUserId`を返しません。

添付DTOは`id`、`mediaType`、`byteSize`だけを返します。

R2の`objectKey`、公開URL、署名URL、SHA-256は回覧APIから返しません。

添付のダウンロードURL発行はFS-FIL-001/002の添付機能へ委譲します。

未読者一覧は掲載者本人に限って取得でき、返却する個人識別子はAuthのopaqueな`userId`とroleだけです。

メールアドレス、氏名、JWT全文、添付の内部キーは未読者一覧へ含めません。

未読者一覧の公開範囲を将来広げる場合は、表示名の取得元と個人情報の開示承認を別途設計してください。

## 6. DBとRLSの不変条件

migrationは次の3テーブルを追加します。

- `announcements`
- `announcement_attachments`
- `announcement_reads`

すべてのテーブルに`tenant_id`を持たせています。

回覧と添付スナップショットの親子参照は`(tenant_id, announcement_id)`の複合外部キーです。

既読の主キーは`(tenant_id, announcement_id, user_id)`です。

添付本体を保持する`attachments`との外部キーは作成していません。

これはR2メタデータを将来別adapterまたは別DBへ分離しても、回覧本文と既読履歴を独立して移行できるようにするためです。

掲載transactionでは、先にactive membershipを再確認します。

次に添付adapterへ同じtransaction clientを渡し、同一tenantのavailable添付だけを検証します。

添付検証と回覧、添付メタデータのsnapshot、監査ログを一つのtransactionで確定します。

既読記録は複合主キーと`ON CONFLICT DO NOTHING`で冪等化しています。

再送時は初回`read_at`を返し、既読時刻を後から書き換えません。

RLSは、公開済み回覧の参照、管理三役による掲載、本人による既読挿入、掲載者による未読一覧の内部参照をそれぞれ分離しています。

未読一覧で全active membershipを読む必要があるため、transaction-localな`app.announcement_id`とsecurity definer関数で掲載者判定を行います。

security definer関数は`search_path`を`public`へ固定し、実行権限を`cocolo_app`へ限定しています。

## 7. 添付adapterの接続

既定の`attachmentLookup`は、R2添付migration後の`attachments`テーブルをraw SQLで参照します。

R2機能を別packageまたは別DBへ分離する場合は、`BulletinBoardAttachmentLookup`を実装して差し替えます。

adapterは次の入力を受け取ります。

```ts
{
  tenantId: string;
  attachmentIds: string[];
}
```

adapterは同じPrisma transaction clientを使い、同一tenantかつ`available`の添付だけを返します。

見つからないIDを返さず、要求件数と返却件数が一致しない場合はrepositoryが一律404にします。

adapterは`objectKey`、署名URL、秘密鍵を回覧repositoryへ返しません。

R2 migrationを先に適用できない環境では、分離先のattachment adapterを注入した上で回覧migrationを適用します。

## 8. migration適用順序

通常のPhase 4統合では、base migration、R2添付migration、回覧migrationの順に適用します。

回覧migration名は`20260822140000_phase4_bulletin_board`です。

アプリ実行時の`DATABASE_URL`は`cocolo_app`、`DIRECT_URL`はmigration ownerを設定します。

このリポジトリのPrisma CLIは`migrate deploy`時に`DATABASE_URL`をmigration接続先として読むため、migration jobでは`DATABASE_URL`と`DIRECT_URL`の両方をmigration ownerへ一時的に設定します。

アプリ実行用の環境変数をmigration jobへそのまま流用しないでください。

アプリ実行roleの`cocolo_app`へschema変更権限を付与しないでください。

```powershell
# API runtime
$env:DATABASE_URL = 'postgresql://cocolo_app:<password>@<host>:<port>/<database>'
$env:DIRECT_URL = 'postgresql://cocolo_migration:<password>@<host>:<port>/<database>'

# migration jobでは別プロセスまたは実行後に次の値へ切り替える
$env:DATABASE_URL = 'postgresql://cocolo_migration:<password>@<host>:<port>/<database>'
$env:DIRECT_URL = 'postgresql://cocolo_migration:<password>@<host>:<port>/<database>'
pnpm --filter @cocolo/db migrate:deploy
```

適用後に次のSQLをmigration ownerで確認します。

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename IN (
  'announcements',
  'announcement_attachments',
  'announcement_reads'
)
ORDER BY tablename;
```

3行すべての`rowsecurity`が`true`であることを確認します。

## 9. ローカル検証

通常の契約、ドメイン、API、Web検証は次で実行します。

```powershell
pnpm test
pnpm build
pnpm lint
pnpm typecheck
pnpm verify:migration-sql
```

Web API clientだけを確認する場合は次を実行します。

```powershell
pnpm exec vitest run apps/web/src/features/bulletin-board/bulletin-board-api.vitest.ts
```

実PostgreSQL統合テストは、回覧migrationを適用したDBで次の環境変数を設定して実行します。

```powershell
$env:BULLETIN_BOARD_DB_INTEGRATION = '1'
$env:DATABASE_URL = 'postgresql://cocolo_app:<password>@<host>:<port>/<database>'
$env:DIRECT_URL = 'postgresql://cocolo_migration:<password>@<host>:<port>/<database>'
pnpm --filter @cocolo/api test:integration
```

統合テストが未設定の環境では、feature専用DBテストをskipして既存のintegration suiteだけを実行します。

## 10. DB分離時の契約

分離対象は`announcements`、`announcement_attachments`、`announcement_reads`と添付metadata adapterの責務を分けて扱います。

Authのuser IDは外部識別子として文字列のまま移行し、Auth内部テーブルをアプリDBのdumpへ含めません。

移行時はtenant、回覧ID、既読主キー、掲載時刻、既読時刻、添付metadataの件数とchecksumを照合します。

回覧本文の移行先ではUTCの`published_at`と`read_at`を保持します。

旧DBの既読を書き換えず、新DBの複合キー重複は移行エラーとして停止します。

添付本体のR2移行成功だけで回覧移行成功とは判定せず、DB metadataとR2 objectの対応を別に照合します。

切り替え前にtenant A/B、掲載者以外の未読一覧、active membership停止、存在しない添付IDの同一404を再検証します。

## 11. 現時点の統合前提

このPRでは中央API appと中央Web画面へまだmountしていません。

このPRではR2実バケットへの接続と短期署名URL発行を実施していません。

掲載者のroleを中央Auth contextからWebへ渡す処理は統合担当の責務です。

回覧のarchive APIはFS-ANN-001の必須範囲外であり、DB側の状態guardだけを先に用意しています。
