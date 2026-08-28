# 完了タスクと実施履歴

更新日：2026-08-28

この文書は、完了済み作業の結果だけを短く残す履歴です。

現在の停止条件は[中断再開タスクリスト](resume-task-list.md)、業務仕様は[機能仕様書](functional-specification.md)、検証手順は[検証手順書](verification-runbook.md)を参照します。

## 完了済みの実装

| 区分 | 完了内容 | 判定 |
| --- | --- | --- |
| Phase 1 | 認証、tenant選択、部員管理、年度繰り上げ、管理者登録E2E | `develop`統合済み。Critical / High 0件 |
| Phase 2 | 予定、出欠、締切、集計、当番、予定詳細、中央API接続 | `develop`統合済み。実DBの残条件は再開台帳で管理 |
| API共通 | CORS、認証後rate limit、構造化ログ、response runtime検証、中央mount | `develop`統合済み |
| Web共通 | team選択、Auth session lifecycle、認証済みfetch、主要画面の共通UI | `develop`統合済み。role別受入は継続 |
| LINE | 接続、group世代、outbox、worker、管理者再送、Webhook、Web通知、公開response契約 | `develop`統合済み。実LINE受入と仕様差分は継続 |
| 添付・回覧 | R2 adapter配線、添付response契約、回覧添付のavailable DB guard、短期URL download | `develop`統合済み。実R2と回覧受入は継続 |
| 購買・送迎 | 注文APIとWeb、CSV・冪等性、送迎API、送迎Web、公開response契約 | `develop`統合済み。実DB・staging受入は継続 |
| CI・DB | Node.js / pnpm固定、Node 24、local-first quality、migration検査、UUIDv7移行前検査、schema drift検査、PR本文検査 | `develop`統合済み。mainのtrust rootと外部環境は継続 |
| API・LINE統合回帰 | eventsの管理者出欠修正RLS、LINE feature contract経路、provider retry key、scale fixture干渉の修正 | 実装PR #231を`develop`へ統合。fresh Supabase統合、品質ゲート、敵対的レビュー成功。実LINE・staging受入は継続 |
| LOCAL-FIXTURE-001 | 500チーム・5,000部員、部員ごとの父母想定10,000保護者リンク、状態境界、ページャー閾値を含むローカルfixture拡充 | PR #197を`develop`へ統合。敵対的レビューと品質ゲート成功。実負荷試験・staging外部サービス受入は継続 |
| LOCAL-FIXTURE-002 | 1,001チーム・10,010部員・20,020保護者リンク、全31テーブル1,000件超、状態パターン、RLS付きDB負荷試験 | PR #199を`develop`へ統合。敵対的レビュー、品質ゲート、実DB件数検証、1,000件負荷試験成功 |
| UI安全性 | 二重送信防止、権限別操作表示、認証レイアウト、主要タップ領域、複数幅ブラウザ受入 | `develop`統合済み。認証済み主要画面のrole別受入は継続 |
| UI-018〜024 | 認証済みroot、team feature flag導線、レスポンシブ表、チーム設定・役員連絡先分離、共通UI、role別ルート | PR #204を`develop`へ統合。docs-only PR #205で台帳を分離更新。品質ゲート、`pnpm ci:fast`、390px/1280pxブラウザ確認成功。実DB・外部provider・staging受入は継続 |
| LP-001 / FS-UI-004 | 未認証ルートの公開LP、課題と機能の訴求、提供状態、ログイン導線、認証済み画面との分離、専用ヒーロー画像 | PR #194を`develop`へ統合。`pnpm test`、`pnpm test:unit`、`pnpm build`、lint、typecheck、390pxから1440pxのブラウザ確認、キーボード操作、コントラスト、品質ゲート成功。敵対的レビューのCriticalとHighは0件 |
| LP-002 | 公開LPの初回バンドルから認証済み管理機能を分離し、低速端末のLCP・INP計測を再現可能にした | 実装PR #208を`develop`へ統合。`pnpm measure:lp`を10回実行し、390x844、CPU 4倍、150ms遅延、下り1.6Mbps、上り750kbps、cache無効、Chromium headlessでLCP p75 2148ms / INP p75 56msを記録。`pnpm test`、`pnpm test:unit`、`pnpm build`、typecheck、Biome、production bundle、trust-root、品質ゲート成功。性能基準の運用値とstaging再計測はOPSの外部条件として継続 |
| LP-003 / FS-UI-004 | LINE Design Systemを参照した公開LPと共通UIの再設計、LINE通知とWeb正本の役割分担、アクセシビリティ確認 | 実装PR #212を`develop`へ統合（merge commit `6e3e9606f9915fae9d11acb148d8919885d1d728`）。`pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、390px / 430px / 768px / 1280pxのブラウザ確認、敵対的レビューを完了。GitHub quality runは記録時点でqueuedのため、成功とは扱わない |
| LOGIN-LOGO-001 / FS-UI-004 | ログイン画面の旧アイコンを公開LP・認証済み画面と共通のCoCoLoロゴへ統一 | 実装PR #224を`develop`へ統合（merge commit `db8e959ac6afbe7c3305d6e23cb3325ef1a64f32`）。対象Vitest 7件、`pnpm test`、`pnpm build`、`pnpm lint`、`git diff --check`、品質ゲートを成功。実ブラウザのログイン画面受入は認証providerを含むstaging条件として継続 |
| LOGIN-ENTRY-001 / FS-AUTH-001 / FS-UI-004 | 公開トップからチームログインへ進み、専用URLのシステム管理者ログインを入口表示から分離 | 実装PR #226を作成。対象Vitest 22件、`pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`git diff --check`を成功。実ブラウザと実Auth providerを含むstaging受入は継続 |
| ADMIN-TEAM-001 | `/admin`のシステム管理、`/team`の選択中チーム管理、`/dashboard`の利用者向け予定・締め切り一覧と14日カレンダー | 実装PR #211・#214を`develop`へ統合。docs-onlyの完了記録PRで本履歴を更新。ローカル品質検証は成功し、staging実DB/RLSと実ブラウザ受入は`ADMIN-TEAM-001-ACCEPTANCE`として継続 |
| ADMIN-TEAM-001 / LOGIN回帰 | LP変更後のログイン後ダッシュボード、チーム導線、全体お知らせ表示の回帰修正 | 実装PR #233を`develop`へ統合。ログイン後E2E、fresh Supabase統合、unit、build、typecheck、lint、trust root、DB integrity、OpenAPI検証を成功。staging実DB/RLSと実ブラウザ受入は継続 |
| BILLING-001 | 有償・無償feature、チーム単位のplan・flag、effective entitlement、監査境界 | PR #172を`develop`へ統合。CI、`pnpm test`、`pnpm build`、migration・trust検証成功。課金provider接続は外部条件として継続 |
| BRD-001 / feature契約 | 役員・連絡先の`board-contacts`契約、API fail-closed、Webメニュー制御、無料feature migration | PR #185を`develop`へ統合。`pnpm test` 200件、`pnpm build`、unit、Biome、workspace boundary、migration、trust、品質ゲート成功。個人情報境界、Web閲覧、実DB/RLS受入は継続 |
| BRD-001 / 年度引き継ぎ | 行ごとのUUIDv7生成、INSERT影響行数による`copiedCount`、APIレスポンスの件数整合 | PR #187を`develop`へ統合。`pnpm test` 200件、`pnpm build`、lint、workspace boundary、品質ゲート成功。実DB/RLSの複数行受入は継続 |
| BRD-001 / 閲覧専用Web | staff/guardian向け役職枠一覧、feature flag連動メニュー、管理者向け編集画面との分離、非公開連絡先の表示明確化 | PR #189を`develop`へ統合。`pnpm test:unit`、`pnpm build`、`pnpm lint`、`git diff --check`、品質ゲート成功。DB PII境界、OpenAPI、実DB/RLS、実ブラウザ受入は継続 |
| BRD-001 / DB PII境界 | `board_contacts`直接SELECT撤去、manager専用projection、非管理者PII NULL、shadow ACLとmigration checksum | PR #191を`develop`へ統合。`pnpm test`、`pnpm build`、`pnpm lint`、migration SQL/checksum、trust-root、品質ゲート成功。fresh local DBのrole・tenant受入成功。OpenAPIとstaging実DB/RLSは継続 |
| AUTH-003 / MEM-007 | 招待token、LINE・Google OAuthのprovider subject、member link、連携解除境界 | PR #173を`develop`へ統合。opaque token、fragment URL、active link、CI、`pnpm test`、`pnpm build`成功。OAuth provider実接続は外部条件として継続 |
| API-003 | 出欠、注文、送迎希望でactor userと対象memberを分離し、API・DBで再認可 | PR #174を`develop`へ統合。対象member契約、tenant境界、CI、`pnpm test`、`pnpm build`成功 |
| UI-004 / UI-005 | 管理画面のルート・メニュー分離、feature契約による表示制御、`packages/ui`共通primitive、デザイントークン、レスポンシブ管理シェル | PR #175を`develop`へ統合。招待URL発行、対象member選択、CI、`pnpm test`、`pnpm build`成功。実ブラウザ幅別受入とstaging E2Eは外部条件として継続 |
| NOT-001 / FS-NOT-001 | 中央LINE通知のsourceType・UUIDv7 sourceId、同一tenant resource検証、server生成deep link、API・workerのteam feature flag境界、旧outbox隔離 | PR #177を`develop`へ統合。`pnpm test` 198件、`pnpm build`、migration SQL 30件、DB整合性25件、品質ゲート成功。Web遷移先、未払いproducer、実LINE受入は継続 |
| NOT-001 / 回覧producer | 回覧掲載時のLINE通知outbox登録、feature flag fail-closed、同一transaction、tenant接続group、server生成deep link、staffのDB enqueue権限境界 | PR #183を`develop`へ統合。`pnpm test`、`pnpm build`、Biome、workspace boundary、migration SQL、trust-root、品質ゲート成功。未払いproducer、staffの手動通知権限仕様、実LINE受入は継続 |
| FS-NOT-002 | 通知deep linkの予定・回覧画面、OAuth復帰、複数チーム時の選択、403/404時の安全な再選択画面、拒否時の旧state残留防止 | PR #179/#181を`develop`へ統合。`pnpm test`、`pnpm build`、Web typecheck、対象Vitest 16件、品質ゲート成功。stagingのLIFF不可端末、通常ブラウザ、実LINE受入は継続 |

