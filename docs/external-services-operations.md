# 外部サービス運用仕様

## 1. 目的と適用範囲

この文書は、CoCoLo が外部サービスを利用するときの構成、設定、権限、監視、障害対応、変更手順を定める運用の正本です。

対象は次のサービスです。

| サービス | 現在の扱い | CoCoLo での責務 |
| --- | --- | --- |
| Supabase Auth | Phase 1 で利用中 | ログイン、JWT 発行、ユーザー停止・資格情報管理 |
| Supabase PostgreSQL | Phase 1 で利用中 | アプリケーションデータ、RLS、監査ログ、マイグレーション |
| 分散レート制限ストア（Redis等） | staging / productionで利用 | 複数API instance間の原子的なレート制限カウンター |
| Cloudflare R2 | Phase 4 でadapter導入中 | 非公開の添付ファイル保存・配信 |
| LINE Messaging API | Phase 4 の通知機能で利用 | 接続済みチームへの予定、締切の自動通知、owner/admin の汎用通知と Webhook |
| Cloudflare の配置先 | 環境固有の配置アダプターで接続 | Web/API の配置と HTTPS 公開 |
| GitHub Actions | CI/CD で利用中 | 品質検査、staging 配置、production 昇格、証跡保存 |

Cloudflare R2 のように段階導入中のサービスは、導入前にこの文書の「導入前チェック」を完了させます。未設定のサービスを画面や API から利用可能に見せてはいけません。

## 2. 構成と責務の境界

```text
利用者のブラウザ
  ├─ Supabase Auth       ログインしてアクセストークンを取得
  └─ CoCoLo Web/API
       ├─ Supabase Auth の JWT を検証
       ├─ Supabase PostgreSQL（現行。将来は分離先 PostgreSQL）へアプリケーションデータを保存
       ├─ Cloudflare R2 へ署名付きアップロードを発行（Phase 4）
       ├─ LINE Messaging API へ通知を送信（Phase 4）
       └─ Cloudflare の配置先へ配置アダプター経由で公開

GitHub Actions
  ├─ 現行は Supabase PostgreSQL、分離後は分離先 PostgreSQL のマイグレーションと検証
  ├─ staging の E2E と配置証跡の保存
  └─ 検証済み成果物だけを production へ昇格
```

次の境界を変更しないでください。

- ブラウザは `DATABASE_URL`、`DIRECT_URL`、Service Role Key、R2 の秘密鍵を参照しません。
- `apps/web` は API を経由し、Supabase PostgreSQL や Prisma Client を直接参照しません。
- API は Supabase Auth のアクセストークンを検証します。Service Role Key を認証の代わりに使用しません。
- アプリケーションデータの所有者は PostgreSQL です。Supabase Auth のユーザー情報や R2 のオブジェクトをアプリケーションデータの代わりに扱いません。
- R2 の公開 URL は保存・返却しません。添付ファイルは API が認可した短期 URL でだけ扱います。

## 3. 環境ごとの分離

| 環境 | Auth | PostgreSQL | R2 | データの制約 | 秘密情報の投入元 |
| --- | --- | --- | --- | --- | --- |
| `local` | Supabase CLIで起動するDocker Auth | Supabase CLIで起動するDocker PostgreSQL | 導入後は `cocolo-local` | 実データ持ち込み禁止。volumeを保持する | 開発者の `.env`。Git に登録しない |
| `test` | 毎回破棄するSupabase CLI Auth | 毎回破棄するDocker PostgreSQL | 使用しない | 合成fixtureだけ。localとはproject・port・volumeを分離 | Workflowまたはローカルの一時環境 |
| `staging` | staging 専用 Supabase project | production と分離した PostgreSQL | `cocolo-staging-private` | 本番データをコピーしない。local/test fixtureを適用しない | GitHub の `staging` Environment |
| `production` | production 専用 Supabase project | production 専用 PostgreSQL | `cocolo-production-private` | 実データ。staging からコピーしない | GitHub の保護された `production` Environment |

環境をまたいで、次の値を共有してはいけません。

- Supabase project の URL、JWKS URL、Auth ユーザー、Service Role Key
- PostgreSQL の接続 URL、DB ロール、バックアップ、監査ログ
- R2 バケット、アクセスキー、署名 URL の秘密鍵
- 配置アダプターと配置先の認証情報

API 起動時は `APP_ENV`、Supabase URL/JWKS URL、R2 endpoint、R2 バケット名、R2 access key、R2 secret key、公開 URL の許可値を検証します。環境値が不足または一致しない場合は fail-closed とし、起動や配置を継続しません。

