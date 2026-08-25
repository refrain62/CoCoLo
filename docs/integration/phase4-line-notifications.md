# Phase 4 の LINE 通知を使う契約

## この機能でできること

LINE連携は、CoCoLoのチームと、そのチームのBotが参加するLINEグループを紐付ける機能です。

CoCoLoの予定、出欠締切、回覧、集金の正本はWebとデータベースに置き、LINEは通知と対象画面への導線に限定します。

個人のLINEアカウントをCoCoLoへ紐付ける機能ではなく、現行実装はLINEグループへの配信だけを対象にします。

公式アカウントへの配信、個人LINEへの配信、LINEメッセージへの返信による業務状態の更新は、現行実装の対象外です。

## 利用者が行う操作

### 利用開始の手順

1. 運用者が環境ごとのLINE Messaging API channel、Webhook、Botを設定します。
2. 運用者がBotを通知対象のLINEグループへ参加させます。
3. 運用者がLINEのWebhookイベントなどから対象グループのgroup IDを取得します。
4. CoCoLoのownerまたはadminが、LINE通知画面へgroup IDを入力して接続します。
5. 接続状態が「接続済み」になった後、予定の作成や通知登録を行います。

group IDの自動検出、QRコードによる接続、LINEアカウントによるOAuth接続は現行実装にありません。

group IDの取得方法とBotをグループへ参加させる作業はCoCoLoの画面外で行うため、staging受入時に運用手順を確定します。

### 権限ごとの操作

| 操作 | owner | admin | staff | guardian |
| --- | --- | --- | --- | --- |
| 接続状態の確認 | 可 | 可 | 可 | 可 |
| group IDの表示 | 可 | 可 | 不可 | 不可 |
| 接続と切断 | 可 | 可 | 不可 | 不可 |
| 予定作成時の自動通知 | 可 | 可 | 可 | 不可 |
| 予定更新時の自動通知 | 可 | 可 | 可 | 不可 |
| 回覧掲載時の自動通知 | 可 | 可 | 可 | 不可 |
| 汎用通知の手動登録 | 可 | 可 | 不可 | 不可 |
| 失敗通知の手動再送 | 可 | 可 | 不可 | 不可 |

staffは予定の作成・更新と回覧掲載に伴う自動通知を発生させられます。

staffが汎用通知を手動登録する権限は、現行の中央producerでは付与していません。

guardianは接続状態だけを確認でき、接続、通知登録、再送を行えません。

### 予定から自動送信される通知

LINEグループが接続済みの状態で予定を作成すると、予定通知と出欠締切通知を同じ業務transactionへ登録します。

予定通知は保存直後に送信対象となります。

出欠締切通知は締切の24時間前を送信予定時刻とし、締切が近い場合は保存直後に送信対象となります。

予定を更新した場合は、予定通知を新たに登録せず、出欠締切通知を更新後の締切に合わせて登録します。

LINEが未接続の場合、予定の保存は成功しますが、LINEのoutbox行は作成されません。

owner、admin、staffが回覧を掲載すると、`line-notifications`が有効で接続済みグループがある場合に、回覧掲載と同じ業務transactionへ固定文面の通知を登録します。通知のdeep linkはサーバーが公開済み回覧のIDから生成し、冪等キーは`bulletin:{announcementId}`です。feature flagが無効またはLINE未接続の場合、回覧の掲載は成功しますが通知outbox行は作成しません。

### 汎用通知を手動登録する操作

ownerまたはadminは、LINE通知画面から通知元種別、通知元ID、タイトル、本文を入力して汎用通知を登録できます。通知元IDは予定、出欠締切、公開済み回覧のUUIDv7に限定します。

CoCoLo内のdeep linkは通知元種別とIDからサーバー側で生成します。クライアントは任意URLを指定できません。

Web画面は接続中のgroup IDを通知先としてAPIへ渡し、APIはそのgroup IDが現在のチームへ接続されていることを再確認します。

登録APIは送信完了を待たず、`pending`状態の通知IDを返します。

LINEが未接続の場合、現行の汎用通知APIは`LINE_NOT_CONNECTED`の409を返し、送信依頼を成功扱いにしません。