## API-001 / DB-002 共通RLS再検証 実施記録

- 対象: Phase 1の`tenants`、`tenant_memberships`、`members`、`guardian_members`、`audit_logs`、`promotion_runs`のRLSがtransaction-localなcontextだけを信頼しないようにした。
- 実装: `app_is_active_member`と`app_is_active_member_with_role`でDB上のactive membership・roleを再検証し、guardianはactive担当linkに限定した。operatorはmembershipを持たない既存の課金監査経路を維持した。
- テスト: role偽装adminの部員参照・登録拒否、suspended membershipのtenant・部員参照拒否をcentral実DBテストへ追加し、migration policyの静的検査を追加した。
- レビュー: Russellが現行branch・履歴、Hubbleが仕様・実装差分、Meitnerが敵対的観点を確認した。初回レビューでoperator監査INSERTを消すHigh指摘があり、operator分岐を復元して再レビュー・再検証した。最終判定はCritical 0 / High 0。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm ci:fast`、`pnpm test:integration`（DB 3件、API 25件成功、既存条件のskip 1件）、`pnpm test:database-integrity`（25件）、migration SQL/checksum、trust-root、Biome、workspace境界、production bundleを成功させた。
- 統合: 実装PR #235（merge commit `bcb85663ade471214e3430d89a967bdf15503109`）を2026-08-28に`develop`へ統合した。実装PRはmigration、checksum、trusted manifest、テストだけを含む。
- 残課題: 分散rate limitの本番条件、UUIDv7移行前検査、staging実DB/RLS・外部provider受入、productionとstagingの同一SHA証跡は`API-001 / DB-002`、`T014`、`OPS-001〜007`の停止条件として継続する。production/staging workflowのtrust-root順序問題は別featureで扱う。

## API・LINE統合回帰修正 実施記録

- 対象: 現行`develop`のfresh Supabase統合で発生した、events統合テストの管理者出欠修正RLS違反と、LINE統合テストのfeature contract未設定・fixture干渉を解消した。
- 原因: `attendance_update` policyの`WITH CHECK`がmanager更新にも`user_id = app.user_id`を要求していたため、owner/admin/staffがguardian回答を代理修正するとPostgreSQLのRLS違反になっていた。LINE側は統合テストの`createApp()`へcentral feature contract repositoryを渡しておらず、fail-closedの503でDB経路へ到達していなかった。
- 実装: 新規migration `20260828100000_fix_attendance_manager_correction_rls`でmanager分岐の回答者固定を外し、guardian分岐の本人・担当active link制約を維持した。既存triggerによる回答識別子と`user_id`固定は維持した。LINE統合テストへfeature contract repositoryを接続し、同一tenantの別source、通知ごとのUUIDv7予定ID、動的group、失敗時cleanupを追加した。
- fixture: 大量scale outboxのpending行を2099年の再試行時刻へ設定し、processor統合テストのclaim対象へ混入しないようにした。固定plan・固定groupの上書きは避け、既存seedのactive planを利用する構成にした。Supabase CLIには`DO_NOT_TRACK=1`と`SUPABASE_TELEMETRY_DISABLED=1`を渡し、worktree間で共有されるtelemetryファイルへの依存をなくした。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm test:integration`（DB 3件、API 24件成功、1件skip、失敗0）、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test:database-integrity`、migration SQL/checksum、trust root、OpenAPI、`git diff --check`を成功させた。
- 敵対的レビュー: サブエージェント2名で原因調査、別サブエージェントで敵対的レビューを実施した。初回Medium指摘（tenant A内の別source検証、失敗時cleanup、共有fixture汚染、固定ID再利用）を修正し、最終判定はCritical 0 / High 0 / Medium 0 / Low 0だった。
- 反映: 実装PR #231（merge commit `021d4b2d841140698d1320f641782a7cc1be41a7`）を2026-08-28に`develop`へ統合した。完了記録は実装PRと分離した本docs-only PRで更新する。
- 残課題: 実LINE provider、staging実DB/RLS、UUIDv7移行前の実DB検査、実ブラウザ受入、分散rate limitなどは`LINE-DELIVERY-001`、`API-001 / DB-002`、`OPS-001〜007`の外部条件として再開台帳に残す。

## UI-018〜024 実施記録

- 実装: team単位の有償・無償feature契約、OAuth招待、対象member単位の回答・購入、認証済みroot、管理画面分割、共通UI、モバイル表示を実装した。
- 境界: API・DBでtenant、role、member link、OAuth subject、feature契約を再検証し、判定不能時はfail-closedにした。
- 検証: `pnpm ci:fast`、trust-root、Betterleaks、toolchain、migration、Biome、workspace境界、unit/contract、typecheck、lint、build、production bundleを成功させた。
- 統合: 実装PR #204（merge commit `cab87b73e2a7aa5a7982e9d9f26761e267830f88`）とdocs-only PR #205（merge commit `a848ca096f9517ea6d623813be5a63ccc47d1e01`）を2026-08-26に`develop`へ統合した。
- 残課題: 実DB/RLS、OAuth・課金provider、LINE・R2、staging E2Eは外部条件として再開台帳へ残す。

## LP-002 実施記録

- 対象: 公開LPの初回バンドルを認証済み管理機能から分離し、低速端末条件でLCPとINPを同じ手順で計測できるようにした。
- 計測: `scripts/measure-lp.ts`がVite previewを起動し、390x844、CPU 4倍、150ms遅延、下り1.6Mbps、上り750kbps、cache無効、service worker無効、10回以上の反復を固定する。結果は`.ci-reports/lp-performance.json`へ保存し、秘密情報と個人情報は保存しない。
- 結果: 実装時点のSHA `9b22fec78a81ac9595c1fd11d5e04170351f6bb1`で10回計測し、LCP p75 `2148ms`、INP p75 `56ms`、各回9 interactionを記録した。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm typecheck`、`pnpm lint:biome`、`pnpm verify:production-bundle`、`pnpm verify:trust-root`、`git diff --check`、品質ゲートを成功させた。追加スクリプトと`package.json`のhashはtrusted manifestへ登録した。
- 敵対的レビュー: LCP/INPの定義、低速条件、反復回数、外部URL入力、ブラウザ・previewの後始末、trust-root登録を確認し、Critical / Highは0件。
- 統合: 実装PR #208（merge commit `7d98a662c77604ad0fcadafe4faaa40fd47dfa9c`）を2026-08-26に`develop`へ統合した。
- 残課題: 製品リリースの性能閾値、staging環境での同一artifact再計測、継続監視はOPSの外部条件として再開台帳に残す。

