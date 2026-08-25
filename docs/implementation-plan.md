# CoCoLo 実装計画

更新日：2026-08-26

## この文書の役割

この文書は、技術境界と実装順を定める「どう作るか」の正本です。

機能の振る舞い、権限、状態遷移、受け入れ条件は[機能仕様書](functional-specification.md)に置き、未完了タスクは[中断再開タスクリスト](resume-task-list.md)に置きます。

完了済みの実装とレビューは[完了履歴](resume-task-history.md)、検証コマンドと失敗条件は[検証手順書](verification-runbook.md)を参照します。

企画時の要求との差分は[当初要求トレーサビリティ](original-requirements-traceability.md)で管理します。

## 技術境界

| 領域 | 採用 | 境界 |
| --- | --- | --- |
| Web | Vite、React、TypeScript | `packages/contracts` と`packages/ui`だけを参照し、DB・秘密情報・API実装へ直接依存しない |
| API | Hono、Node.js 24 | 認証、tenant解決、feature契約、認可、レート制限、監査、レスポンス契約を入口で強制する |
| DB | Supabase PostgreSQL、Prisma | `packages/db`だけがschema、migration、repositoryを所有する |
| 認証 | Supabase Auth | WebはBearer tokenを送り、LINE・Google OAuthのprovider subjectを利用し、Service Role Keyはサーバーだけが扱う |
| 契約 | Zod、OpenAPI 3.1 | 公開DTOを生成元とし、DB modelをそのまま公開しない |
| 機能契約 | チーム単位のplanとfeature flag | UI、API、workerが同じeffective entitlementを参照し、判定不能時は無効にする |
| 添付 | Cloudflare R2 | 非公開bucketへ保存し、認可後に短期URLを発行する |
| テスト | Vitest、Node test、Playwright | local実DBとstaging接続を分離し、外部サービス未接続を成功扱いにしない |

WebとAPIの公開経路は`/api/v1`のHTTPS JSON APIです。

全ての業務データはtenantと利用者の所属を境界にし、DBのRLSをAPIの認可と併用します。

IDはUUIDv7、tenantに属する参照はtenantを含む複合制約で検査します。

## 機能契約とfeature flag

有償・無償の区別は、画面の表示制御ではなく、チームごとの機能契約として管理します。

最初の実装では、次の三つを分離します。

| 概念 | 責務 |
| --- | --- |
| `feature_definitions` | 機能キー、無償・有償区分、初期値、依存機能、公開名を管理する |
| `tenant_plans` | チームのプラン、状態、適用期間、課金連携IDを管理する。課金providerは後から差し替えられる |
| `tenant_feature_flags` | チーム単位の有効・無効、付与元、変更者、変更理由、適用期間を管理する |

APIは選択中tenantのplanとflagを評価した`effective entitlement`だけを参照します。

Webはその結果からメニューと画面を構成しますが、APIとworkerも同じ判定を実行します。

未知のfeature key、期限切れの契約、課金状態を確認できない有償機能は無効として扱います。

無料機能の切り替えはownerまたは許可されたadminに限定し、有償機能の手動付与は運用者の承認記録と課金状態を要求します。

feature flagの変更、planの変更、契約状態の同期は監査ログへ記録し、キャッシュを使う場合もtenantとfeature keyをキーにして変更時に無効化します。

## 招待とOAuth

招待は、チーム、対象メンバー、付与する所属role、有効期限、発行者、使用状態を持つ一回限りのレコードとして実装します。

招待URLには短期のopaque tokenだけを含め、tokenへtenant ID、member ID、role、個人情報を埋め込みません。

利用者は招待URLを開き、Supabase AuthのLINEまたはGoogle OAuthで認証してから、招待対象とprovider subjectの紐付けを確定します。

OAuthのメールアドレスを本人識別の主キーにせず、`provider`と`provider_subject`の一意制約をアプリDB側へ持たせます。

OAuthアカウント、tenant membership、対象メンバー連携は別テーブルに分離し、同一アカウントの複数team所属と、複数guardianの一人のmemberへの連携を表現します。

## メンバー単位の業務操作

出欠、注文、送迎希望などの業務テーブルには、操作した利用者を示す`actor_user_id`と、業務対象を示す`subject_member_id`を別々に保存します。

APIはリクエストの`subject_member_id`を、選択中tenantと有効なmember linkから再認可します。

