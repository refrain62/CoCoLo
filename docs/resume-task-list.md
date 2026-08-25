# 中断再開タスクリスト

更新日：2026-08-25

状態：残タスク継続中

この文書は、作業を再開するときに、現在の実装状態、レビュー指摘、作業ツリーの差分、依存関係、検証条件を復元するための台帳です。

## 再開時の読み込みルール

再開時に最初に読む文書は、この台帳だけにします。

完了済みの実装内容、検証結果、レビューの経緯は、[完了タスクと実施履歴](resume-task-history.md)へ移しています。

履歴文書は、現行タスクが参照を指定している場合、同じ検証を再実行する場合、状態差分やレビュー判断の根拠を確認する場合、監査記録を作る場合だけ該当見出しを読みます。

完了項目をこの台帳へ再掲しません。

タスクを完了したときは、実施内容を履歴文書へ追記し、この台帳から完了項目を削除します。

## 1. 停止時点の基準

実装再開の基準となる`develop`は`1086e90`（PR #168反映後）です。直前の実装基準は`61ae68a`（PR #167反映後）です。管理者再試行APIとworkerのロック順序修正、LINE Webhook受信境界、LINE公開レスポンス契約、役員連絡先、注文API、回覧板、認証チーム選択、添付、送迎の公開レスポンス契約、回覧添付のavailable状態DBガード、UUIDv7移行前検査、回覧板添付の短期URLダウンロード、LINE Web通知の現行producer接続、送迎WebのauthenticatedFetch接続、予定編集の全項目更新、PC・スマートフォン向けUI基盤、ログインレイアウト、操作導線のタップ領域、保存操作の二重送信防止、権限別操作表示、Node.jsとpnpmのtoolchain固定検証、qualityでの全体検証、CR改行・BOM・UTF-8・末尾LF検査、GitHub ActionsのNode 24移行まで反映済みです。完了済み実装の詳細は[完了タスクと実施履歴](resume-task-history.md)へ移しています。

`develop`へ反映済みの機能と停止時点までの実施履歴は、[完了タスクと実施履歴](resume-task-history.md)に移しています。

Draft PRに実装が存在しても、`develop`へ統合されていない機能は現行環境では未実装として扱います。

再開処理では、`develop`への直接コミット、force push、未コミット差分の破棄を行っていません。前回停止後にレビューとCIを通過したPR #54、#44、#38、#59、#60、#62、#65、#67、#77、#80、#82、#85、#89、#91、#93、#112、#113、#114、#115、#116、#143、#145、#147、#149、#151、#152、#156、#158、#160、#161、#163、#166、#168、docs-only PR #55、#56、#57、#58、#61、#63、#66、#81、#83、#86、#87、#88、#90、#92、#144、#146、#148、#153、#157、#162、#164、#167は、専用ブランチからスカッシュマージ済みです。詳細は履歴文書と検証手順書を参照します。

### 1.1 再開時のGitHub同期結果

GitHubの最新状態は、次のルールで扱います。

- `develop`へ未統合のDraft PRは、CIが成功していても「未実装」として扱います。
- #36、#43は、現行`develop`に既に存在するmigration、LINE webhook、release/trust-root検査と重複または契約不一致があるため、現PRをそのままマージしません。
- #41、#42、#48は、古いbaseまたはtrusted rootへの依存が残るため、現行`develop`から再検証できる専用の小さなPRへ分解します。
- #40は旧LINE outbox統合と複数featureの古いbaseを含むためクローズしました。追加通知は現行developのoutboxへ機能単位に接続します。#36の旧Webhook契約を前提にしません。
- #35と#37は、現行developを起点に再構成したPR #89、既存中央schemaへ置換済みのためクローズしました。
- #51と#6は`main`向けまたは`main`をbaseとするPRであり、`develop`向けの機能マージ候補から除外します。