## LP-003 実施記録

- 対象: LINE連携をサービスの入口として扱う公開LPと、公開LP・認証済み画面で共有するデザイントークンを見直した。
- 方針: LINE Design SystemのFoundation、Color Guide、Typographyを参照し、LINE Greenを主操作、白とグレーを情報整理、CoCoLoのコーラルとイエローを補助色として整理した。
- 責務: LINEグループへの通知と対象Web画面への入口をLINEの役割、予定・出欠・資料・権限などの業務データをCoCoLoの正本とし、個人LINE通知やグループ自動接続を公開LPで約束しない構成にした。
- 実装: 公開LPのヒーロー、ナビゲーション、LINE連携説明、導入手順、CTA、共通UIプリミティブ、theme-color、角丸、影、フォーカス、reduced-motionを更新した。
- 敵対的レビュー: tenant越境、認可、個人情報、入力検証、状態遷移、競合は静的LP変更の対象外であることを確認した。LINEを明示したCTAのリンク先不一致とLINE Green上の白文字コントラスト不足をCritical / High相当の指摘として修正し、残件を0件にした。
- アクセシビリティ: LINE Green（`#06C755`）上の通常文字は濃色文字とし、白文字はコントラストを確保できる濃い緑面に限定した。44px操作領域、visible focus、reduced-motion、横スクロールなしを確認した。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`git diff --check`を成功させた。実ブラウザで390px、430px、768px、1280pxを確認し、LINEアンカー、モバイルメニュー、FAQ開閉、実行時エラーなしを確認した。
- 統合: 実装PR #212を2026-08-26に`develop`へ統合した。GitHub quality runは履歴作成時点でqueuedであり、CI成功済みとは記録していない。
- 残課題: 実LINE接続、staging通知到達、実環境E2EはNOT-001 / NOT-002およびOPS-001〜007の外部条件として再開台帳に残す。