分散レート制限ストアの設定、adapter 契約、障害対応は [分散レート制限の運用契約](rate-limit-operations.md) を正本とします。

`local` は in-memory 実装だけを使い、`staging` と `production` は原子的な分散 adapter が設定されていなければ起動しません。

## 4. Supabase Auth の運用

### 4.1 設定契約

| 項目 | 内容 |
| --- | --- |
| プロジェクト | `local`、`test`、`staging`、`production` で分離 |
| ログイン方式 | Phase 1 はメールアドレスとパスワード |
| API への伝達 | `Authorization: Bearer <access token>` |
| API の検証 | issuer、audience、署名、`exp`、`nbf`、JWT subject を検証 |
| ユーザー ID | JWT subject を外部 ID として保存。アプリ DB に Auth ユーザー表を複製しない |
| ブラウザに公開可能な値 | Supabase URL、anon key |
| ブラウザへ渡してはいけない値 | Service Role Key、DB URL、R2 秘密鍵 |

`SUPABASE_URL` と `SUPABASE_JWKS_URL` は環境ごとの許可値と完全一致させます。JWT 検証ができない場合、API は認証済みとして処理せず `401` または設定エラーとして停止します。

localとtestはどちらもSupabase GoTrueが発行する実JWTを使います。固定tokenを返すtest-only Auth adapterはlocal起動経路から使用しません。Authの合成ユーザーはtest stackのloopback URLへService Role Keyで冪等作成し、WebへService Role Keyを渡しません。

### 4.2 ユーザー・所属の運用

Supabase Auth のユーザー停止と CoCoLo の所属停止は別の状態です。

1. Auth ユーザーを停止すると、ログイン自体を拒否します。
2. CoCoLo の所属を `suspended` にすると、ログインできてもチームデータを操作できません。
3. ユーザー削除を先に行うと監査ログの実行者を追跡できなくなるため、原則として CoCoLo の所属を停止し、保持期間と監査要件を確認してから Auth ユーザーを削除します。
4. Auth ユーザーを再作成した場合は subject が変わる可能性があるため、既存の所属へ自動的に付け替えません。本人確認と承認を経て新しい所属を作成します。

### 4.3 Auth 障害時

- ログインだけが失敗する場合は、Supabase Auth の障害状況、project の停止状態、許可 URL、JWKS の取得可否を確認します。
- API の既存セッションが有効でも、JWT の期限・署名・issuer 検証を無効化して継続してはいけません。
- Auth の復旧待ちに、Service Role Key をブラウザへ埋め込む回避策や、検証を省略する緊急フラグを追加してはいけません。
- 復旧後はログイン、ログアウト、期限切れトークン、停止済み所属、別チームアクセスを staging で確認してから production の利用者へ案内します。

## 5. Supabase PostgreSQL の運用

### 5.1 接続とロール

アプリケーション接続とスキーマ変更接続を分離します。

| 接続 | 環境変数 | 用途 | 必須制約 |
| --- | --- | --- | --- |
| アプリケーション接続 | `DATABASE_URL` | API の通常クエリとトランザクション | `cocolo_app`。`BYPASSRLS` を持たない |
| マイグレーション接続 | `DIRECT_URL` | Prisma マイグレーション、RLS・権限変更 | migration owner。API の実行経路から参照しない |
| LINE Webhook受信接続 | `LINE_WEBHOOK_RECEIVER_DATABASE_URL` | 公開Webhookのreceipt記録 | `line_webhook_receiver`。専用関数のEXECUTEだけを持つ |
| セキュリティ所有者 | DB 内で管理 | RLS の `SECURITY DEFINER` 関数など | `cocolo_app` から変更できない |

`DATABASE_URL` は接続プールやアプリ用プールエンドポイントを使用できますが、`DIRECT_URL` はマイグレーションが確実に実行できる直接接続を使用します。どちらも TLS を必須とし、接続先のホスト名と DB 名を環境の許可値へ固定します。

### 5.2 データ保護

- すべてのテナント所属テーブルで RLS を有効化し、`ENABLE` と `FORCE` の両方を設定します。
- API は同じトランザクション内で tenant、user、role のコンテキストを設定し、所属状態を再確認してから業務クエリを実行します。
- テナント ID をリクエストから信頼しません。JWT と DB の所属情報から対象テナントを解決します。
- `cocolo_app` に RLS を迂回する権限や `BYPASSRLS` を与えません。
- 氏名、連絡先、監査ログなどの個人情報を SQL ログ、CI ログ、外部監視のメタデータへ出力しません。