現時点でopenのPRに、`develop`へ安全に直接マージできるものはありません。#41は古いbaseと重複するDraftでqualityが失敗、#32は`integration/all-features`向け、#51と#6は`main`向けです。現行developにはPR信頼ゲートの実装がすでに存在するため、#41を再構成する必要はなく、main側のowner-only bootstrapとdefault branchでの有効化を外部停止条件として管理します。#35、#37、#40は現行developへの安全な直接マージ候補ではありません。#48はクローズ済みです。

### 状態記号

- `[~]`：実装または修正が進行中で、再開時に検証が必要な項目
- `[ ]`：未着手、または前提PRの完了待ちの項目
- `[!]`：外部操作、所有者承認、環境資格情報など、コード以外の停止条件がある項目

完了した項目は、完了確認後にこの台帳から削除し、履歴文書へ移します。

## 2. 最初に行う復元作業

再開時は、次の順序で作業状態を確認します。

1. Node.js 24.12以降とpnpm 10.26.0を確認します。
2. `develop`、`origin/develop`、対象PRのhead SHAを確認します。
3. 次の作業ツリーで`git status --short --branch`を実行します。
4. 未コミット差分を確認し、`git reset --hard`、`git clean`、force pushを実行しません。
5. 差分を作成した担当ブランチへ戻り、実装、テスト、commit、push、CI、敵対的レビューの順に再開します。
6. CriticalまたはHighの指摘が残るPRを次の機能へ進めません。

### 作業ツリーの保存場所

| 対象 | パス | 停止時点 |
| --- | --- | --- |
| PR #41 | `C:\develop\repositories\CoCoLo\.worktrees\t014-pr-gate` | `fcc4b83`、未コミット差分なし |
| PR #42 | `C:\develop\repositories\CoCoLo\.worktrees\t014-db-integrity` | `a66bc2a`、未コミット差分なし |
| PR #43 | `C:\develop\repositories\CoCoLo\.worktrees\t014-schema-drift` | `69a58b0`、修正差分あり |
| PR #48 | `C:\develop\repositories\CoCoLo\.worktrees\t014-security-scanners` | `00e24ff`、修正差分あり |
| PR #50 | `C:\develop\repositories\CoCoLo\.worktrees\t014-trust-root-bootstrap` | `15c082a`、修正差分あり |
| 停止時の共有作業ツリー | `C:\develop\repositories\CoCoLo` | `feature/t014-periodic-e2e`、scanner関連の未コミット差分あり |

共有作業ツリーのscanner差分は、PR #48の修正差分と同一視せず、内容を比較してから扱います。

## 3. T-014の再開タスク

T-014は、PR信頼ゲート、DB整合性、schema drift、scanner、trusted root、定期E2E、分散rate limitを対象とするCI強化です。

実装計画ではT-013が未完了のまま残っていますが、実作業の単位は次のT-014 PR群です。

### 3.1 trusted rootのbootstrap

- `[~]` **T014-ROOT-001：mainのowner-only bootstrapを完了する。**
  - 対象：PR #51
  - ブランチ：`feature/t014-trust-root-main-bootstrap`
  - 最新commit：`c12d411`
  - base：`main`
  - 状態：Draft、CI check未報告
  - 確認事項：main側の`trust-root.json`、trust contract、trusted manifest、manifest self-hash、scanner rule 3ファイルの保護対象が一致することを確認します。
  - 外部条件：リポジトリ所有者がowner-only手順を実行し、bootstrap commitを保護対象として確定します。
  - 完了条件：owner-only bootstrapの実行記録、main向けCI、trusted root検査、悪性fixture検査が成功することです。

- `[ ]` **T014-ROOT-003：mainからdevelopへのtrusted root昇格契約を確定する。**
  - develop側のbootstrapはPR #50とスカッシュ後のPR #54で完了済みです。再開時は完了済み実装を再作成せず、mainとの昇格契約だけを確認します。
  - mainとdevelopが別rootとして独立してしまわないことを確認します。
  - manifest、trust contract、bootstrap extension、scanner ruleのhashが、mainからdevelopへ昇格する経路で検証されることを確認します。
  - GitHub Free環境でCODEOWNERSが自動強制されない前提を、owner-only手順とCIの停止条件へ反映します。