## LOGIN-ENTRY-001 実施記録

- 対象: 公開トップのチーム利用者向けログインと、URLを知っているシステム管理者向けログインの入口を明示的に分けた。
- 実装: 公開トップの導線を「チームログイン」とし、`/login`の画面・ページメタデータをチーム向けに統一した。`/admin`とシステム管理用`/admin/*`では「システム管理者ログイン」を表示し、旧チーム管理経路の`/admin/members`などはチームログインとして扱う。
- セキュリティ: ログイン画面の表示分岐は権限付与に使用せず、ログイン後のsystem admin判定は既存の署名済みclaimとAPI・DB認可を維持した。公開トップにはシステム管理者URLへのリンクを追加していない。
- 敵対的レビュー: tenant越境、認可、個人情報、入力検証、状態遷移、競合は認証API・DB変更がないため既存境界を維持する範囲で確認し、Critical / Highは0件とした。
- 検証: `/login`・`/admin`の入口判定、チーム／システム管理者の画面見出し、公開トップの管理者入口非公開を含むVitest 22件、`pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`git diff --check`を成功させた。
- 反映: 実装PR #226と分離したdocs-only PRで本記録を追加する。
- 残課題: 実Supabaseのclaim設定、実DB/RLS、実ブラウザの`/admin`・`/team`・`/dashboard`受入は`ADMIN-TEAM-001-ACCEPTANCE`へ残す。

## LOGIN-ENTRY-001 / チーム画面初期化回帰 実施記録

- 対象: チームログイン後に画面遷移すると、部員APIの失敗がチーム画面全体を停止し、「予定画面の利用権限を確認できません。」と表示される回帰を修正した。添付画像はこの再現状態の証跡として扱った。
- 原因: 所属role取得と、予定・購買・送迎の入力に使う部員候補取得を`Promise.all`で結合していたため、部員APIのfeature・権限・依存障害が別画面の表示まで失敗させていた。エラー状態の共通`AppShell`が旧ハッシュリンクを表示するため、`/team/members#ride-operations-heading`へ遷移できる状態も発生していた。
- 実装: 所属role取得を独立させ、部員候補取得を予定・予定詳細・購買・送迎ルートだけへ限定した。部員候補の取得失敗は対象操作の注意に限定し、部員画面は部員画面自身のAPIエラー表示を利用する。読み込み中・権限エラー中の状態画面では旧ナビゲーションを表示しない。
- セキュリティ: 選択中tenant、active membership、role、API・DB側の認可は変更せず、画面表示の依存関係だけを分離した。tenant越境、認可、個人情報、入力検証、状態遷移、競合を確認し、Critical / Highは0件とした。
- 検証: ルート判定Vitest 5件、Web全体Vitest 118件、`pnpm test`（contracts 51件、domain 18件、DB 10件、API 223件）、`pnpm build`、`pnpm lint`、Web型チェック、`git diff --check`を成功させた。
- 反映: 実装PR #226へ追補し、本記録は実装PRと分離したdocs-only PRで追加する。
- 残課題: 実Supabaseのclaim設定、実DB/RLS、実ブラウザでの`/admin`・`/team`・`/dashboard`および複数feature停止時の受入は`ADMIN-TEAM-001-ACCEPTANCE`へ残す。

