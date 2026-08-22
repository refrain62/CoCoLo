# 中央API mount契約

この文書は`integration/api-mount`で中央Honoアプリへfeature routeを接続する際の実行経路と未接続条件を定めます。

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
| event | `/api/v1/events` | 503 |
| board contact | `/api/v1/board-members` | 503 |
| order | `/api/v1/orders` | 503 |
| attachment | `/api/v1/uploads` | 503 |
| line notification | `/api/v1/line` | 503 |
| ride operation | `/api/v1/ride-plans` | 503 |
| bulletin board | `/api/v1/announcements` | 503 |
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

event、board contact、order、attachment、LINE、ride、bulletin boardは、中央DB schema、migration、RLS、grant、外部service adapterが統合されるまで本番repositoryを仮実装しません。

依存性が未注入のrouteは`FEATURE_NOT_CONFIGURED`の503を返し、未知pathは404を返します。

これは未接続を成功応答に見せないためのfail-closed契約です。

中央DB schemaを統合するときは、各repositoryのtransaction境界、tenant filter、RLS context、role判定、idempotency、状態遷移を確認してからfeature dependencyへ昇格させます。

将来DBを分離する場合は、中央が依存するrepository interfaceを新DB adapterへ置き換え、外部subjectとtenant membershipだけを同期します。

Supabase Authのpassword、access token、refresh tokenは業務DBへ複製しません。

## rate limitと起動条件

localではin-memory storeを利用できます。

stagingとproductionでは分散rate-limit storeを注入しない限り、アプリ生成時に例外で停止します。

Redisなどのstoreを接続する場合も、keyはtenantとuserまたはWebhookのclient identityをハッシュ化し、PIIをそのまま保存しません。

## 後続接続条件

中央DB schema担当は、feature schemaとmigrationを統合し、RLS、grant、rollback、tenant A/Bの越境テストを提供してください。

Auth担当は、Supabase sessionのrefresh、logout、期限切れ、選択tenantの永続化を中央session契約へ接続してください。

Web担当は`apps/web/src/main.tsx`へAuth team selectionをログイン後かつ業務画面前に接続し、業務API clientへ選択tenantを安全に伝えてください。

外部service担当は、R2署名URL、LINE webhook検証、staging/productionのsecret、失敗時のretryと監視をfeature dependencyとして注入してください。
