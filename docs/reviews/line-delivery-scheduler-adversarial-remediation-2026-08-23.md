# LINE配信scheduler PR #44 敵対的レビュー修正記録

## 対象

- PR: #44
- branch: `feature/line-delivery-scheduler`
- 修正対象: `20260823110000_line_delivery_security_hardening` と同ブランチのworker・DB repository・統合テスト

## High対応

| 指摘 | 修正内容 | 検証 |
| --- | --- | --- |
| 実行可能worker・release・業務transaction経路・E2E不足 | `line-delivery-worker.ts`をreleaseからloadできる実入口として追加し、`@cocolo/db`の`enqueueLineDelivery`を業務transaction clientへ公開。release梱包前にworker存在を検証 | クリーンPostgreSQLでenqueue→claim→fake送信→sent確定、release tarのworker/migration存在を確認 |
| enqueueとmembership変更の競合 | SECURITY DEFINER enqueue関数内でactive membership行を`FOR UPDATE`し、同じ直列化点で確認・登録 | PostgreSQL 17でmembership停止transactionとenqueueを競合させ、停止後登録拒否を確認 |
| timeout/Abortによる重複通知 | 通知単位の`idempotency_key`とpayload hashを保存し、timeout・Abort・provider ID欠落を`unknown`（照合待ち）へ遷移。unknownは自動claimしない | scheduler単体でtimeout/Abort/provider ID欠落をunknownへ確定、実DBでidempotency keyをtransportへ渡すことを確認 |
| `cocolo_app`のglobal worker権限 | `line_delivery_worker`を専用roleとして作成し、claim/mark関数だけへEXECUTE。`cocolo_app`のoutbox直接操作とclaim/markをREVOKE | 実接続の`current_user`、`rolbypassrls=false`、workerのtable直接SELECT拒否、appのclaim拒否を確認 |

## Medium対応

- claim・確定・retry時刻を`clock_timestamp()`基準へ変更し、retry delayをDB側で検証。
- `gen_random_uuid()`をattempt tokenと監査IDへ使用。
- provider ID欠落を成功扱いせず、照合待ちへ遷移。
- providerへ通知単位の冪等キーを渡し、payload hashの不一致再登録を拒否。
- worker専用URLを`LINE_DELIVERY_WORKER_DATABASE_URL`として明示注入し、接続roleを検証。

## 検証結果

- `pnpm test`: 成功
- `pnpm build`: 成功
- `pnpm typecheck`: 成功
- 変更対象Biome lint / API lint: 成功
- `pnpm verify:migration-sql`: 成功
- クリーンPostgreSQL 17 migration deploy: 成功
- API integration（実DB）: 13件成功。LINE配信追加3件を含む
- release artifact: `apps/api/dist/line-delivery-worker.js` とhardening migrationを含むことを確認

workspace全体の`pnpm lint`は、今回の変更対象外にある既存CRLFファイルをBiomeが検出したため失敗した。対象ファイルはLFへ統一し、無関係な全体フォーマット変更は行っていない。