## LOGIN-LOGO-001 実施記録

- 対象: ログイン画面だけに残っていた旧来の「C」アイコンを、公開LPと認証済み画面で利用する共通ロゴへ置き換えた。
- 実装: `CoCoLoLogoMark`とCoCoLo表記をログイン画面へ追加し、共通ロゴの3色目を`--cocolo-brand`へ束縛してLINE Greenへ統一した。
- 境界: 表示とCSSだけを変更し、認証処理、OAuth、API、DB、tenant認可、個人情報、外部LINE連携には変更を加えていない。
- 敵対的レビュー: 旧アイコンの残存、LPと認証画面のブランド表示差分、ロゴ装飾の読み上げ、テスト不足を確認し、Critical / Highは0件とした。
- 検証: 対象Vitest 7件、`pnpm test`、`pnpm build`、`pnpm lint`、`git diff --check`、GitHub Actions品質ゲートを成功させた。
- 統合: 実装PR #224を2026-08-27に`develop`へ統合した。本記録は実装PRと分離したdocs-only PRで追加した。
- 残課題: 実ブラウザのログイン画面幅別受入は、認証provider設定を含むstaging受入時に実施する。

## ADMIN-TEAM-001 実施記録

- 対象: システム全体の管理経路を`/admin`、選択中チームの管理経路を`/team`、利用者向けの認証済み経路を`/dashboard`へ分離し、ログイン後の遷移先をダッシュボードへ統一した。
- ダッシュボード: JST基準の直近14日を対象に、予定、出欠締切、注文締切を一覧表示し、同じ期間を日曜始まりのカレンダーで表示する。予定の詳細遷移と締切種別を利用者向け画面に残した。
- システム管理: 署名済みJWTの`app_metadata.system_admin`とDB側RLS roleを二重確認し、全体お知らせの作成・編集・公開状態変更、system auditのappend-only記録、featureの全体停止・再開をAPIと画面へ追加した。feature停止時もplan、provider、grantの有償契約条件は緩和しない。
- チーム管理: 既存の`/admin/*`管理画面をチーム管理経路として扱い、ルートメタデータと選択中tenantの認可境界を整理した。system APIはtenant headerに依存せず、team APIとは別の認証・rate limit経路にした。
- セキュリティ: お知らせはsystem adminが全件を管理し、利用者は公開済みのお知らせだけを自tenant membership経由で参照する。system auditは更新・削除不可とし、APIの入力、UUIDv7、状態値、認証、tenant越境を検証した。
- 反映: タスク登録PR #210、経路・ダッシュボード実装PR #211、システム管理実装PR #214を`develop`へ統合した。完了記録は実装PRと分離したdocs-only PRで更新した。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`pnpm verify:migration-sql`、`pnpm verify:migration-checksum`、`git diff --check`を成功させた。`DIRECT_URL`未設定のためUUIDv7 migration検査、`APP_ENV`未設定のためschema drift検査は実行していない。
- 敵対的レビュー: tenant越境、system admin認証、個人情報露出、入力検証、状態遷移、監査ログの改変防止、paid feature条件、二重送信、失敗・未接続表示を確認し、Critical / Highは0件とした。
- 残課題: Supabaseの`system_admin` claim付与、staging migration、実DBのRLS、実ブラウザの`/admin`・`/team`・`/dashboard`受入は、再開台帳の`ADMIN-TEAM-001-ACCEPTANCE`へ移した。

## ADMIN-TEAM-001 / LOGIN回帰修正 実施記録

