# Phase 4 R2添付機能の敵対的レビュー

レビュー対象は、FS-FIL-001、FS-FIL-002に対応するR2添付機能の専用worktree差分です。

レビュー日：2026-08-22

## 判定

Critical：0件。

High：0件。

Medium：1件。

Low：0件。

Draft PR作成前に、CriticalとHighの指摘が残っていないことを確認しました。

## 確認項目

| 観点 | 確認結果 |
| --- | --- |
| テナント越境 | 認証済み所属からtenantを決め、DB RLSとrepositoryの検索条件で二重に制限している |
| 所有者境界 | 開始時の所有者をDBへ保存し、completeは同じ所有者だけに許可している |
| 権限 | owner、admin、staffだけに開始とcleanupを許可し、guardianは403にしている |
| 個人情報 | ファイル名を受け取らず、object keyとレスポンスへ利用者入力を含めていない |
| MIME | 契約の許可一覧、保存MIME、マジックバイトを一致させている |
| サイズ | 開始時の上限とcomplete時の実体サイズを両方検証している |
| SVG | SVGを許可一覧から除外し、MIME偽装もmagic bytesで拒否している |
| SHA-256 | サーバーが実体から再計算し、申告値と一致したときだけavailableにしている |
| 期限 | 900秒の開始セッション、300秒以下のダウンロードURL、放置セッションの一括cleanupを実装している |
| 再試行 | 読み取り障害は3回までuploadedで再試行し、3回目でrejectedにしている |
| 状態遷移 | DB triggerとrepositoryの行ロックでuploadedからavailableまたはrejectedだけを許可している |
| cleanup | 形式不正、期限切れ、3回超過で削除を試み、失敗時は再試行対象を残している |
| URL公開 | 公開URLを保存せず、認可後に短期URLだけを返している |
| 競合 | 完了処理は添付行をFOR UPDATEでロックし、二重completeを拒否している |
| 仕様整合 | OpenAPI、Zod契約、Web client、API responseの開始形式を一致させている |

## Mediumとして記録する残作業

Prisma schemaには添付modelをまだ追加していません。

この担当ではユーザー指定の「Prisma schemaを変更しない」制約を守るため、migrationのraw SQLとraw SQL repositoryで実装しました。

Prisma modelへ移行する場合は、RLS、trigger、状態遷移、cleanup列を同等に表現し、既存データとmigration checksumを確認してから行います。

中央`app.ts`と`main.tsx`へのmountもこの担当では行っていません。

これは共有ファイルを変更しない作業境界による統合待ちであり、mount前に本番機能として公開しないことを統合ドキュメントへ記録しました。

## テスト証拠

- contracts unit：3件成功。
- domain Vitest：3件成功。
- Web client Vitest：1件成功。
- API unit：29件成功。R2添付専用は7件成功。
- PostgreSQL 17 integration：添付repository 2件成功。
- Node.js 24、API、DB、domain、Webのbuildとtypecheck：成功。
- Biome全体検査：成功。

## 結論

CriticalとHighの指摘は解消済みです。

R2の実バケット、署名ライブラリ、中央routerへのmountは、staging接続を担当する統合段階でこの契約を使って検証します。
