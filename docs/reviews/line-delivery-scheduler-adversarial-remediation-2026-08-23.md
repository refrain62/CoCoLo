# LINE配信scheduler PR #44 敵対的レビュー修正記録

## 対象

- PR: #44
- branch: `feature/line-delivery-scheduler`
- 修正対象: provider再送キー、公開通知API、`20260823120000_line_delivery_provider_retry_key`、worker・DB repository・統合テスト

## 独立再レビュー追加対応

H-1では、期限切れleaseまたは古いattempt tokenを持つworkerが`unknown`へ上書きできる競合が残っていた。
`20260823130000_line_delivery_unknown_lease_guard`で、`status='sending'`、現行`attempt_token`、`lease_expires_at > clock_timestamp()`を同じUPDATE条件へ追加した。
条件に一致しない場合は`stale`を返し、行と監査ログを変更しない。

H-2では、release archiveにAPIのruntime workspace packageのdistとpackage metadataが不足していた。
API、auth、contracts、db、domainのdistとpackage.json、`pnpm-workspace.yaml`をmanifestへ固定し、verifyでarchive内のentrypointとmetadataを検証する。
contractsもsource TypeScriptではなくdistをNodeのruntime exportへ設定し、再buildなしのproduction promoteで起動できる形にした。

M-1では、同一tenant内の別sourceによる冪等キーunique violationをAPIの409契約へ変換する。
M-2では、LINE 409を明示的なprovider failureとして扱い、`failed`とDB時刻基準の再試行へ進める。
M-3では、unknownのprovider照合に必要なretry keyとpayload hash、現行attempt条件を文書化する。
照合API、CLI、自動reconcile workerは本PRの実装範囲外である。

## 独立レビュー再修正

独立レビューのH-1は、LINE Messaging APIが認識する正式なヘッダーを`X-Line-Retry-Key`へ限定し、内部冪等キーとpayload hashだけではprovider側の重複抑止にならない点を指摘した。

H-2は、`enqueueLineDelivery`がhelperとテストからしか呼ばれず、productionの業務APIから同一transactionへ接続されていない点を指摘した。

H-1には、通知行へUUIDの`provider_retry_key`を保存し、claim・retry・lease再取得で同じ値を`X-Line-Retry-Key`へ渡す変更で対応した。

H-2には、owner/admin向け`POST /api/v1/notifications/line`とDB producerを追加し、API serverのrepository wiringから同じtransaction内の監査イベントとoutbox登録を実行する変更で対応した。

## High対応

| 指摘 | 修正内容 | 検証 |
| --- | --- | --- |
| 実行可能worker・release・業務transaction経路・E2E不足 | `line-delivery-worker.ts`をreleaseからloadできる実入口として追加し、`POST /api/v1/notifications/line`からDB producerを同じ業務transactionへ接続。release梱包前にworker存在を検証 | クリーンPostgreSQLで公開API→enqueue→claim→fake送信→sent確定、release tarのworker/migration存在を確認 |
| enqueueとmembership変更の競合 | SECURITY DEFINER enqueue関数内でactive membership行を`FOR UPDATE`し、同じ直列化点で確認・登録 | PostgreSQL 17でmembership停止transactionとenqueueを競合させ、停止後登録拒否を確認 |
| timeout/Abortによる重複通知 | 通知単位の`idempotency_key`とpayload hashに加え、UUIDの`provider_retry_key`を保存。正式な`X-Line-Retry-Key`を使い、timeout・Abort・provider ID欠落は`unknown`（照合待ち）へ遷移 | scheduler単体で正式ヘッダーを実送信transportへ渡すことを確認し、実DBでretry・unknown・lease切れのprovider key再利用を検証 |
| `cocolo_app`のglobal worker権限 | `line_delivery_worker`を専用roleとして作成し、claim/mark関数だけへEXECUTE。`cocolo_app`のoutbox直接操作とclaim/markをREVOKE | 実接続の`current_user`、`rolbypassrls=false`、workerのtable直接SELECT拒否、appのclaim拒否を確認 |

## Medium対応

- claim・確定・retry時刻を`clock_timestamp()`基準へ変更し、retry delayをDB側で検証。
- `gen_random_uuid()`をattempt tokenと監査IDへ使用。
- provider ID欠落を成功扱いせず、照合待ちへ遷移。
- unknown確定を現行attempt tokenかつ有効leaseに限定し、期限切れ競合を`stale`として無変更扱い。
- providerへ通知単位の冪等キーを渡し、payload hashの不一致再登録を拒否。
- worker専用URLを`LINE_DELIVERY_WORKER_DATABASE_URL`として明示注入し、接続roleを検証。
- 公開通知APIの`Idempotency-Key`、source、payloadを契約層で検証し、異なるpayloadの再利用を409で拒否。
- 同一tenant内の別sourceによるIdempotency-Key重複を409へ変換し、LINE 409をprovider failureとして再試行。

## 検証結果

- `pnpm test`: 成功
- `pnpm build`: 成功
- `pnpm typecheck`: 成功
- 変更対象Biome lint / API lint: 成功
- `pnpm verify:migration-sql`: 成功
- クリーンPostgreSQL 17 migration deploy: 成功
- API integration（実DB）: 18件成功。公開API経路、retry・unknown・lease切れ、unknown確定競合、別source冪等キー競合を含む
- release artifact: `apps/api/dist/line-delivery-worker.js`、runtime workspace packageのdist/package.json、hardening migrationを含むことを確認

workspace全体の`pnpm lint`は、今回の変更対象外にある既存CRLFファイルをBiomeが検出したため失敗した。対象ファイルはLFへ統一し、無関係な全体フォーマット変更は行っていない。