- 対象: LP変更後に不安定になったログイン後の認証コンテキスト、`/team/members`導線、利用者ダッシュボードを修正し、全体お知らせを利用者へ安全に表示できるようにした。
- 原因: 認証コンテキストと部員一覧を一括待機していたため一方の失敗が全体を止めていた。feature停止時も予定APIを呼び出していた。出欠締切だけが期間内にある予定と、全体お知らせの公開状態・件数上限が明確でなかった。
- 実装: `Promise.allSettled`で認証後の部分失敗を分離し、予定・締切・注文締切をJST基準の14日カレンダーへ集約した。events feature停止時のAPI呼び出しを抑止し、出欠締切を期間検索へ含めた。`/admin`の全体お知らせ・paid feature制御と、active membershipへpublishedだけを返す利用者向けAPIを追加した。
- 認可・RLS: `/team`の部員変更をowner/adminへ限定し、staffは参照専用とした。公開お知らせはtenant・active membership・published状態をDBで再検証し、draftを除外した。paid feature以外の全体切り替えはAPI・画面で拒否した。
- 検証: `pnpm test`（API 225件を含む）、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:openapi`、`pnpm verify:trust-root`、`pnpm test:database-integrity`（25件）、`git diff --check`を成功。`pnpm test:integration`はDB 3件成功、API 25件成功・1件skip、失敗0。`E2E_ENV=local node scripts/supabase-local.ts e2e -- -g '部員'`は3件成功・1件skip。
- 敵対的レビュー: サブエージェントで認証導線、dashboard、system admin API/RLSを分担確認し、tenant越境、認可、個人情報、入力検証、状態遷移、競合、feature境界を再確認した。Medium指摘を修正し、Critical / Highは0件とした。
- 送迎回帰: staffの監査INSERTがPrismaの`RETURNING`によりRLSで失敗する既存不整合を検証中に発見し、SELECT権限を広げず明示SQL INSERTへ修正した。送迎lock同時登録を含む実DB統合テストも成功した。
- 反映: 実装PR #233（merge commit `f29929039eb4340bea31f8cdf82cddac3c461dee`）を2026-08-28に`develop`へ統合した。
- 残課題: Supabaseの`system_admin` claim付与、staging migration、実DB/RLS、実ブラウザの`/admin`・`/team`・`/dashboard`受入は、再開台帳の`ADMIN-TEAM-001-ACCEPTANCE`で継続する。

## ADMIN-TEAM-001 / チーム画面シェル統合 実施記録

- 対象: チームログイン後にカレンダー中心の利用者シェルから部員管理中心のチームシェルへ切り替わり、左メニューとダッシュボードが不統一になる回帰を修正した。
- 原因: 認証済み画面が`/dashboard`だけ`UserShell`、`/team`と管理画面が`AdminShell`で描画されていたため、ログイン直後とチーム管理画面で異なるナビゲーションが表示されていた。
- 実装: `/team`を正規のチームダッシュボードとし、ログイン直後・招待受諾後の遷移先を`/team`へ統一した。既存の`/dashboard`は`/team`へ正規化する互換経路とし、`/team`配下は常に`AdminShell`で描画するようにした。
- ダッシュボード: `UserDashboard`の直近14日予定・締め切り・カレンダーと`AdminDashboard`のチーム運営状況を`/team`へ統合した。`AdminShell`取得済みのfeature contractを再利用し、同一画面での重複取得を防いだ。
- ナビゲーション: サイドバーの`/team`・`/team/members`のactive状態を同一シェルで管理し、上部バーの重複ダッシュボードリンクを削除した。
- テスト: `e2e/team-shell-dashboard.spec.ts`でログイン直後の`/team`、部員画面とのシェル共有、ダッシュボード復帰、予定とチーム概要の同時表示を固定した。`/dashboard`の互換正規化はルート単体テストで確認した。
- セキュリティ: API、DB、migration、認証契約を変更していない。`/admin`のsystem admin分岐、選択中tenant、既存の認可・個人情報境界を維持した。敵対的レビューのCritical / Highは0件とした。
- 検証: 対象E2Eは1件成功、全local E2Eは8件成功・1件skip、`pnpm test`（API 225件を含む）、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`git diff --check`、PR本文検証を成功させた。
- 反映: 実装PR #238（merge commit `205d76a7075d4f69f41445120c8600d858f10cd0`）を2026-08-29に`develop`へ統合した。
- 残課題: Supabaseの`system_admin` claim付与、staging migration、実DB/RLS、実ブラウザの`/admin`・`/team`・`/dashboard`受入は、再開台帳の`ADMIN-TEAM-001-ACCEPTANCE`で継続する。

## RIDE-002 実施記録

- 対象: 確定した送迎予定を、許可された利用者へ部員名・運転者表示名・乗車人数付きで安全に投影し、ログイン後の送迎操作から配車表示名を設定できるようにした。
- 実装: 確定配車のDB projectionへ同一tenantの`members.name`と`tenant_memberships.display_name`をjoinし、manager、requester、driver、担当部員を持つguardianだけへ必要な行を返す。運転者名を`ride_offers`や割当行へ複製しない。
- 表示名: `PATCH /api/v1/ride-profile/display-name`を追加し、認証済み本人のactive membershipだけを1〜200文字で更新する。既存の`closed`予定も確定前に表示名を設定でき、変更は監査ログへ記録する。
- 状態保護: 確定公開中の対象部員名と運転者表示名をDBトリガーで固定し、予定を再編集へ戻した後だけ変更できるようにした。これにより、確定済みsnapshotがプロフィール変更で動的に変わらない。
- 敵対的レビュー: 初回実装に対する「確定後の動的joinで表示名が変わる」「既存closed予定に表示名の救済経路がない」というHigh指摘をフォローアップPR #217で修正した。Critical / Highの未解決指摘は0件。
- 反映: 実装PR #216（merge commit `07cb8bdb5d023e2da0ccf0e1216dbaeb6d32d51d`）とフォローアップPR #217（merge commit `1a999ef575a932d2511af99f6f14c1c4413e5e14`）を2026-08-26に`develop`へ統合した。
- 検証: `pnpm test`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test:database-integrity`、`pnpm verify:migration-sql`、`pnpm verify:migration-checksum`、`pnpm verify:trust-root`、`pnpm lint:openapi`、`git diff --check`を成功させた。全workspace testはAPI 223件を含め成功した。
- 残課題: `DIRECT_URL`未設定のUUIDv7 migration実DB検証、Google Mapsのkey・許可origin・費用上限・障害時表示、Supabase実DBのRLS・競合、manager/guardianのstagingブラウザ受入は、再開台帳の`RIDE-002-ACCEPTANCE`へ移した。