### 5.3 マイグレーション

production のスキーマ変更は、リポジトリ上の検証済みリリース成果物に含まれる SQL だけを使用します。

1. Prisma schema と migration SQL をレビューします。
2. SQL のコメント、RLS、権限、テナント境界の複合外部キーを検査します。
3. `staging` へ同じ成果物を適用し、実 PostgreSQL の統合テストと E2E を実行します。
4. staging の成功 SHA、マイグレーション checksum、成果物 SHA を証跡へ保存します。
5. 承認後、同じ成果物を production へ適用します。

管理画面からの SQL 実行、手動で編集した production の schema、`prisma db push` による本番変更は禁止します。

localのSupabase起動では、Docker volumeを保持したまま `prisma migrate deploy` を実行します。既適用migrationは再実行せず、未適用の差分だけを適用します。test DBだけは実行前にstackを破棄するため、毎回migrationを最初から適用します。

### 5.4 テストfixtureの境界

`db:seed:test` は `127.0.0.1` または `localhost` のPostgreSQLと許可されたテストDB名だけを受け付け、Auth fixtureはそれに加えて `cocolo-local` / `cocolo-test` のloopback Supabase projectだけを受け付けます。stagingやproductionのURL、linked project、任意のリモートURLは拒否します。

qualityやDB整合性Workflowの通常PostgreSQLはテスト用ホストとしてfixtureを使います。日次・週次・手動E2Eは`cocolo-test` Supabase stackでfixtureを作成し、実行後にstackを破棄します。staging deployとproduction promoteにはfixture投入stepを置きません。

### 5.5 PostgreSQL 障害時

- API の接続エラーを検知したら、まず対象環境、接続 URL、TLS、DB の稼働状態、接続数上限、RLS ロールを確認します。
- 接続先を別環境へ差し替えて復旧させてはいけません。`APP_ENV` と DB の環境ガードが一致することを確認します。
- DB が読み取り可能でも書き込み整合性が確認できない場合、登録・更新・年度繰り上げを再試行させず、利用者へ再実行の判断を案内します。
- 障害復旧後は health check だけで完了とせず、認証、テナント越境拒否、部員登録、監査ログ、年度繰り上げの冪等性を staging または承認済みの限定手順で確認します。

Supabase PostgreSQL を将来別の PostgreSQL へ分離する場合は、接続先の差し替えだけで完了とみなしてはいけません。移行対象外の Auth・管理用 schema・秘密情報、RLS・ロール、件数・checksum照合、書き込み再開後の forward recovery まで含む [DB分離仕様・移行計画](database-separation-plan.md) を適用します。

## 6. Cloudflare R2 の導入・運用（Phase 4）

### 6.1 導入前チェック

R2 の実接続adapterを有効化する前に、次を完了させます。

