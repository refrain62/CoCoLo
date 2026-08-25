# 中央DBスキーマの統合契約

この文書は、`origin/develop`の`61ec4f8`を起点に追加した中央DBスキーマの契約を記録する。

対象はFS-EVT、FS-BRD、FS-ORD、FS-FIL、FS-ANN、FS-NOT、FS-RIDEである。

既存のPhase 1、Phase 2、Phase 4、LINE security migrationを先に適用し、その後に`20260823150000_central_feature_schema`を適用する。

既存Phaseで作成済みのevents、attendance_responses、attachments、announcements系は中央migrationで再作成せず、既存DDLを正本として追加index、UUIDv7制約、RLS境界だけを適用する。

## 参照した機能契約

| 機能 | 確認したrepositoryまたは契約 | DB上の主要表 |
| --- | --- | --- |
| FS-EVT | 機能仕様と中央repository | `events`、`attendance_responses` |
| FS-BRD | `phase3-board-contact`の中央repository | `board_contacts` |
| FS-ORD | `phase3-orders-payments`のcontractとrepository | `purchase_orders`、`order_products`、`order_entries`、`order_lines`、`order_idempotency_keys` |
| FS-FIL | `phase4-r2-attachments`のrepository | `attachments` |
| FS-ANN | `phase4-bulletin-board`のrepositoryとcontract | `announcements`、`announcement_attachments`、`announcement_reads` |
| FS-NOT | `phase4-line-notifications`のrepositoryとworker | `line_connections`、`line_delivery_outbox`、`line_webhook_receipts` |
| FS-RIDE | `phase5-ride-operations`のrepository | `ride_plans`、`ride_offers`、`ride_requests`、`ride_assignments` |

FS-ORDだけは、確認時点で永続SQL repositoryが存在しない。

そのため、注文表の名前と分割はcontract、domain型、統合メモの不変条件をDB境界へ写像した暫定契約であり、SQL adapter実装時にこの文書と照合する。

旧計画書にある連番の`orders`、`order_items`、`user_order_items`は採用しない。

現行contractが扱うUUIDv7、複数商品明細、支払状態、冪等キーを表現できないためである。

## 共通のDB不変条件

### UUIDv7

内部資源の主キーと監査IDはUUIDv7で生成する。

LINE通知キュー以外は、APIまたはPrismaの生成器がINSERT前にIDを生成する。

LINE通知キューだけは、既存SQL repositoryがIDをINSERTしない契約のため、migrationの`app_uuidv7()`をDEFAULTにしてDB側で生成する。

この例外を他の表へ拡張せず、ID生成責務を表ごとに一つへ固定する。

中央migrationは`app_is_uuidv7`と各表のCHECK制約で、version nibbleが7でないIDを拒否する。

既存Phase 1表にも同じ制約を追加するため、過去データを移行する場合は先にUUIDv7への変換計画と照合結果を用意する。

### テナント複合参照

Tenant以外の資源表は`tenant_id`を持ち、資源IDとの複合UNIQUEを参照先として公開する。

イベントと出欠、注文と明細、添付と回覧、送迎のplan、request、offer、assignmentは、すべて`(tenant_id, 資源ID)`の複合外部キーで関連付ける。

この制約は、別テナントのIDを知っているだけで関連行を作成できる状態を防ぐ。

### RLS context

API接続は、各transactionの開始時に次のtransaction-local設定を入れる。

```sql
SELECT
  set_config('app.tenant_id', $1, true),
  set_config('app.user_id', $2, true),
  set_config('app.role', $3, true);
```

LINE SQL repositoryを含むすべてのDB adapterは、上記3値を設定したtransaction clientを受け取り、同じtransaction内で検索、INSERT、状態更新、監査を完了させる。

repository単体がtenantIdやcreatedByUserIdからroleを推測してcontextへ設定してはならない。

context設定を省略した接続は、RLSにより行を返さず、書き込みも成立しない。

回覧の掲載者が未読者一覧を読むときだけ、同じtransaction内で`app.announcement_id`も設定する。

すべての対象表に`ENABLE ROW LEVEL SECURITY`と`FORCE ROW LEVEL SECURITY`を設定する。

RLS policyは、contextのtenantとactiveなTenantMembershipのuser、role、statusを照合する。

