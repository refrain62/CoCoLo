# Phase 4 の LINE 通知を統合する

## 対象範囲

この文書は FS-NOT-001 の LINE 通知機能を、既存の認証、予定、締切、回覧の機能へ統合するための契約を定めます。

LINE の接続状態、グループ ID の tenant 紐付け、通知キュー、送信失敗、Webhook、LIFF リンクを対象にします。

今回の feature branch は `apps/api/src/app.ts`、`apps/web/src/main.tsx`、Prisma schema、共有 index を変更しません。

中央の起動処理への mount と LINE 専用 migration は、次の統合担当がこの文書の順序で行います。

## 実装モジュール

| 層 | 実装 | 責務 |
| --- | --- | --- |
| Contract | `packages/contracts/src/line-contract.ts` | group ID、通知元、Webhook の入力形式を検証する |
| Domain | `packages/domain/src/line-domain.ts` | 状態、再試行間隔、同一環境リンク、LIFF state を定義する |
| DB repository | `packages/db/src/line-repository.ts` | tenant 条件付き SQL と local 用 in-memory 実装を提供する |
| API | `apps/api/src/features/line-notifications/` | 認証、権限、署名、キュー、送信アダプターを統合する |
| Web | `apps/web/src/features/line-notifications/` | 未接続表示、接続操作、通知登録を提供する |

API の feature app は `createLineNotificationApp` で生成します。

既存の Hono app へ mount すると、次の endpoint が有効になります。

```ts
const lineApp = createLineNotificationApp({
  verifyToken,
  findActiveMembership,
  service: lineNotificationService,
});

app.route('/', lineApp);
```

この mount は既存 app の認証 middleware と同じ JWT 検証、active membership 解決を渡してから行います。

## 認証と tenant 境界

`tenantId` は接続、通知登録、再試行の HTTP body に含めません。

API は JWT subject から active membership を解決し、repository へ `tenantId` と `userId` を渡します。

owner と admin だけが LINE グループの接続と解除、通知の手動再試行を行えます。

owner、admin、staff は予定、締切、回覧の通知をキューへ登録できます。

guardian は LINE 接続と通知登録を行えません。

接続済み group ID は一つの tenant にだけ割り当てます。

別 tenant が同じ group ID を接続しようとした場合は競合として拒否します。

Web の status レスポンスは staff と guardian へ group ID を返さず、接続状態だけを返します。

## 接続状態と通知キュー

接続情報がない場合や解除済みの場合は `disconnected` を返します。

未接続時の通知登録はエラーではなく `not_connected` を返し、キューへ行を作りません。

接続済みの通知は `pending` でキューへ入り、配信 worker が claim すると `sending` になります。

送信成功時は `sent`、送信失敗時は `failed` とし、`attempts`、`lastError`、`nextRetryAt` を保存します。

再試行間隔は 1 秒から始まる指数バックオフで、最大 1 時間に制限します。

最大 5 回に達した通知は自動 claim の対象外となり、管理者の手動再試行も許可しません。

配信 worker は認証済み利用者向けの HTTP endpoint にせず、内部 job から `service.deliverOne` を呼び出します。

この worker は全 tenant の due queue を処理するため、owner や admin のリクエストから起動できる route を公開しません。

送信失敗の詳細には provider のレスポンス本文や access token を保存しません。

## LINE Messaging API

production と staging は `createLineMessagingAdapter` に channel access token を渡します。

local と unit test は `createFakeLineAdapter` を使い、実 LINE へ接続しません。

実 adapter は `POST https://api.line.me/v2/bot/message/push` へ group ID と text message を送信します。

`LINE_CHANNEL_ACCESS_TOKEN` は API 専用 secret とし、Web、ログ、成果物へ出力しません。

通知本文には個人情報を含めず、予定、締切、回覧の共通公開情報と同一環境のリンクだけを渡します。

## Webhook の検証

Webhook endpoint は `POST /api/v1/line/webhook` です。

API は受信した raw body と `x-line-signature` を channel secret の HMAC-SHA256 で比較します。

署名検証に失敗した body は JSON を処理せず、`401` として破棄します。

署名検証後も `destination` を設定値と比較し、別 channel の payload を受け付けません。

イベントの `source.groupId` から接続済み tenant を解決し、未接続または未知の group は無視します。

`groupId` と `webhookEventId` の組み合わせを repository へ保存し、同じ組み合わせは二度処理しません。

Webhook の応答に tenant ID、user ID、受信本文を含めません。

## 予定、締切、回覧との統合境界