- `local`、`staging`、`production` で非公開バケットを作成し、バケット名を環境ガードへ登録する。
- バケットの公開アクセスを無効化し、一覧・匿名 GET・推測可能な公開 URL を許可しない。
- ブラウザの直接 PUT に必要な CORS を環境ごとの公開 URL に限定する。許可メソッド、許可ヘッダー、公開ヘッダー、有効期間をレビューする。
- API だけが署名 URL を発行できるよう、R2 のアクセスキーを API または配置環境の Secret として保管する。
- `R2_ENDPOINT`、`R2_BUCKET`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` を `APP_ENV` ごとに分離し、未設定時は fail-closed とする。
- アップロード開始、完了、期限切れ、再利用、別テナント、形式不正、サイズ超過のテストを追加する。
- 失敗した添付本体を24時間以内に削除するクリーンアップ手順と、削除失敗の監視を用意する。

### 6.2 添付ファイルの契約

- DB にはテナント、所有者、MIME、サイズ、オブジェクトキー、SHA-256、状態、期限、完了試行回数、cleanup試行回数を記録します。オブジェクト本体は記録しません。
- オブジェクトキーへ利用者入力のファイル名をそのまま使用しません。テナント ID と添付 ID を基礎にしたサーバー生成キーを使用します。
- API は所属、権限、セッション所有者、テナント、期限、未使用、上書き不可、実体サイズ、マジックバイト、SHA-256 を再検証します。
- 状態は `uploaded → available → deleted` または `uploaded → rejected` のみを許可します。
- `rejected`、期限切れ、再利用済み、別テナントのオブジェクトに署名 URL を発行しません。
- R2 の管理画面 URL、公開 URL、アクセスキーを利用者向けレスポンスやログへ出力しません。
- R2 実接続adapterは、署名前に対象 object の存在と metadata を確認します。PUT は既存 object に署名せず、GET は存在しない object に署名せず、DELETE は短期署名 URL で実行します。
- 外部資格情報を使えない検証環境では、HTTP stub を S3 互換 endpoint として使い、secret のログ出力や公開 URL 化を伴わずに署名・metadata・削除の挙動を確認します。
- 実装では`uploaded`の完了検証を3回まで再試行し、検証不能または形式不正を`rejected`へ遷移させます。
- `rejected`本体の削除に失敗した場合は`cleanup_completed_at`を空のまま残し、利用者または運用ジョブがcleanupを再試行します。
- 完了操作が届かない期限切れセッションは、管理者または運用ジョブが期限切れcleanup APIを実行して24時間以内の削除対象へ回収します。

### 6.3 R2 障害時

- 署名 URL の発行失敗は API の依存サービス障害として扱い、未完了セッションを成功扱いにしません。
- 直接 PUT 成功後に `complete` が失敗した場合、DB の状態を `available` に変更しません。再検証または期限切れ削除へ進めます。
- R2 の読み取り障害中に、公開バケットへの切り替えや長期間有効な署名 URL の発行を行いません。
- 復旧後は、アップロード、完了検証、認可済みダウンロード、別テナント拒否、期限切れ削除を staging で確認します。

## 7. LINE Messaging API の運用

### 7.1 設定と責務

LINE の channel secret と channel access token は環境ごとに分離し、API 専用の Secret として管理します。

`LINE_WEBHOOK_DESTINATION` は署名検証後の送信先検証に使い、別 channel の payload を受け付けないための環境固定値です。

`LINE_LIFF_ID` は LIFF を使う環境だけへ設定し、state へ任意 URL や tenant ID を渡しません。

ブラウザは channel secret、channel access token、Webhook の受信処理を参照しません。

予定の作成・更新と出欠締切は、通知 DTO と `line_delivery_outbox` の境界だけを利用し、LINE SDK や provider のレスポンス形式へ依存しません。

回覧と未払い通知の自動 producer は現行 `develop` へ接続していないため、接続完了まで「LINE連携済み」の機能範囲へ含めません。

### 7.2 グループ紐付けと配信

group ID は `line_connections` で一つの tenant にだけ紐付け、接続解除時は Webhook の対象から外します。

現行の中央通知は `line_delivery_outbox` が作成時の送信対象 group ID と接続世代を保持し、接続解除後に別 group へ再接続しても古い通知を新 group へ送りません。

旧 feature route の `line_notification_queue` と現行の中央 `line_delivery_outbox` は別契約であり、同じ通知を二つのqueueへ登録しません。

未接続のチームは画面へ「未接続」と表示し、通知登録を成功扱いにしません。

送信処理は `pending`、`sending`、`sent`、`failed` の状態を queue へ記録し、失敗時は上限付き指数バックオフで再試行します。

全 tenant を処理する配信 worker は内部 job だけから起動し、owner や admin が呼び出せる HTTP endpoint を公開しません。

provider の本文、token、個人情報をエラー記録や監視ラベルへ保存しません。

### 7.3 Webhook

Webhook は raw body の HMAC-SHA256 署名、destination、group ID の接続状態を順に検証します。

公開WebhookはJWTを要求しませんが、`/api/v1/line/webhook` のPOSTだけに限定し、受信DB roleは `app_record_line_webhook_receipt` の実行権限だけを持ちます。`cocolo_app` はreceiptの直接INSERT・UPDATE・DELETEを行いません。

`group_id + webhook_event_id` の重複排除キーを保存し、同じイベントを二度処理しません。

未知の group や解除済み group のイベントは、LINE へ再送を要求せず安全に無視します。

### 7.4 障害と復旧

- LINE API の送信失敗は outbox の `failed` として保存し、次回実行時刻と試行回数を表示します。
- providerの送達結果を確認できない場合は `unknown` として保存し、自動的に `sent` または `failed` へ変更しません。
- channel secret の検証失敗は `401` とし、署名検証を省略した受信経路へ切り替えません。
- LINE の障害中に group ID の別 tenant への付け替え、公開 URL の配布、無制限再試行を行いません。
- 復旧後は接続、未接続、予定自動通知、手動通知、失敗、送達不明、再試行、Webhook 重複、別 tenant 拒否を staging で確認します。

### 7.5 利用開始時の運用手順

1. stagingまたはproduction専用のLINE Messaging API channelを作成します。
2. channel secret、channel access token、Webhook destination、公開アプリURLを環境ごとに登録します。
3. Botをテスト対象のLINEグループへ参加させます。
4. Webhookイベントなどからgroup IDを取得し、CoCoLoのownerまたはadminへ安全な経路で伝えます。
5. CoCoLoのLINE通知画面でgroup IDを登録し、接続状態を確認します。
6. 予定作成、締切通知、手動通知、送信失敗、再送、Webhook重複の順にstagingで確認します。

group IDの自動検出、QRコード接続、個人LINEアカウントの紐付けは現行実装にありません。

group ID、channel secret、channel access token、Webhook raw bodyをlocalログ、スクリーンショット、監査metadataへ記録しません。

LINE 機能の API、Web、DB、LIFF の統合手順は [Phase 4 LINE 通知統合手順](integration/phase4-line-notifications.md) を参照します。

## 8. GitHub Actions と配置サービスの運用

### 8.1 Secret と Variable

- Secret には DB URL、Service Role Key、R2 秘密鍵、配置アダプター、E2E パスワードを登録します。
- Variable には Supabase URL、JWKS URL、公開 URL、許可リスト、保持日数など、漏えいしても認証情報にならない値を登録します。
- `staging` と `production` の Environment を分け、production の Secret は protected Environment の承認後だけ読み出します。
- Secret の値を workflow の `echo`、artifact、配置記録、スクリーンショットへ出力しません。

### 8.2 配置アダプター

配置先のサービス固有処理は `STAGING_DEPLOY_ADAPTER` または `PRODUCTION_DEPLOY_ADAPTER` で指定した配置アダプターに閉じ込めます。アダプターの入力、配置記録、失敗条件は[デプロイ運用手順](deployment-guide.md)の契約に従います。

配置記録が検証できない場合、staging E2E と production 昇格を続行しません。配置アダプターの変更は、サービス固有の認証、ロール、ネットワーク、ロールバック方法をこの文書へ追記してから行います。

## 9. バックアップ・復旧

### 9.1 必須のバックアップ対象

- PostgreSQL のアプリケーションデータ、監査ログ、マイグレーション履歴
- Supabase Auth のユーザー・設定情報（提供機能と契約プランの範囲で取得）
- R2 の添付ファイルと、対応する DB の添付メタデータ
- GitHub Actions の staging 配置証跡、成果物 checksum、provenance

Auth と R2 は PostgreSQL のダンプだけでは復旧できません。サービスごとに復旧手順を持ち、DB の復旧時は Auth subject と添付メタデータの対応を確認します。

### 9.2 復旧後の確認

1. 対象環境と復旧時点を記録する。
2. PostgreSQL のスキーマ、RLS、ロール属性、マイグレーション履歴を確認する。
3. Auth subject を持つ所属が孤児化していないことを確認する。
4. 添付メタデータと R2 オブジェクトの対応、公開アクセス無効化を確認する。
5. 別テナントの一覧・添付・監査ログが見えないことを確認する。
6. 監査ログへ復旧作業者、復旧時刻、対象バックアップ、結果を記録する。

RPO、RTO、バックアップ保持期間は契約プランとチームの業務要件を確認して確定します。未確定のまま production を開始してはいけません。

## 10. 変更・障害対応チェックリスト

### 外部サービスを追加・変更するとき

- [ ] データを保存するサービスと、保存しないサービスを明記した。
- [ ] `local`、`staging`、`production` のプロジェクト・バケット・URLを分離した。
- [ ] LINE channel、group ID、Webhook destination、LIFF IDを環境ごとに分離した。
- [ ] Secret と Variable の分類、登録者、ローテーション方法を記録した。
- [ ] 権限最小化、TLS、公開アクセス無効化、監査ログを確認した。
- [ ] 障害時に安全側へ倒れる状態と、復旧後の検証手順を追加した。
- [ ] staging で実データを使わずに接続、失敗、復旧、E2E を確認した。
- [ ] 本番変更の承認者、実行者、ロールバックまたは前進復旧手順を記録した。

### 障害が発生したとき

- [ ] 環境、サービス、発生時刻、影響範囲を確定した。
- [ ] 認証、DB、R2、LINE、配置先のどこが失敗しているかを分離した。
- [ ] 認証省略、公開バケット化、別環境接続などの危険な回避策を使っていない。
- [ ] 書き込み再試行による二重登録・二重実行を防止した。
- [ ] 復旧後のデータ整合性、テナント境界、監査ログを確認した。
- [ ] 外部サービスの障害番号、証跡、判断、再発防止策をレビュー記録へ残した。
