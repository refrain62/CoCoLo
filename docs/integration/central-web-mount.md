# 中央Webの画面接続

この文書は、`integration/all-features` のコミット `28109444f9b16b72d50e750554eee0b365f61ce7` を起点に、中央Webの起動点へ既存feature画面を接続する条件を記録します。

実装ブランチは `integration/web-mount` です。

## 実装範囲

中央Webは `apps/web/src/main.tsx` から認証済み `session` を `CentralNavigation` へ渡します。

feature画面へ渡すAPI clientは、保存済みのtokenを読み直さず、`useAuth().authenticatedFetch`を通信入口として利用します。

期限前更新または401後の一回だけのrefresh retryは、Auth session managerへ集約します。

tenant IDをURL、query、body、画面のチーム選択値へ渡しません。

中央Webは、中央APIがtokenから解決した所属情報だけを利用します。

## 画面URL

| URL | 画面 | 現在の扱い |
| --- | --- | --- |
| `/` | トップ | 中央ナビゲーションを表示 |
| `/members` | 部員管理 | ownerまたはadminだけに表示 |
| `/events` | 予定と出欠 | `EventsPage`を接続 |
| `/events/:eventId` | 予定詳細 | UUIDv7を検証し、`EventDetailPage`を接続 |
| `/board-contacts` | 役員と連絡先 | ownerまたはadminだけに表示 |
| `/orders` | 共同購買と集金 | `OrdersPaymentsPage`を接続 |
| `/attachments` | 添付 | `AttachmentUploader`を接続 |
| `/line` | LINE通知 | `LineNotificationPanel`を接続 |
| `/ride/:planId` | 送迎 | UUIDv7の `planId` を検証して接続 |
| `/bulletins` | 回覧板 | Web画面と中央APIを接続 |
| `/team-selection` | チーム選択 | Web画面と`/api/v1/auth` APIを接続 |
| `/manual` | 操作マニュアル | 認証前後に表示可能 |

共同購買、添付、回覧板の詳細URLは、UUIDv7を検証した後に詳細画面未接続として表示します。

予定詳細は、同じBearer tokenで`GET /api/v1/events/:eventId`を呼び出し、所属tenant内の予定だけを表示します。

詳細画面を一覧画面へ黙って置き換えることはしません。

UUIDv7でない `planId` や詳細資源IDは、APIへ渡さずエラー表示にします。

## 認証と所属

認証前の直接URLは機能画面へ進まず、`AuthProvider` のログイン画面を表示します。

認証後の中央Webは `GET /api/v1/session` から `{ data: { tenantId, role } }` を取得する契約を使用します。

このendpointは中央APIへ実装済みです。

応答が取得できない場合は、所属情報を確認できない状態として機能画面を表示しません。

応答の `tenantId` はUUIDv7として検証しますが、画面へ描画しません。

roleは中央APIの所属解決結果だけを使用し、画面上にrole選択UIを用意しません。

部員選択肢は、同じBearer tokenと選択済みtenant headerで取得した部員APIの結果だけから作成します。

別tenantの部員IDを画面状態へ追加する入力欄はありません。

## 権限表示

部員管理と役員連絡先は、既存feature画面が編集操作を含むため、ownerまたはadmin以外には画面を表示しません。

予定、共同購買、LINE通知、送迎のroleは中央APIの所属結果をpropsへ渡します。

送迎の管理表示は owner、admin、staff に限定します。

画面上の権限表示は操作補助であり、最終的な認可は各APIとDB境界で行います。

## 状態表示

所属情報の読み込み中は機能画面を表示せず、読み込み中の状態を表示します。

所属情報の取得失敗は空データとして扱いません。

担当部員の取得中または取得失敗時も、担当部員がいないという空状態へ置き換えません。

各feature画面の読み込み中、空、通信エラーはfeature画面自身の状態表示へ委譲します。

feature APIは中央 `apps/api/src/app.ts` へmount済みですが、環境依存性が未設定の場合はAPIの503を画面側でエラーとして表示します。