## 完了判定の共通結果

## RIDE-002 実DB統合・競合制御追補記録

- 対象: 実装PR #221。RIDE-002のローカルfixture、確定公開中の表示名保護、複数送迎予定をまたぐ同時更新、CIのinstall script無効化環境を追補した。
- 実装: `members`と`tenant_memberships`で異なる行型を持つDBトリガーを分離し、表示名変更と確定公開の状態遷移を同じtenant・plan順のadvisory lockで直列化した。fixtureは旧形式の生成IDだけを限定補修し、再実行で確定済み業務データの状態や表示名を上書きしない。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test:contract`、migration SQL/checksum、database integrity、trust root、fresh Supabase 40 migration、DB central RLS concurrency、API members DB 6を成功させた。GitHub Actions qualityも成功した。
- 敵対的レビュー: サブエージェントによるtenant越境、認可、個人情報、入力検証、状態遷移、競合、seed再実行、CI再現性の確認でCritical / Highは0件とした。Mediumの2-plan同時車登録を専用実DBテストで明示する課題は残した。
- 反映: 実装PR #221を2026-08-27に`develop`へ統合した。CIで判明したdomain build順序も修正し、install script無効化時のunit test再現性を確保した。
- 残課題: Google Maps設定、Supabase stagingのRLS・競合、manager/guardianの実ブラウザ受入は、再開台帳の`RIDE-002-ACCEPTANCE`へ残す。

## RIDE-002 2-plan同時車登録・実DB回帰検証記録

- 対象: RIDE-002の残課題だった、同一運転者を2つの送迎planへ同時登録する競合経路を実DBで回帰検証した。DB fixtureは本番・stagingと分離した`cocolo-test`のloopback環境に限定した。
- 実装: `createOffer`のvoid戻り値DB lock関数をPrismaの`$executeRaw`で呼び出すよう修正し、同一運転者・2つのplan・既存割当を含むfixtureで、正規順序の同時`createOffer`を別接続から実行した。戻り値のplanId、plan別登録件数、表示名更新、別tenantへの拒否と越境先データ未変更を検証する。
- 競合検証: 2接続が第一lock取得後に逆順の第二lockを取得する専用テストを追加し、DBのdeadlock/timeoutで循環待ちが有限時間内に検出されることを確認した。production migrationや既存DB関数の定義は変更していない。
- 安全性: fixture cleanupは専用UUIDを使い、test stackのloopback URL、`TEST_STACK_PROJECT=cocolo-test`、`TEST_DATABASE_RESET_ALLOWED=true`を同時に満たす場合だけ有効になる。本番・stagingの`DIRECT_URL`を誤って削除対象にできないfail-closed guardを追加した。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm test:contract`、`pnpm test:database-integrity`、`pnpm verify:trust-root`、変更ファイルのBiome、`git diff --check`を成功させた。fresh Supabase統合ではDB側3件が成功した一方、API側は現行develop由来のevents 1件とLINE 4件が失敗し、全体終了コードは1だったため、別課題として扱う。
- 敵対的レビュー: サブエージェントにtenant越境、認可、個人情報、入力検証、状態遷移、競合、fixture cleanup、テストDB誤接続を確認させ、Critical / Highは0件とした。
- 反映: 実装PR #229（merge commit `2bf744b73f82cc8eb95cff65f9f748e242ddfdf5`）を2026-08-28に`develop`へ統合した。完了記録は本docs-only PRで実装PRと分離して更新する。
- 残課題: Google Maps設定、Supabase stagingのRLS・競合、manager/guardianの実ブラウザ受入は、引き続き再開台帳の`RIDE-002-ACCEPTANCE`へ残す。現行develop由来のevents/LINE統合5件も本記録の対象外である。

完了した実装は、tenant越境、認可、個人情報、入力検証、状態遷移、競合、外部サービス未接続の表示をレビュー対象にしました。

CriticalとHighが残る実装を完了扱いにしていません。

実DBや外部サービスを実行していない場合は、CI成功だけで実行済みとは扱わず、再開台帳の外部条件へ残しています。

## 継続中のレビュー指摘

| 分類 | 未解決事項 |
| --- | --- |
| Trust / CI | mainのowner-only bootstrap、scanner protected path、初回導入、default branchの強制 |
| DB | 既存UUIDv4の移行、添付の`available`状態、各機能のRLS受入 |
| 外部受入 | Supabase、R2、LINE、Redis相当、Google Mapsの実接続と障害表示 |
| 機能受入 | 役員、購買、回覧、通知、送迎のstaging E2Eとrole別ブラウザ受入 |

## LOCAL-FIXTURE-001 実施記録

