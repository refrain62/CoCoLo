# 中央API mount契約

この文書は中央Honoアプリへfeature routeを接続した後の実行経路と未接続条件を定めます。

## 起点と責務

統合の起点は`origin/integration/all-features`の`2810944`付近です。

中央APIはfeature固有の認証・入力検証・認可・状態遷移を置き換えず、route factoryを一度だけmountします。

中央middlewareはCORS allowlist、request ID、Bearer認証、UUIDv7 path検証、rate limit、structured log、response envelope検証を全`/api/v1/*`へ適用します。

ログには本文、query、Authorization、IP、tenant ID、user ID、secretを記録しません。

## 公開path

OpenAPIの`servers.url=/api/v1`を基準に、次のpathを中央APIの公開契約とします。

| 機能 | 公開path | 中央依存性が未接続の場合 |
| --- | --- | --- |
| session | `/api/v1/session` | 認証・active membershipなしは401/403 |
| member | `/api/v1/members` | 既存member repositoryを利用 |
| event | `/api/v1/events` | 中央DB repository未接続時は503 |
| board contact | `/api/v1/board-members` | 中央DB repository未接続時は503 |
| order | `/api/v1/orders` | 中央DB repository未接続時は503 |
| attachment | `/api/v1/uploads` | 中央DBまたはR2 adapter未接続時は503 |
| line notification | `/api/v1/line` | LINE設定またはrepository未接続時は503 |
| ride operation | `/api/v1/ride-plans` | 中央DB repository未接続時は503 |
| bulletin board | `/api/v1/announcements` | 中央DB repository未接続時は503 |
| auth team selection | `/api/v1/auth/teams`、`/api/v1/auth/teams/select` | 既存Tenant/TenantMembership adapterを利用 |

Auth team selectionの公開pathはWeb clientの契約と一致させ、旧`/api/v1/teams`は公開しません。

## session

`GET /api/v1/session`はBearer JWTを検証し、JWT subjectのuser IDからactive membershipを一件解決します。

レスポンスの`data`にはDBで確認した`tenantId`と`role`だけを含めます。

Bearerがない場合は401、検証できない場合は401、active membershipがない場合は403で停止します。

tenant IDやroleをquery、body、headerから受け取らないため、HTTP入力による所属越境を許可しません。

複数active membershipを暗黙選択しない判定は、既存membership repositoryの契約で一意に解決できない場合にfail-closedとなる前提です。

## 依存性と503

`server.ts`はSupabase JWT verifier、既存member repository、Auth team selectionのread adapterを注入します。

Auth team selection adapterは既存の`TenantMembership`と`Tenant`を読み取り、user IDとtenant IDの複合条件および`status=active`をDB側で再確認します。

event、board contact、order、attachment、ride、bulletin boardは中央DBのPrisma clientと各repositoryへ接続済みです。

LINEは`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LINE_WEBHOOK_DESTINATION`、`PUBLIC_APP_URL`がそろった場合だけ実adapterを接続し、未設定時は503を返します。

R2はprivate bucketの環境値を起動時に検証し、実体への接続失敗を成功扱いにしません。

依存性が未注入のrouteは`FEATURE_NOT_CONFIGURED`の503を返し、未知pathは404を返します。

これは未接続を成功応答に見せないためのfail-closed契約です。

中央DB schemaを追加・分離するときは、各repositoryのtransaction境界、tenant filter、RLS context、role判定、idempotency、状態遷移を同じ契約のまま検証します。

将来DBを分離する場合は、中央が依存するrepository interfaceを新DB adapterへ置き換え、外部subjectとtenant membershipだけを同期します。

Supabase Authのpassword、access token、refresh tokenは業務DBへ複製しません。

## rate limitと起動条件

localではin-memory storeを利用できます。

stagingとproductionでは分散rate-limit storeを注入しない限り、アプリ生成時に例外で停止します。

Redisなどのstoreを接続する場合も、keyはtenantとuserまたはWebhookのclient identityをハッシュ化し、PIIをそのまま保存しません。

## 未完了の後続接続条件

中央DB schemaのfresh DB適用、RLS、tenant A/Bの越境テストは、PR品質ゲートのPostgreSQL 17で確認済みです。

staging DBでの実資格情報を使ったE2Eと、外部サービスを含む運用確認は別途実施します。

本番の分散rate-limit storeは、RedisまたはCloudflare Durable Objectsなどの原子的なadapterを注入してください。

イベント、締切、回覧の保存処理からLINE outboxへ通知依頼を登録し、外部schedulerのworkerがqueueへ移す境界を接続済みです。

outboxは同一tenant・通知元の組み合わせで冪等化し、業務保存と通知依頼を同じtransactionで確定します。

予定、共同購買、添付、回覧板の詳細画面は中央Webで未接続表示を返します。

staging / productionの実Supabase、R2、LINE、配置adapterと外部schedulerの疎通確認は、環境固有の作業として残っています。
