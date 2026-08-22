# 中央統合の実装状況

この文書は、機能ブランチを中央API・中央Webへ統合した時点の実装範囲と未完了条件を記録します。

## 接続済み

| 領域 | 状態 |
| --- | --- |
| 認証・所属 | Supabase JWT、active membership、session、チーム選択を中央APIへ接続済み |
| 部員 | 既存repository、owner/adminの画面、年度繰り上げを接続済み |
| 予定・出欠 | Prisma repository、中央API、Web一覧・出欠画面を接続済み |
| 役員連絡先 | Prisma repository、中央API、Web画面を接続済み |
| 共同購買・集金 | Prisma永続repository、中央API、Web画面を接続済み |
| 添付 | DB repository、private R2実adapter、署名URL経路を接続済み |
| 回覧板 | DB repository、RLS、中央API、Web一覧・既読画面を接続済み |
| 送迎 | Prisma repository、中央API、Web画面を接続済み |
| LINE | 接続状態、通知queue、実Messaging API adapter、署名Webhook、重複排除、自動outbox、worker入口を接続済み |

## 未実装・未検証

1. 中央Webの予定、共同購買、添付、回覧板の資源詳細画面。
2. staging / productionで利用する分散rate-limit storeの実adapter。
3. Supabase、Cloudflare R2、LINE Messaging API、配置先の実資格情報を使った疎通・E2E。
4. 外部schedulerから`pnpm line:deliver`を定期実行する運用設定。
5. `docs/ci-hardening-plan.md`に記載されたT-014のCI強化。

## 自動LINE通知の接続範囲

予定の作成時は作成通知と出欠締切通知、予定の更新時は出欠締切通知を、業務データと同じtransactionでoutboxへ登録します。

出欠締切通知は締切24時間前を基準とし、既に締切が近い予定は保存直後を通知時刻にします。

回覧の掲載時は、同じtransactionで回覧通知をoutboxへ登録します。

outboxは`tenant_id + source_type + source_id`で冪等化し、未送信の依頼だけ更新できます。

workerは限定された`SECURITY DEFINER`関数でdue outboxを接続済みgroupのqueueへ移し、未接続tenantは`ignored`として確定します。

outboxからqueueへの移送とLINE外部送信は別transactionです。
外部送信に失敗した場合はqueueの再試行状態を使い、業務データのtransactionを巻き戻しません。

## fail-closedの条件

LINEのchannel secret、access token、destination、公開URLがそろわない環境では、LINE featureを中央APIへ接続しません。

staging / productionで分散rate-limit storeを注入しないAPIは起動させません。

R2のsecretやprivate bucketが環境境界に一致しない場合は、署名URLを成功扱いにしません。

未接続の資源詳細URLはUUIDv7を検証した後、詳細データを推測できない未接続表示へ収束させます。

## ローカル検証の制約

Node.js 24、pnpm、API・DBのbuild、unit test、対象ファイルのBiome検査は実行済みです。

ローカル環境にはDockerと接続可能な`DATABASE_URL` / `DIRECT_URL`がないため、実PostgreSQLのintegration testはskipされています。

PR #40の品質ゲートではPostgreSQL 17へfresh migrationを適用し、中央RLS、状態遷移trigger、LINE outboxの認可・冪等性・worker競合・未接続tenantを実DBで確認済みです。
stagingの実資格情報を使うE2Eと外部schedulerの定期実行は未検証のまま残っています。

worktreeが`.worktrees`配下にあるため、ルートからの`pnpm lint:biome`はBiomeの除外規則により0ファイル検査になります。
CIまたは通常のリポジトリルートで全体検査を実施してください。