### 3.2 security scanner

- `[~]` **T014-SCAN-001：scanner ruleの改変をtrusted path検査へ接続する。**
  - 対象：PR #48
  - ブランチ：`feature/t014-security-scanners`
  - 最新commit：`00e24ff`
  - 現行developからの再構成コミット：`codex/t014-scanner-protected-paths@7601d08`（ローカル保存済み、未push）
  - base：`feature/t014-trust-root-bootstrap`
  - 最新成功CI：品質ゲート run `32596118308`
  - 未コミット差分：`.github/security/fixtures/malicious-scanner-pr.json`、`.github/workflows/security-scanners.yml`、`scripts/security-scanner.test.ts`、`scripts/verify-security-trust.ts`、`scripts/verify-workflows.test.ts`、`scripts/verify-workflows.ts`
  - 直前レビューのHigh：`.gitleaks.toml`、`.semgrep/ci.yml`、`.trivy-secret.yaml`がprotected pathsに列挙されていても、`isProtectedPath`と差分hash検査の対象から漏れることです。
  - 再構成では3ファイルのprotected判定と`previous_filename`を実装し、renameをfail-closedにしました。Critical/Highのコード指摘は解消済みです。
  - 停止条件：`scripts/verify-trusted-pr.ts`、manifest、quality workflow、package scriptがprotected対象のため、現行baseのowner-only extensionを更新する所有者操作が完了するまでpush、CI、マージを行いません。
  - 完了条件：3ファイルを変更する悪性fixtureが検査で拒否され、manifest、CODEOWNERS、trust root、scanner workflowの許可対象が一致することです。

- `[~]` **T014-SCAN-002：scanner初回導入時のpush境界を成立させる。**
  - `event.before`側にscannerファイルが存在しない初回導入では、正当な導入を検査可能にします。
  - 初回導入を例外扱いする場合も、owner-only bootstrap extension、対象path、許可SHA、変更後の固定hashを限定します。
  - 任意のbase欠落を許可してgeneric trustを弱めないことが条件です。

- `[ ]` **T014-SCAN-003：scanner workflowのtoken露出を閉じる。**
  - `GITHUB_TOKEN`をjob全体の環境変数へ置かず、GitHub APIを呼ぶstepだけへ渡します。
  - `pnpm install`のlifecycle scriptからtokenを読めないことをfixtureで確認します。
  - Gitleaks、Semgrep、Trivyのimage、version、digest、rule、exception、report schemaをfail-closedで検査します。

### 3.3 PR信頼ゲート

- `[~]` **T014-PR-001：developのPR信頼ゲートをmainへ昇格する。**
  - 対象：現行developの`.github/workflows/pr-trust-gate.yml`、`scripts/verify-trusted-pr.ts`、PR #41、PR #51
  - PR #41は古いbaseと現行developの実装が重複するため、直接マージせず、現行develop側の実装を正本として扱います。
  - developではbase SHA、trusted manifest、PR files API、PR本文7区画、protected pathの変更をfail-closedで検査します。
  - main側のowner-only bootstrapとdefault branchでのworkflow実行確認が未完了です。
  - 完了条件：owner-only bootstrapの記録、main向けCI、trusted root検査、悪性fixture検査、developへの同一root昇格確認が揃うことです。

### 3.4 DB整合性と権限検査

### 3.5 schema driftとdeploy provenance

### 3.6 T-014の周辺タスク