利用者が複数メンバーへ連携されている場合、Webは保存前に対象メンバーを選択させ、一覧、確認、履歴、通知の対象も同じmember単位で表示します。

既存のguardian向け処理を本人OAuthへ拡張する際も、tenant境界、締切、冪等性、監査の契約を共通化し、権限だけを画面で切り替えません。

## 管理画面と共通UI

管理画面は単一画面の条件分岐を増やさず、`/admin`配下のルートと機能メニューへ分割します。

最低限、ダッシュボード、メンバー、予定・出欠、購買・集金、回覧・添付、LINE、チーム設定、機能契約を独立した画面として構成します。

メニューはroleとeffective entitlementから生成し、利用不可の画面を操作可能に見せません。

`packages/ui`へshadcn/uiの設計思想に沿った共通コンポーネント、デザイントークン、状態表示、フォーム、テーブル、ダイアログ、メンバー選択を集約します。

画面固有のinline styleと独自色を増やさず、loading、empty、error、success、forbidden、disabled、未契約を同じ状態モデルで表示します。

390px、430px、768px、1280px以上の表示、キーボード操作、visible focus、コントラスト、reduced-motion、44px以上の操作領域を受入条件にします。

公開ルートは認証状態で分岐し、未認証時はLP、認証済みの場合は管理画面を表示します。

ルート判定とページメタデータは表示コンポーネントから分離して単体テストし、`/login`の認証導線を公開LPから利用できる状態に保ちます。

## DBとmigration

Prismaのschema変更からmigration SQLを生成し、SQL、RLS、権限、複合外部キーをレビューしてから適用します。

ローカルでは`migrate dev`、stagingとproductionでは`migrate deploy`を使います。

migrationは英語のsnake_case、UTF-8 BOMなし、LF改行とし、作成または変更した表と列には用途を示すSQLコメントを付けます。

既存データの変換、UUIDv7移行、状態trigger、権限変更を含むmigrationは、適用前検査と実DB検証を完了条件にします。

## 実装順

1. **契約と認証**：tenant選択、feature definitions、plan、team flag、招待、LINE・Google OAuth、所属、RLS。
2. **メンバー基盤**：部員、member link、本人・guardianの対象選択、年度更新、actorとsubjectの監査。
3. **予定運用**：予定、出欠、締切、リマインド、当番を対象メンバー単位へ拡張する。
4. **チーム運営**：役員・連絡先、共同購買、集金、CSVを画面単位へ分離する。
5. **配信と資料**：添付、回覧、LINE通知、Webhook、workerをfeature契約へ接続する。
6. **送迎と外部受入**：希望、提供枠、割当案、確定、公開、地図リンク、staging外部接続。
7. **公開LPと管理UI**：未認証ルートのLP、認証状態による画面分離、`/admin`ルート、メニュー、共通UI、デザイントークン、role別とfeature別の受入。

各機能は、仕様IDの確認、API・Web・DBの実装、tenant境界と認可の検査、local実DB検証、staging受入、独立レビューの順に完了させます。

自動処理は割当案や通知登録までに留め、利用者へ確定状態を公開する処理は明示的な権限と状態遷移を通します。

## 開発とCI

Node.jsは`24.12.0`以上`25`未満、pnpmは`10.26.0`に固定します。

検証は同時実行せず、依存関係、静的検査、build、test、typecheck、lint、実DB、E2Eの順に行います。

| コマンド | 用途 |
| --- | --- |
| `pnpm ci:fast` | PRの短時間品質ゲート。static、契約、unit、typecheck、build |
| `pnpm ci:local` | local PostgreSQL/Supabase、migration、RLS、integration、E2Eを含む検証 |
| `pnpm ci:staging` | stagingのmigration、配置、smoke、E2E。未設定時はfail-closed |

GitHub Actionsの長時間Workflowは手動起動とし、productionはstagingで検証した同一commitとartifactだけを昇格させます。

CIの詳細、schema drift、trust root、DB整合性は[検証手順書](verification-runbook.md)に統合しています。

## 文書を更新する順序

仕様を変更するときは、機能仕様書、実装計画、API・DB・画面・feature契約の境界、テスト、再開台帳の順に更新します。

完了事項をこの文書へ追記せず、完了履歴へ一行で記録します。

現在の停止条件は[中断再開タスクリスト](resume-task-list.md)だけを参照してください。