汎用通知は`event`、`deadline`、`bulletin`の通知元種別でoutboxへ保存されます。

`line-notifications` feature flagが無効なチームでは、API登録、予定・回覧の自動登録、workerのclaim・送信直前検証をすべて停止します。feature contractを確認できない構成もfail-closedで停止します。

回覧掲載時の自動通知producerはPR #183で汎用通知outboxへ接続済みです。未払い者通知のproducerは、個別メンバーの通知先と対象者限定deep linkの仕様確定後に別タスクで実装します。

## 現行のAPI経路

中央APIでは、接続操作とWebhookにfeature routeを使用し、汎用通知登録と再送には現行の`line_delivery_outbox` producerを使用します。

feature routeが持つ旧来の`/api/v1/line/notifications`は中央Webの通知登録経路ではありません。

| 操作 | HTTP | 認証 | 現行の実装 |
| --- | --- | --- | --- |
| 接続状態 | `GET /api/v1/line/status` | JWT | owner/adminにはgroup ID、staff/guardianには状態だけを返す |
| 接続 | `POST /api/v1/line/connect` | JWT | owner/adminだけがgroup IDを登録する |
| 切断 | `DELETE /api/v1/line/connect` | JWT | owner/adminだけが実行する |
| 汎用通知登録 | `POST /api/v1/notifications/line` | JWT、`Idempotency-Key` | owner/adminだけがoutboxへ登録する |
| 失敗通知の再送 | `POST /api/v1/notifications/line/:notificationId/retry` | JWT | owner/adminだけが実行する |
| Webhook受信 | `POST /api/v1/line/webhook` | LINE署名 | JWTを要求せず、専用受信境界で検証する |

HTTP bodyからtenant IDを受け取らず、認証済みの選択チームとactive membershipから対象tenantを解決します。

汎用通知登録では、`sourceType`、UUIDv7の`sourceId`、`destination`、タイトル、本文、冪等キーをAPIへ渡します。deep linkはAPIへ渡しません。

APIは通知先を現在接続中のgroup IDと照合し、別のgroupや切断済みgroupへの登録を拒否します。

## データと配信worker

中央の通知producerは`line_delivery_outbox`を使用します。

予定・回覧の自動通知と汎用通知は、業務transaction内でoutboxへ登録するため、業務更新だけ成功して通知依頼だけ失われる状態を避けます。

outboxは`pending`、`sending`、`sent`、`failed`、`unknown`の状態を持ちます。

workerはdue状態の行をclaimし、外部送信をtransactionの外で実行した後、attempt tokenとleaseを検証して結果を確定します。

送信失敗は上限付きで再試行し、providerの送達結果を確認できない場合は`unknown`へ遷移させます。

`unknown`を自動的に`sent`または`failed`へ変更せず、provider側の送達確認と管理者による再照合の運用を完了条件とします。

workerは利用者向けHTTP endpointから起動せず、専用の内部実行経路とDB roleを使用します。

通知本文、providerのレスポンス本文、access token、Webhook raw body、個人情報をログや監査metadataへ保存しません。

## tenantとgroupの境界

接続済みgroup IDは一つのtenantにだけ紐付けます。

別tenantが同じgroup IDを接続しようとした場合は競合として拒否します。

通知登録時には接続時刻をoutboxへ保存し、切断後に別groupへ再接続しても古い通知を新しいgroupへ転送しません。

送信直前にもtenantとgroupの接続世代を検証し、送信中にgroupが別tenantへ再利用された場合は安全側へ倒して`unknown`へ収束させます。

## Webhookの受信境界

Webhookはraw bodyと`x-line-signature`をchannel secretのHMAC-SHA256で検証します。

署名検証に成功した後、payloadの`destination`を環境固定値と比較します。

イベントの`source.groupId`から接続済みtenantを解決し、未知または解除済みのgroupは無視します。

`group_id`と`webhook_event_id`の組み合わせをreceiptへ保存し、同じイベントを二度処理しません。

Webhook受信は専用の`line_webhook_receiver` DB roleとSECURITY DEFINER関数を使い、通常の`cocolo_app`からreceiptを直接変更できない境界にします。