- 対象: ローカル開発用DB seed。production、staging、公開APIのデータは変更していない。
- 規模: 500チームをtenantとして生成し、1チーム10部員の5,000部員、部員ごとに父・母を想定した10,000保護者リンクを投入する。500イベント、500回覧、500 LINE接続・outboxも生成する。
- 閾値: tenant Cにactive部員を101件、published回覧を101件追加し、既存データと合わせてpageSize 50/100および101件目を確認できる。active、suspended、retired、student、adult、招待・停止・退部済みも固定fixtureで保持する。
- 網羅範囲: tenant・role・membership、招待、member link、添付、予定・出欠、役員連絡先、購買・冪等性、回覧・既読、LINE配送、送迎の状態遷移を同一seedで再現する。
- 安全性: seed実行中だけfixture対象テーブルのRLSを停止し、`finally`でENABLE/FORCEへ復元する。tenant IDと生成IDは固定UUIDv7形式、氏名・電話・LINE識別子などはsynthetic値のみを使用する。
- 敵対的レビュー: tenant越境、RLS・projection、個人情報、入力値、状態遷移、ページ境界、再投入、規模を確認し、Critical / Highは0件。RLSテスト側はexpanded fixtureと共存するようavailable添付とprojection権限を明示した。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、`pnpm typecheck`、Biome、fresh local stackのmigration・seed・central RLS test、PR品質ゲートを成功。`pnpm test:integration`のWindows固有Prisma DLL rename EPERMはseed後に発生したため、同じfresh stackでPrisma再生成を省いた手動相当検証を完了した。
- 統合: 実装PR #197を2026-08-26に`develop`へマージ（merge commit `f700ade11893f79294b778b98b7ed63062717350`）。

## LOCAL-FIXTURE-002 実施記録

- 対象: ローカル開発用DB seedとDBレベル負荷試験。migration、production、staging、公開APIのデータは変更していない。
- 規模: 1,001チーム、各10部員の10,010部員、部員ごとに父・母を想定した20,020保護者リンクを生成し、ページャー用tenant Cにも1,001部員相当の読み取り負荷を与えられるようにした。
- 全テーブル保証: `fixtureTables`に含む全31テーブルをseed後に実DBで集計し、最低1,000件を満たさない場合はseedを失敗させる。適用後の最小件数は1,001件だった。
- 網羅範囲: student/adult、active/suspended/retired、guardianの父母リンク、招待のpending/accepted/expired/revoked、添付のuploaded/available/rejected/deleted、予定・出欠、購買・支払、回覧・既読、LINE接続・配送、送迎のdraft/open/closed/finalizedと割当状態を合成データで再現する。
- 安全性: tenant・関連IDを同一チーム範囲へ固定し、実在個人情報やsecretは使用しない。seed中だけfixture対象テーブルのRLSを停止し、`finally`で全31テーブルをENABLE/FORCEへ復元する。再投入は既存制約に合わせて冪等化した。
- 負荷試験: `test:load`で50 worker・各20回、合計1,000件のRLS付きmembers/events/announcements/membershipsページ取得を複数tenantで実行した。1,000/1,000成功、失敗0、p95 546ms、最大568msで、p95閾値1,000ms以内だった。
- 検証: `pnpm test`、`pnpm test:unit`、`pnpm build`、スクリプト型検査、Biome、trust-root、改行、PR本文、ローカルDB件数、RLS 31/31を成功。fresh test stackのmigration・seedも成功したが、統合assertionはWindowsのPrisma query engine DLL rename EPERMで開始前に停止した。
- 敵対的レビュー: tenant越境、認可、個人情報、入力値、状態遷移、競合・冪等性、ページ境界、テスト不足を確認し、Critical / Highは0件。
- 統合: 実装PR #199を2026-08-26に`develop`へマージ（merge commit `751ff6bd15c33985c309c6c70daa1e4fa376ee81`）。

## LOCAL-FIXTURE-003 実施記録

- 対象: ユーザー操作で蓄積するトランザクション中心のローカルDB seedとDB負荷試験。migration、production、staging、公開APIのデータは変更していない。
- 機能定義: 旧fixtureが生成していた「大量検証機能」を削除し、現行8機能の定義とtenant feature flagだけをseedする。再seed時も旧仮想機能の関連flagを先に削除する。
- 規模: 負荷用tenant Cへユーザー操作相当の部員1,001件、保護者所属・リンク各2,002件、予定1,001件、予定ごとの出欠回答1,002,001件、公開回覧1,001件、既読1,001件を生成する。
- 負荷試験: 出欠回答を予定単位のページ取得として負荷計画へ追加し、tenant_idとevent_idを固定したRLS付きクエリを実行する。デフォルト50 worker・各20回の1,000リクエストで1,000/1,000成功、失敗0、p95 599msだった。
- 安全性: 生成IDはUUIDv7形式、ユーザー・表示名は合成値のみ、seedは再実行可能なON CONFLICTを使用する。出欠回答はDBトリガーの回答者制約に合わせてowner-cの管理者操作として登録する。
- 検証: `pnpm test`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、trust root、ローカルtest DBの42 migration確認・seed・負荷試験、`git diff --check`を成功させた。
- 敵対的レビュー: tenant越境、認可、個人情報、入力値、状態遷移、冪等性、ページ境界、現行機能限定を確認し、Critical / Highは0件。
- 統合: 実装PR #240（merge commit `533000f9d08be68b86f5a1ea0982065643253dca`）を2026-08-29に`develop`へマージした。本記録は実装PRと分離したdocs-only PRで更新する。

詳細な重大度と次の行動は[レビュー状況](reviews/README.md)と[中断再開タスクリスト](resume-task-list.md)に集約しています。

## 履歴の更新規則

- 完了済みの実装は、この文書へ一行で追記する。
- 実装PRへ履歴や検証ログを混在させず、docs-onlyの変更に分ける。
- 未完了の作業、PR番号、作業ツリー、停止条件はこの文書へ戻さず、再開タスクリストへ置く。
- 過去レビューの本文を再掲せず、未解決の指摘と完了判定だけを残す。
