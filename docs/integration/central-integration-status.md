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
| LINE | 接続状態、通知queue、実Messaging API adapter、署名Webhook、重複排除、worker入口を接続済み |

## 未実装・未検証

1. 予定、締切、回覧の保存処理からLINE通知queueへ自動登録するoutbox経路。
2. 中央Webの予定、共同購買、添付、回覧板の資源詳細画面。
3. staging / productionで利用する分散rate-limit storeの実adapter。
4. Supabase、Cloudflare R2、LINE Messaging API、配置先の実資格情報を使った疎通・E2E。
5. 外部schedulerから`pnpm line:deliver`を定期実行する運用設定。
6. Dockerまたはstaging PostgreSQLへ接続したfresh migration、RLS越境、worker関数の実DB検証。
7. `docs/ci-hardening-plan.md`に記載されたT-014のCI強化。

## fail-closedの条件

LINEのchannel secret、access token、destination、公開URLがそろわない環境では、LINE featureを中央APIへ接続しません。

staging / productionで分散rate-limit storeを注入しないAPIは起動させません。

R2のsecretやprivate bucketが環境境界に一致しない場合は、署名URLを成功扱いにしません。

未接続の資源詳細URLはUUIDv7を検証した後、詳細データを推測できない未接続表示へ収束させます。

## ローカル検証の制約

Node.js 24、pnpm、API・DBのbuild、unit test、対象ファイルのBiome検査は実行済みです。

ローカル環境にはDockerと接続可能な`DATABASE_URL` / `DIRECT_URL`がないため、実PostgreSQLのintegration testはskipされています。

worktreeが`.worktrees`配下にあるため、ルートからの`pnpm lint:biome`はBiomeの除外規則により0ファイル検査になります。
CIまたは通常のリポジトリルートで全体検査を実施してください。