- `[ ]` **T014-E2E-001：PR #46のperiodic E2Eを再検証する。**
  - ブランチ：`feature/t014-periodic-e2e`
  - 最新commit：`988a9d7`
  - 状態：静的レビューは通過していますが、Docker Engineを使ったPostgreSQL付きlocal E2Eの実行証跡がありません。
  - 既存レビューの詳細：[T014-E2E-001の履歴](resume-task-history.md#t014-e2e-001)
  - 日次、週次、手動SHA指定、固定レポート、個人情報秘匿、失敗Issue同期、retryなしをGitHub Actionsで確認します。

- `[ ]` **T014-RATE-001：PR #47の分散rate limit adapterを配置条件まで検証する。**
  - ブランチ：`feature/distributed-rate-limit-adapter`
  - 最新commit：`8e53e80`
  - 状態：静的レビューは通過していますが、実Redis adapterを使ったstaging検証がありません。
  - 既存レビューの詳細：[T014-RATE-001の履歴](resume-task-history.md#t014-rate-001)
  - 実Redis adapter、Luaまたは同等の原子処理、複数API instance、TTL、障害時503、非PIIキーをstagingで確認します。

- `[ ]` **T014-RELEASE-001：T-014全PRの共通CIとレビュー記録を更新する。**
  - 各PRの最新head SHA、CI run、Docker実DB結果、敵対的レビュー結果を`/docs`へ記録します。
  - `docs/ implementation-plan.md`のT-013状態を、実際の完了条件と一致するよう更新します。
  - Critical、Highが0件になるまで完了チェックを付けません。

## 4. LINE配信の残タスク

- `[~]` **LINE-DELIVERY-001：修正済みschedulerを統合後の環境で検証する。**
  - 対象：PR #44
  - ブランチ：`feature/line-delivery-scheduler`
  - 最新commit：`f1c27c2`
  - 状態：実装、quality CI、独立再レビューは完了しています。`develop`への統合、LINE providerのstaging接続、unknown照合運用、Windowsのlint改行差分の再確認が残っています。
  - 完了済みの実施内容：[LINE-DELIVERY-001の履歴](resume-task-history.md#line-delivery-001)

- `[ ]` **LINE-DELIVERY-002：unknown照合運用を別機能として設計する。**
  - `unknown`を自動claim対象へ戻さない前提を維持します。
  - provider側の送達確認、retry keyの保持期間、重複送信リスク、管理者による再照合、再送の監査を仕様化します。
  - 仕様と運用手順が決まるまで、unknownを自動的にsentまたはfailedへ変更しません。

## 5. 認証と共通基盤の未統合タスク

- `[ ]` **AUTH-001：複数チーム所属時の明示的チーム選択を統合する。**
  - 対象：PR #31、`feature/auth-team-selection`
  - API、Web、RLS、再読み込み時の選択状態、複数所属の実DB検証を中央mountへ接続します。
  - 所属一覧を認証情報の一部として扱い、利用者入力のtenant IDだけで認可しないことを確認します。

- `[~]` **API-001：共通API hardeningを中央APIへ接続する。**
  - 対象：PR #29、`feature/api-hardening`
  - CORS allowlistはPR #59、認証後のtenantとuser単位rate limitはPR #60で`develop`へ接続済みです。
  - 構造化ログとruntime response schema検証はPR #62で`apps/api/src/app.ts`へ接続済みです。
  - 中央APIの複数tenant所属時の明示的チーム選択はPR #89、Web側の選択状態と主要API header接続はPR #91、既存AuthSessionManagerのWeb接続はPR #96で完了しました。PR #114でLINEの接続状態・接続・解除を中央mountへ接続し、PR #117で通知登録を現行outboxへ接続、PR #120で接続世代検証をfail-closed化しました。再試行APIとWebhookはNOT-001へ残しています。
  - staging、productionでは分散rate limit adapterを必須にし、in-memory fallbackを許可しません。

- `[~]` **API-002：WebとAPIの中央mountを統合する。**
  - 対象：PR #32、現行develop起点のPR #89
  - PR #89でauth team選択、役員連絡先、回覧板、送迎のAPI routeを中央mountし、中央認証、tenant再解決、rate limit、CORS、response envelope契約を接続済みです。
  - PR #91でログイン後のactiveチーム一覧、複数所属時の選択画面、再読み込み時の候補照合、auth context/部員/予定APIへの選択tenant header付与を接続済みです。
  - PR #93で役員連絡先と回覧板のWeb画面をmountし、両APIへ選択tenant headerを付与しました。役員管理操作はowner/adminだけに表示します。
  - PR #102で添付upload APIを中央mountし、中央認証、選択tenant、rate limit、R2実adapter、response契約を接続しました。
  - PR #105で添付Web画面を中央APIへ接続し、選択tenant headerとguardianの表示制御を追加しました。
  - PR #109で注文・集金APIをPrisma repositoryと中央mountへ接続し、PR #110で注文Web画面、選択tenant header、チーム切替時の状態破棄を接続しました。
  - PR #123でowner/admin向けの管理者再試行APIを現行outboxへ接続し、PR #125でworker claimと管理者再試行のロック順序を統一しました。PR #127でWebhookの専用DB actor境界を追加し、PR #129でLINE公開レスポンス契約を厳密化し、PR #131で役員連絡先の公開レスポンス契約を追加し、PR #133で注文APIの公開レスポンス契約を追加し、PR #135で回覧板APIの公開レスポンス契約を追加し、PR #137で認証チーム選択の公開レスポンス契約を中央APIへ適用し、PR #139で添付APIの公開レスポンス契約を拡張し、PR #141で送迎APIの公開レスポンス契約を追加し、PR #147で回覧板詳細の添付ダウンロードを中央添付APIへ接続し、PR #149でLINE Web通知を現行producerへ接続し、PR #151で送迎WebをauthenticatedFetch経路へ接続し、PR #152で予定編集の全項目更新とAsia/Tokyo日時変換を接続しました。残りは全画面の統合テストとstaging Supabase E2Eです。送迎画面の予定選択はPR #112、チーム選択前のlogout導線はPR #113で完了しました。古いPR #35はクローズしました。
  - route重複、認証middlewareの順序、OpenAPI生成、レスポンスruntime検証はPR #89で確認済みです。

- `[~]` **DB-002：T037の残存Medium境界を後続mount前に解消する。**
  - 対象：board contact PIIのDB直接SELECTです。
  - PR #143で回覧添付のavailable状態をDBトリガーへ移し、実PostgreSQL/RLS検証を含む残りの項目は継続します。
  - PR #145で既存UUIDv4行の移行前検査をDB integrity、staging、productionのmigration前workflowへ接続しました。実DBでの検査実行は環境準備後に確認します。
  - 各項目は機能mountの専用PRへ分離し、CriticalとHighを0件にしてから統合します。

- `[ ]` **RELEASE-001：release artifactの環境境界を統合する。**
  - 対象：PR #38、`feature/release-artifact-env-boundary`
  - Supabase URL、JWKS path、R2 bucket、環境名、secret注入順序、artifact SHAをstagingとproductionで分離します。
  - Service Role Key、JWT、DB接続文字列、個人情報がartifact、ログ、監査metadataへ混入しないことを確認します。

## 6. Phase 2の未統合タスク

EVT-001はPR #65として完了し、実施記録と再発防止記録を[resume-task-history.mdのEVT-001](resume-task-history.md#evt-001)と[verification-runbook.mdのEVT-001記録](verification-runbook.md#追加記録evt-001中央接続の実db検証漏れとrlsロック境界-2026-08-23)へ移しました。


## 7. Phase 3の未統合タスク

- `[ ]` **BRD-001：役員名簿と連絡先表示を統合する。**
  - 対象：PR #22、`feature/phase3-board-contact`
  - 年度役職枠、担当者、前年度からの枠複製、電話番号表示設定、個人情報投影、owner/admin認可を中央schemaへ接続します。
  - 既存レビューのMediumである中央migration、RLS、実DB統合テストを完了します。

- `[~]` **ORD-001：共同購買と集金を本番DBへ統合する。**
  - 対象：PR #25、`feature/phase3-orders-payments-isolated`
  - 商品、選択肢、注文、担当部員境界、支払い状態、監査、集計、UTF-8 BOM付きCSVを統合します。
  - PR #109でfeature側のmemory adapterをPrisma repositoryへ置き換え、中央API、migration既存RLS、idempotency、監査、CSV式注入対策を接続しました。PR #110で注文Web画面と選択tenant headerを接続しました。
  - 残りはlocal/staging PostgreSQLでのrepository・RLS・状態遷移・同時実行の実DB検証とstaging Supabase E2Eです。注文APIのfeature固有response契約はPR #133で完了しました。詳細は[ORD-001の履歴](resume-task-history.md#ord-001-共同購買集金の中央接続)と[注文APIレスポンス契約の履歴](resume-task-history.md#api-002ord-001-注文apiの公開レスポンス契約)を参照してください。

## 8. Phase 4の未統合タスク

- `[~]` **FIL-002：Cloudflare R2の実adapterをstagingへ接続する。**
  - 対象：PR #39、`feature/phase4-r2-real-adapter`
  - PR #102でprivate bucket向けのR2実adapter、環境別bucket、HTTPS、署名URL期限、object key、HEADまたはGET metadata、PUT、GET、DELETEのAPI wiringを完了しました。
  - stagingで実バケットを使った署名URL期限、実体検証、cleanup、認可済みdownloadを確認します。
  - local fake adapterとproduction adapterの切り替えを環境変数だけで認可根拠にしないことを確認します。

- `[~]` **ANN-001：回覧板と既読管理を統合する。**
  - 対象：PR #30、`feature/phase4-bulletin-board`
  - 掲載、添付ID、参照、既読記録、未読者一覧、RLS、監査、opaque user IDを中央routeへ接続します。
  - PR #147で回覧板詳細から認証済みattachment APIの短期URLを使う添付ダウンロードを接続しました。
  - 添付の非公開配信とR2の認可を結合して確認します。

- `[~]` **NOT-001：LINE通知契約とWebhookを統合する。**
  - 対象：PR #28、PR #36
  - PR #114で接続状態・接続・解除を中央APIへmountし、PR #117で通知登録を現行`line_delivery_outbox`へ接続しました。接続済みの現在グループ以外は拒否し、接続世代をoutboxへ保存します。PR #120でcontext欠落、旧世代のNULL、同一冪等キーの再送をfail-closed化しました。
  - PR #127で、旧`line_notification_queue`と現行`line_delivery_outbox`を混在させずにWebhookを公開入口へ接続しました。専用のDB actor、別接続設定、署名検証、destination検証、receiptの重複排除、未知groupの無視、Webhook専用rate limitを実装済みです。管理者再試行APIはPR #123、workerのロック順序はPR #125で現行outboxへ接続済みです。
  - PR #149でLINE Web画面の通知登録を現行`/api/v1/notifications/line` producerへ接続し、接続groupのdestination、冪等キー、owner/admin境界を適用しました。
  - LINE channel、groupIdとtenantの紐付け、未接続状態、署名検証、Webhook重複排除、未知group拒否、再試行、LIFF、deep linkを統合します。
  - `POST /api/v1/notifications/line`、Webhook route、outbox、workerを同一の認可と監査契約で確認します。

- `[ ]` **NOT-002：LINEグループ連携を実サービスで受け入れる。**
  - staging専用LINE channelとテスト用groupを用意します。
  - groupIdの登録、Webhook署名、予定作成から通知送信までの流れ、通知内deep link、未接続、provider 4xx、provider timeout、再送を確認します。
  - 本番group、個人LINE、アクセストークン、Webhook raw bodyをlocalログへ持ち込みません。

## 9. Phase 5の未統合タスク

- `[ ]` **RIDE-002：Google Maps連携の外部条件を確定する。**
  - API key、許可origin、利用規約、費用上限、障害時の表示、リンクだけで代替する条件を運用文書へ追加します。
  - 外部APIが未設定のlocalとstagingを「連携済み」と表示しません。

## 10. 外部サービスと本番運用の残タスク

- `[!]` **OPS-001：Supabase Authのstaging接続を完了する。**
  - staging専用project、テスト専用user、JWKS、password grant、refresh、logout、停止ユーザーを設定します。
  - production userやproduction tokenをlocalへ持ち込みません。

- `[!]` **OPS-002：Supabase PostgreSQLのstaging接続を完了する。**
  - migration owner、`cocolo_app`、worker role、shadow role、RLS、backup、接続TLS、schema driftを設定します。
  - DB分離時に守る契約は`docs/database-separation-plan.md`と一致させます。

- `[!]` **OPS-003：Cloudflare R2の環境分離を完了する。**
  - local、staging、productionでbucket、access key、endpoint、署名URL期限を分離します。
  - public bucket、公開URL保存、長期署名URLを許可しません。

- `[!]` **OPS-004：LINE Messaging APIとLIFFの本番条件を確定する。**
  - channel secret、access token、Webhook URL、group受信条件、LIFF URL、deep link、retry key保持期間、障害連絡先を確定します。
  - 未接続状態を成功として表示しません。

- `[!]` **OPS-005：分散rate limitの実providerを配置する。**
  - Redisまたは同等サービス、原子的consume、Lua、TTL、secret、複数API instance、provider障害時503をstagingで確認します。

- `[!]` **OPS-006：GitHub Actionsの保護設定を確定する。**
  - mainとdevelopのbranch protection、required checks、Environment approval、CODEOWNERS、Actions permission、artifact attestationを設定します。
  - GitHub Freeの制約で技術的に強制できない条件は、owner-only手順とfail-closed検査へ記録します。

- `[!]` **OPS-007：stagingからproductionへの昇格を実施する。**
  - staging成功run、同一commit SHA、同一artifact checksum、migration checksum、DB検査、smoke、E2E、attestationを確認します。
  - productionへ別commitをcheckoutして検査する経路を許可しません。

## 11. 当初要求差分の残タスク

- `[ ]` **ORIG-REQ-001：当初要求との差分を実装してdevelopへ統合する。**
  - 対象：`docs/original-requirements-traceability.md`、機能仕様書の FS-COM-006、FS-MEM-006、FS-EVT-004〜005、FS-DUT-001〜002、FS-ORD-005、FS-FIL-003、FS-NOT-002、FS-RIDE-002、FS-UI-001。
  - 状態：要求と設計への反映のみ完了。機能コード、DB migration、公開API、Web画面、実DB RLS、staging E2Eは未完了として扱います。
  - 実装順：WebとLINEの責務、表示名と保護者連携、月間表と当番、出欠と集金の通知、地図と画像、deep link、配車表、モバイル表示を機能単位へ分割します。
  - 完了条件：各機能のTDD、tenant越境と認可検査、個人情報投影、状態遷移と冪等性、競合検査、外部サービス未接続と障害の表示、staging E2E、Critical / High 0件の敵対的レビュー、develop向けPRのCI成功とマージです。
  - 参照：`docs/original-requirements-traceability.md`、`docs/functional-specification.md`、`docs/ implementation-plan.md` の ORIG-REQ-001。

## 12. フロントエンドUI/UXの残タスクと実装ルール

- `[~]` **UI-001：CoCoLoの全画面をPC・スマートフォン対応のUIへ再設計する。**
  - 専用ブランチ：`feature/frontend-chadcn-responsive`
  - shadcn/uiの設計思想に沿う再利用可能なUIプリミティブ、共通デザイントークン、AppShell、カード、フォーム、状態表示を導入します。
  - 既存のAPI、認証、tenant境界、role認可、個人情報投影の責務は変更せず、画面の情報設計と操作体験を改善します。
  - PC幅ではナビゲーション、主要情報、操作領域を明確に分離し、スマートフォン幅では片手操作、横スクロール、タップ領域、入力順序を優先します。

- `[~]` **UI-002：UI/UXの受入検証を完了する。**
  - 390px幅、430px幅、768px幅、1280px以上で主要画面を確認し、レイアウト崩れ、不要な横スクロール、入力フォーカス喪失、操作不能なボタンを残しません。
  - loading、success、error、empty、disabled、権限不足、未接続状態を利用者が判断できる文言と見た目で表示します。
  - キーボード操作、visible focus、コントラスト、`aria-live`、reduced-motion、44px以上を目安にしたタップ領域を確認します。
  - データ表だけは小画面で安全な横スクロールを許可し、ページ全体の横スクロールは許可しません。
  - PR #156・#158で共通UI基盤と操作状態、PR #168で認証カードの中央配置と主要操作導線の44pxタップ領域を実装しました。390px、430px、768px、1280pxのlocal browser受入、`pnpm test`、`pnpm build`、`pnpm typecheck`、Biome検査、quality、Critical / High / Medium 0件の敵対的レビューまで完了しました。残りは認証済み主要画面のrole別ブラウザ受入とstaging確認です。

- `[ ]` **UI-003：保存操作のサーバー冪等性とrole別ブラウザ受入を完了する。**
  - 予定、注文、LINE接続・通知、部員管理などの保存APIで、再試行・通信タイムアウト・ブラウザ再送時も同一業務操作を一意に扱える安定した冪等キー契約を定義します。
  - owner/admin/staff/guardianごとに、許可・閲覧専用・禁止操作の表示とAPI応答をlocal実DBおよびstagingの専用ユーザーで確認します。
  - 外部サービス未接続、タイムアウト、失敗、再試行、権限不足を利用者が判断でき、誤操作を再送しないことをPlaywrightで記録します。

### UI/UX実装ルール

- 新しい画面・大幅改修では、既存のインラインstyleや画面ごとの独自色を増やさず、共通UIプリミティブとデザイントークンを優先します。
- UIだけの見栄えを優先して、tenant越境、認可、個人情報、状態遷移、入力検証、冪等性、API response契約を緩めません。
- クリックできる要素にはdisabled、処理中、成功、失敗、再試行の状態を設計し、二重送信と「押せたか分からない」状態を残しません。UIのdisabledだけを冪等性の根拠にせず、保存APIの契約と競合検証を併記します。
- 権限不足の利用者には実行不能な管理操作を表示せず、閲覧可能な範囲と理由を明示します。表示制御はAPIの再認可を代替しません。
- loading、empty、error、success、disabled、forbidden、未接続を状態行列として設計し、文言、視覚状態、`role`、再試行導線を各画面で一致させます。
- PCとスマートフォンの両方で、主要導線がスクロール位置、画面幅、入力方法に依存せず完了できることを受入条件にします。
- 完了したUI実装は、実装PRと台帳・検証記録のdocs-only PRを分離し、Critical / Highの指摘を0件にしてからdevelopへ統合します。

## 13. 再開時のレビュー手順

機能単位では、次の順序を崩しません。

1. `/docs`の機能仕様IDとこの台帳の依存タスクを確認します。
2. 専用ブランチの未コミット差分を確認します。
3. Red、Green、Refactorの順に実装します。
4. tenant越境、認可、個人情報、入力検証、状態遷移、競合、テスト不足、仕様不整合を敵対的に確認します。
5. CriticalとHighを0件にします。
6. Node.js 24、pnpm 10.26.0で`test`、`build`、`typecheck`、`lint`を実行します。
7. 日本語の小さなcommitを作成してpushします。
8. Draft PRのCI成功を確認します。
9. 独立した担当者が最新SHAを再レビューします。
10. レビュー記録とこの台帳を更新してから、次の機能へ進みます。

## 14. 完了判定

この台帳は、次の条件をすべて満たすまで未完了です。

- `develop`上の機能範囲と`docs/functional-specification.md`の受け入れ条件が一致していることです。
- T-014のtrust root、scanner、DB、schema drift、deploy provenanceが同じSHAのCIで成功していることです。
- 各機能PRのCriticalとHighが0件であることです。
- 中央API、Web、DB、OpenAPI、実DB RLS、staging E2Eが統合済みであることです。
- Supabase、Cloudflare R2、LINE、分散rate limit、Google Mapsの未設定状態と障害状態が利用者へ正しく表示されることです。
- productionへstagingで検証した同一artifactだけを昇格できることです。
- 完了したPRのDraft状態、レビュー記録、実装計画のチェック状態が一致していることです。

完了条件を満たす前に、PRを通常公開へ変更したり、`develop`へ統合したりしません。