context未設定、tenant不一致、roleと所属の不一致は、行を返さず、書き込みも許可しない。

RLSだけに依存せず、repositoryのSQLにもtenant条件を残す。

### 役割別の境界

| 対象 | owner、admin | staff | guardian |
| --- | --- | --- | --- |
| 予定 | 登録、編集、閲覧、集計 | 登録、編集、閲覧、集計 | 閲覧、担当部員の出欠 |
| 役員連絡先 | 管理、全項目の取得 | 役職枠の閲覧 | 役職枠の閲覧 |
| 購買 | 管理、支払、集計、CSV | 拒否 | 自分の注文と担当部員の注文 |
| 添付 | tenant内の管理 | tenant内の管理 | 自分が所有する行 |
| 回覧 | 掲載、閲覧、既読 | 掲載、閲覧、既読 | 閲覧、既読 |
| LINE | 接続、解除、再送、通知 | 通知登録、閲覧 | 拒否 |
| 送迎 | 管理、割当、閲覧 | 管理、割当、閲覧 | 自分の車、担当部員の希望、許可された結果 |

staff、guardianが役員連絡先の行を読めることは、連絡先の値を返してよいことを意味しない。

現行の`cocolo_app`は一つのDB roleであり、PostgreSQLのcolumn privilegeだけではrole別に同じ行の電話番号を隠せないため、電話番号とLINE連絡先の投影はAPIのDTOで行う。

中央API統合時には、staff、guardianのレスポンスに`phone`、`lineContact`を含めないテストを必須とする。

## 機能別の状態と制約

### 予定と出欠

`events`は終了時刻が開始時刻より後、出欠締切と集合時刻が開始時刻以前であることをCHECKで保証する。

試合には空でない対戦相手を要求する。

`attendance_responses`は同じtenant、イベント、回答者、部員の組み合わせを一意にする。

guardianのSELECT、INSERT、UPDATEは`guardian_members`の担当関係までRLSで確認する。

締切時刻と締切後の修正理由はrepositoryがDBの`now()`と監査ログを使って確定する。

### 役員と連絡先

`board_contacts`は年度と役職名をtenant内で一意にする。

担当者IDは同じtenantのmembershipへ複合外部キーで参照するが、active状態までは外部キーで表現できないため、repositoryがtransaction内で再確認する。

年度引き継ぎの直列化と、連絡先の値を監査metadataへ複製しない方針はrepository契約で維持する。

### 購買と集金

金額はPostgreSQLの`bigint`で保持し、APIの安全整数上限をCHECKで再確認する。

`order_lines`の単価、商品名、商品所属案件はtriggerで商品定義と照合する。

明細金額は`unit_price * quantity`と一致し、注文合計はdeferred constraint triggerで明細合計と一致する必要がある。

募集案件は`open → closed → completed`だけを許可する。

支払状態は`unpaid ↔ paid`を許可し、`paid`には確認日時と確認者を要求し、`unpaid`では確認情報を消去する。

`order_idempotency_keys`はtenant、実行者、キーの組み合わせを一意にし、request hashと結果資源を保存する。

### 添付とR2

`attachments`にはtenant、所有者、内部object key、宣言MIME、サイズ、SHA-256、検証状態、期限、cleanup試行回数だけを保存する。

R2のファイル本体、公開URL、署名秘密情報はDBへ保存しない。

状態は`uploaded → available`または`uploaded → rejected`とし、cleanup完了時の`deleted`を許可する。

完了検証の同時実行は、repositoryの`FOR UPDATE`と状態triggerで直列化する。

MIME、マジックバイト、実体サイズ、SHA-256の検証はR2 adapterとdomainの責務であり、DBのMIME CHECKだけで代替しない。

### 回覧と既読

`announcements`は掲載者、本文、公開状態、掲載時刻を保持する。

`announcement_attachments`は同じtenantの`available`添付へ複合外部キーで参照し、表示順を一意にする。

`announcement_reads`はtenant、回覧、利用者を複合主キーにし、同時既読を`ON CONFLICT DO NOTHING`で吸収する。

掲載者の未読者一覧は、APIが掲載者本人であることを確認して`app.announcement_id`を設定した後に読む。

### LINE通知

`line_connections`はtenantごとに一行とし、connected状態のgroup IDをtenant横断で一意にする。