予定、締切、回覧の各機能は LINE の内部 repository を直接参照せず、`buildLineNotificationInput` で通知 DTO を作ります。

通知元は `event`、`deadline`、`bulletin` のいずれかです。

通知元 ID、タイトル、本文、同一環境のリンクを DTO に設定し、認証済みの実行者として `service.enqueue` を呼び出します。

各機能は通知の送信結果を自分の状態遷移へ直接反映せず、通知キューの ID と状態を参照します。

予定や回覧の保存が失敗した場合は通知を登録せず、通知だけが先に送信される状態を作りません。

同じ通知元の再通知を許可するかどうかは、予定、締切、回覧ごとの業務仕様で決めます。

## LIFF と deep link

通常のリンクは `PUBLIC_APP_URL` と同じ origin の `/events/:id` または `/bulletins/:id` に限定します。

LIFF を使う場合は `buildLineLiffLink` が `https://liff.line.me/:liffId` と許可された `liff.state` を作ります。

API は登録された LIFF ID、LINE の origin、通知元と一致する `events` または `bulletins` の state 形式を検証します。

LIFF 起動後の Web は `liff.state` を画面遷移先として使う前に、ログイン状態と active membership を確認します。

URL の query へ tenant ID や個人情報を含めません。

## LINE 専用 DB migration の統合契約

この feature branch は Prisma schema を変更しないため、次の表は設計契約として残します。

統合担当は PostgreSQL 17 の migration で表、RLS、権限、tenant 条件、複合制約を追加してから SQL repository を有効化します。

必要な表は次のとおりです。

| 表 | 必須列と制約 |
| --- | --- |
| `line_connections` | `tenant_id`、`group_id`、`status`、`connected_at`、`updated_at`。connected 状態の `group_id` は tenant をまたいで一意 |
| `line_notification_queue` | `tenant_id`、送信対象 `group_id`、`created_by_user_id`、`source_type`、`source_id`、`title`、`body`、`deep_link`、`status`、`attempts`、`next_retry_at`、provider ID、エラー、時刻 |
| `line_webhook_receipts` | `tenant_id`、`group_id`、`webhook_event_id`、`received_at`。`group_id + webhook_event_id` を一意 |

すべての表へ RLS を有効化し、API の transaction-local context と一致する tenant だけを参照・変更できるようにします。

queue の claim、送信結果更新、接続解除と登録の競合は、同じ tenant を直列化する transaction または advisory lock で保護します。

queue 作成時の `group_id` は送信対象を固定するため、接続解除後に別 group へ再接続しても古い通知を新 group へ転送しません。

`line_notification_queue` の本文は個人情報を含めない業務公開情報に限定し、保持期間、削除、バックアップ対象を migration review で決定します。

DB を Supabase PostgreSQL から分離する場合も、LINE の外部 ID、queue 状態、Webhook 重複排除 ID を値として移行し、Auth schema を移行対象にしません。

## 環境設定

| 変数 | local | staging / production | 管理方法 |
| --- | --- | --- | --- |
| `LINE_CHANNEL_SECRET` | fake 値または local channel | 各環境の channel secret | API 専用 secret |
| `LINE_CHANNEL_ACCESS_TOKEN` | fake adapter 使用時は不要 | 各環境の channel access token | API 専用 secret |
| `LINE_WEBHOOK_DESTINATION` | fake payload と一致させる | LINE channel の destination | 環境ごとの variable |
| `LINE_LIFF_ID` | 未設定可 | LIFF を使う場合だけ設定 | API の許可値。Webへ公開する場合も state 検証を省略しない |

値が未設定の環境で実 LINE adapter を起動せず、local は fake adapter へ明示的に切り替えます。

staging と production で channel secret、access token、group ID を共有しません。

## 統合前の確認

- [ ] Central app へ feature app を mount し、既存 JWT と active membership を渡した。
- [ ] LINE 専用 migration の RLS、connected group の一意制約、Webhook 重複制約を実 PostgreSQL で確認した。
- [ ] staging の専用 LINE channel と専用 group で、接続、未接続、通知登録、送信、失敗、再試行を確認した。
- [ ] 不正署名、destination 不一致、未知 group、重複 webhook、別 tenant の通知参照を拒否した。
- [ ] 通知本文、ログ、監査 metadata、Webhook 応答へ個人情報と秘密情報が混入しないことを確認した。
- [ ] LIFF を使う場合は、state 改ざん、未ログイン、停止済み所属、別 tenant の画面遷移を確認した。
- [ ] staging 成功 SHA、migration checksum、adapter 設定、E2E 結果を release 証跡へ保存した。