Webhookは受信と重複排除の入口であり、受信内容だけで予定、出欠、回覧、集金の状態を更新しません。

## deep linkとLIFF

通知リンクは、通知対象と同じ環境のCoCoLo画面へ遷移させます。

通常のリンクは`PUBLIC_APP_URL`を基準に、予定または回覧画面の固定パスへサーバー側で生成します。

LIFFを使う場合は、登録済みの`LINE_LIFF_ID`と許可されたstateからリンクを生成します。

リンク先ではログイン状態、active membership、選択チーム、対象資源の権限を再確認します。

URLのqueryへtenant ID、個人情報、長期tokenを含めません。

中央producerは通知元資源の存在、公開済み回覧、通知元tenantの一致、UUIDv7、deep linkの固定パスをサーバー側で検証します。workerも送信前に同じ通知元境界を再検証し、旧形式または不正なoutbox行は送信せず隔離します。

## 環境設定

| 変数 | local | staging / production | 管理方法 |
| --- | --- | --- | --- |
| `LINE_CHANNEL_SECRET` | fake値またはlocal channel | 環境専用のchannel secret | API専用secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | fake adapter使用時は不要 | 環境専用のchannel access token | API専用secret |
| `LINE_WEBHOOK_DESTINATION` | fake payloadと一致させる | LINE channelのdestination | 環境ごとのvariable |
| `LINE_LIFF_ID` | 未設定可 | LIFFを使う場合だけ設定 | 許可値として管理 |
| `PUBLIC_APP_URL` | local URL | 環境専用のHTTPS URL | 許可originとして管理 |

localとunit testはfake adapterを使い、実LINEへ接続しません。

stagingとproductionでchannel secret、access token、group ID、Webhook destination、公開URLを共有しません。

値が未設定の環境で実LINE adapterを起動せず、未接続を送信成功として表示しません。

## developで完了した範囲

- 中央APIへの接続状態、接続、切断のmount
- 接続groupとtenantの一意性および接続世代の検証
- 予定作成と更新からのevent、deadline通知outbox登録
- 回覧掲載からのbulletin通知outbox登録（owner/admin/staff、PR #183）
- 汎用通知登録とowner/adminの再送API
- workerのclaim、lease、provider retry key、失敗およびunknown遷移
- Webhookの公開入口、署名、destination、未知group、重複receiptの検証
- Web画面の接続状態表示、owner/admin向け接続操作、owner/admin向け汎用通知登録
- 中央producerの通知元resource・tenant・deep link検証、team feature flag、旧outbox隔離
- Webの予定・回覧deep link、OAuth復帰、複数チーム時の選択、403/404時の安全な再選択画面

## 残作業と受入条件

- [ ] staging専用channelとテスト用groupを用意し、Bot参加、group ID取得、接続、切断を確認する。
- [ ] 予定作成、予定更新、出欠締切、provider成功、provider 4xx、timeout、送達不明、管理者再送をstagingで確認する。
- [ ] 不正署名、destination不一致、未知group、解除済みgroup、重複Webhook、別tenant接続を拒否または無視することを確認する。
- [ ] `unknown`のprovider照合、保持期間、再送可否、監査記録、担当者を運用手順へ定義する。
- [x] 通知deep linkの予定・回覧画面、未ログイン時のOAuth復帰、複数チーム時の選択、403/404時の安全な再選択画面を実装する（PR #179）。
- [ ] stagingでLIFF不可端末、通常ブラウザ、セッション期限切れ、対象外チーム、削除済み資源の表示を受入する。
- [ ] staffの汎用通知登録を許可するか、owner/admin限定を正式仕様とするかを決定し、機能仕様、API、Web、RLS、テストを一致させる。
- [x] 回覧掲載時の通知producerの対象、権限、固定本文、冪等キー、deep linkを実装する（PR #183）。
- [ ] 未払い通知producerの対象、個別メンバー通知先、対象者限定deep link、権限、冪等キーを定義・実装する。
- [ ] staging成功SHA、migration checksum、adapter設定、Webhook疎通、E2E結果をrelease証跡へ保存する。