`line_notification_queue`は送信対象group IDを行へ固定するため、再接続後に古い通知を新しいgroupへ転送しない。

通知IDは`app_uuidv7()`をDEFAULTとしてSQL側で生成するため、LINE SQL repositoryはINSERTで`id`を指定しない。

既存groupの未送信行がある状態で再接続する場合は、先に旧行を失敗または破棄する運用transactionが必要である。

`line_notification_queue`の状態は`pending → sending → sent/failed`、`failed → pending`だけを許可し、attemptsは5回を上限とする。

`line_webhook_receipts`は`group_id + webhook_event_id`を一意にして重複Webhookを排除する。

channel secret、channel access token、Webhookのraw bodyはDBへ保存しない。

### 送迎

送迎のplan、offer、request、assignmentはすべてtenant付き複合外部キーで参照する。

乗車希望は担当部員に限定し、assignmentは一つのrequestへ一件だけ許可する。

assignment triggerはplan単位のtransaction advisory lockを取得し、request人数とoffer定員を同時に確認する。

Google Maps URLのホスト、scheme、port、fragmentの最終検証はcontractとdomainで行い、DBの形式CHECKは補助制約である。

## 外部サービスとの責務境界

Supabase Authのuser IDは`varchar(128)`の不透明なsubjectとして保存する。

Supabase Authのユーザー表、refresh token、password、Service Role Keyはこのmigrationの対象外である。

Cloudflare R2は添付の本体と署名URLを担当し、DBは認可に必要なメタデータと状態だけを担当する。

LINE Messaging APIは送信とWebhookの外部識別子を担当し、DBは接続先、送信キュー、再試行状態、重複排除記録だけを担当する。

外部サービス障害時にも、DBの状態遷移と監査はtransaction単位で一貫させ、外部APIのレスポンス本文や秘密情報を監査へ保存しない。

## 将来のDB分離で変えない契約

Supabase PostgreSQLから別のPostgreSQLへ分離するときも、次の値と意味を移行対象にする。

* UUIDv7の資源IDとtenant ID
* tenant付き複合外部キーと一意制約
* enumの値と状態遷移
* `created_at`、状態変更時刻、支払確認時刻、既読時刻
* 監査ログのappend-only属性とmetadataの許可範囲
* R2 object key、MIME、サイズ、SHA-256、添付状態
* LINE group ID、Webhook event ID、通知queueのattemptsと状態

Supabase Authの内部schemaは移行しない。

移行先では、アプリ用roleにBYPASSRLSを付与せず、同じtransaction-local contextとgrantを再現する。

移行手順は、migration checksum、row count、tenant別件数、複合FK違反、状態別件数、監査件数、添付object metadata、LINE重複排除IDを照合してからread切替を行う。

R2本体とLINE外部設定はDB dumpへ含めず、環境別の設定台帳と別の疎通検証で切り替える。

## 未確定事項と中央統合時の条件

次の事項は、このDB schemaだけで完了したとは扱わない。

1. FS-ORDの永続repositoryは未実装である。
   `purchase_orders`系の列とtriggerをSQL adapterが使うことを、注文機能の中央統合時に確認する。
2. board-contactとbulletin-boardの一部repositoryは、現在`gen_random_uuid()`または`randomUUID()`を使う。
   UUIDv7 CHECKを満たす生成器へ交換してからrouteをmountする。
3. LINE SQL repositoryは、確認した実装ではtransaction-local RLS contextの設定を内部で行わない。
   接続、queue claim、送信結果更新、Webhook重複排除を、contextを設定済みのtransaction clientへ包むadapterが必要である。
   DB roleをBYPASSRLSへ変更して回避してはならない。
4. 回覧掲載時の添付参照は`available`状態をrepositoryが照合する。
   migrationの外部キーはtenant境界を保証し、状態照合はrepositoryの責務として残す。
5. `cocolo_app`は単一roleである。
   役員連絡先の列投影、LINE group IDの非表示、送迎の識別子投影は中央APIのresponse DTOで検証する。
6. fresh DBへの修正版migration再適用と、接続中断時のtransaction再試行は、Dockerまたはstaging DBを接続できる環境で追加確認する。

この未確定事項は外部サービスの実接続を推測で完了扱いにしないための統合条件である。