この注意表示は、feature画面やデータ操作が本番接続済みであることを意味しません。

### LINE

LINEのstatus APIが応答するまで、接続済みまたは未接続のどちらにも確定しません。

status APIが未接続を返した場合だけ、LINE featureの「未接続」を表示します。

中央Webはchannel secret、channel access token、group IDを生成または保存しません。

### R2

R2へのPUTが成功し、complete APIが `available` を返した場合だけアップロード成功を表示します。

中央APIまたは署名URLへの接続失敗は、添付成功や空状態へ置き換えません。

R2のsecret、object key、公開URLはWebへ渡しません。

## PR #30とPR #31の接続条件

PR #30からWeb画面とAPI clientだけを `apps/web/src/features/bulletin-board/` へ取り込みました。

中央navigationは `createBulletinBoardApi` へ現在のsession tokenを渡し、`BulletinBoardPage` へ中央roleを渡します。

回覧板API、DB migration、RLS、添付ダウンロードは中央API統合へ接続済みです。

PR #31のチーム選択画面、API client、UUIDv7契約を `apps/web/src/features/auth-team-selection/` と `packages/contracts/src/auth-team-selection-contract.ts` へ取り込みました。

Web clientの一覧・選択pathは、中央APIを `/api/v1/auth` へmountした場合の `GET /api/v1/auth/teams` と `POST /api/v1/auth/teams/select` に固定しています。

選択後のtenant IDだけをsessionStorageへ保存し、再読み込み時は同じBearer tokenで取得したactive所属一覧に一致した場合だけ復元します。

選択結果は認可根拠にせず、中央APIはuser IDとtenant IDのactive membershipを毎回再検証します。

中央Webのfeature requestには `X-CoCoLo-Team-Id` を付けますが、API側でJWTとmembershipを再検証できない間は業務画面を表示しません。

`auth-context` のsession refresh/logoutは `AuthProvider` と中央navigationへ接続済みです。

ログアウトはAuthenticated画面の中央navigationから実行し、失敗時も先に画面上のsessionを消去します。

## 中央API統合後の作業

中央API統合担当は次の順に接続します。

1. `GET /api/v1/session` を既存のJWT検証とactive membership解決へ接続する。
2. feature APIを既存の認証middleware後へmountする。
3. APIへ `createAuthTeamSelectionApp()` を `/api/v1/auth` でmountする。
4. PR #31の選択結果を中央所属状態へ接続し、業務APIで `X-CoCoLo-Team-Id` を再検証する。
5. `apps/api` のOpenAPIと実PostgreSQL migrationを更新する。
6. tenant A、tenant B、owner、admin、staff、guardianで画面とAPIの境界を検証する。
7. stagingのSupabase Auth、R2、LINE、回覧板、チーム切り替えを実E2Eで確認する。

## 検証

中央routeの直接URL、未認証、unknown path、UUIDv7境界、所属APIへのtenant非注入を `apps/web/src/central-navigation.vitest.ts` で検証します。

feature API、OpenAPI、DB migration、実LINE、実R2の接続は、このブランチの検証範囲に含めません。

予定詳細はUUIDv7を検証したうえで中央APIへ接続します。

共同購買、添付、回覧板の詳細画面は、UUIDv7を検証したうえで未接続表示を返します。

中央Webの追加後に、対象テスト、domainとUIのbuild、Web typecheck、リポジトリ全体buildを実行します。

リポジトリ全体のVitestは17ファイル51件が成功しました。

リポジトリ全体testは、統合ベースが `apps/api/src/app.ts` から部員編集と退部routeを除外しているため、既存の `apps/api/test/members.test.ts` 4件が404または非JSON応答で失敗します。

リポジトリ全体lintは、統合ベースのBiome設定でルート指定時に処理対象が0件となり失敗します。

リポジトリ全体typecheckは、同じ部員編集と退部route除外に対して既存APIテストが `MemberRepository.update` 型を参照するため失敗します。

これらは中央Webの許可範囲外であり、中央API統合時にroute、テスト、Biome設定を同じ変更単位で整合させます。
