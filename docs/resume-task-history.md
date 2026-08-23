# 完了タスクと実施履歴

更新日：2026-08-23

状態：参照用アーカイブ

この文書は、停止時点までに完了したタスクと、未完了タスクで実施済みの変更、検証、レビュー結果を保存する履歴です。

## 読み込み方

再開時は、先に[中断再開タスクリスト](resume-task-list.md)だけを読みます。

この文書は、残タスク台帳が示す見出しを確認するとき、同じ検証を再実行するとき、状態差分の原因を調査するとき、レビューや監査の根拠を確認するときだけ読みます。

履歴を参照するときも、必要なタスクの見出しだけを開き、文書全体を読み込みません。

タスクを完了した場合は、実施内容、検証結果、レビュー結果をこの文書へ追記してから、残タスク台帳から完了項目を削除します。

## 停止時点の基準

停止時点の`develop`は`5e346d1`（部員編集と退部を実装）です。

`develop`へ反映済みの業務機能は、認証、テナント境界、部員一覧、検索、登録、編集、退部、学年表示、年度繰り上げです。

Draft PRに実装が存在しても、`develop`へ統合されていない機能は、停止時点の現行環境では未実装として扱います。

## developへ反映済みの実施内容

- Supabase AuthのJWT検証を追加しました。
- JWTのuser IDからmembershipを解決し、利用者入力のtenant IDを認可根拠にしない境界を実装しました。
- 部員一覧、検索、登録、編集、退部、学年表示、年度繰り上げを実装しました。
- PostgreSQL RLS、監査ログ、OpenAPI契約、local test-only AuthのE2E検証を追加しました。

## LINE-DELIVERY-001

### 実施した変更

- 対象PRは#44です。
- ブランチは`feature/line-delivery-scheduler`です。
- 最新commitは`f1c27c2`です。
- 期限切れleaseが古いtokenで`unknown`を上書きしないようにしました。
- release artifactへAPI実行時のworkspace packageを梱包しました。
- 冪等キーの409、LINE retry keyの扱い、実DB統合テストを補正しました。

### 検証結果

- quality CI run `32597529863`が成功しました。
- 独立再レビューはCritical 0、High 0、Medium 0、Low 0で合格しました。

### 残っている条件

このタスクは、実装とコード上のレビューを完了しています。

`develop`への統合、LINE providerのstaging接続、unknown照合運用の仕様化、Windowsのlint改行差分の再確認は、残タスク台帳で管理します。

## T014-PR-001

### 実施した変更

- 対象PRは#41です。
- ブランチは`feature/t014-pr-gate`です。
- 最新commitは`fcc4b83`です。
- RLS正本、artifact SHA、DB検査、trust rootのfail-closed境界を強化しました。

### 検証結果

- `typecheck`、`build`、`lint`、workflow検査、migration checksum検査が成功しました。
- 対象テスト18件が成功しました。
- PostgreSQL 17のDocker実DB検査が成功しました。

### 完了していない条件

- 停止時点では全体`pnpm test`とGitHub Actions CIを再実行していません。
- trusted rootのbootstrap後に、PR head SHAとbase正本の比較を再検証する必要があります。

## T014-DB-001

### 実施した変更

- 対象PRは#42です。
- ブランチは`feature/t014-db-integrity`です。
- 最新commitは`a66bc2a`です。
- membership resolverを撤去しました。
- RLS正本、SECURITY DEFINER分類、column ACL、artifact SHA検査を強化しました。

### 検証結果

- `typecheck`、`build`、`lint`、workflow検査、migration checksum検査が成功しました。
- 対象テスト23件が成功しました。
- PostgreSQL 17のDocker実DB検査が成功しました。

### 完了していない条件

- 停止時点では全体`pnpm test`とGitHub Actions CIを再実行していません。
- trusted rootのbootstrap後に、app role、BYPASSRLS、membership、ACL、RLS policy、SECURITY DEFINER function、migration履歴、deploy前後DB検査を同一artifact SHAで再検証する必要があります。

## T014-DRIFT-001

### 実施した変更

- 対象PRは#43です。
- ブランチは`feature/t014-schema-drift`です。
- 最新commitは`69a58b0`です。
- schema drift、staging evidence、deployment precondition、release provenanceの検査を実装しました。
- 停止時点では次の修正差分が未コミットでした。

  - `.github/workflows/production-promote.yml`
  - `.github/workflows/quality.yml`
  - `package.json`
  - `scripts/create-staging-evidence.ts`
  - `scripts/database-security.ts`
  - `scripts/database-security.test.ts`
  - `scripts/deployment-preconditions.ts`
  - `scripts/deployment-preconditions.test.ts`
  - `scripts/package-release.ts`
  - `scripts/verify-release.ts`
  - `scripts/verify-workflows.ts`
  - `scripts/release-provenance.ts`
  - `scripts/release-provenance.test.ts`
  - `scripts/staging-evidence.ts`

### レビューで判明した未解決事項

- RLS policyのmarker存在だけでは、owner、admin、user_id、guardian条件を削除したpolicyを拒否できません。
- 任意artifact SHA、自己申告manifest、自己生成staging evidence、直接CLIを、Git commit、GitHub attestation、実staging runへ結び付ける必要があります。
- quality workflowのtrigger、permissions、checkout credential、timeout、function本体とtriggerのdrift検査を追加する必要があります。

## T014-SCAN-001およびT014-SCAN-002

### 実施した変更

- 対象PRは#48です。
- ブランチは`feature/t014-security-scanners`です。
- 最新commitは`00e24ff`です。
- Gitleaks、Semgrep、Trivyのsecurity scanner workflowと検査設定を追加しました。
- scanner初回導入時の`event.before`側に対象ファイルが存在しない場合の検査境界を実装しました。
- 停止時点では次の修正差分が未コミットでした。

  - `.github/security/fixtures/malicious-scanner-pr.json`
  - `.github/workflows/security-scanners.yml`
  - `scripts/security-scanner.test.ts`
  - `scripts/verify-security-trust.ts`
  - `scripts/verify-workflows.test.ts`
  - `scripts/verify-workflows.ts`

### 検証結果とレビューで判明した未解決事項

- 品質ゲートCI run `32596118308`が成功しました。
- `.gitleaks.toml`、`.semgrep/ci.yml`、`.trivy-secret.yaml`がprotected pathsと差分hash検査の対象から漏れないことを確認する必要があります。
- 初回導入の例外はowner-only bootstrap extension、対象path、許可SHA、変更後の固定hashへ限定する必要があります。
- `GITHUB_TOKEN`をjob全体へ公開せず、GitHub APIを呼ぶstepだけへ渡す必要があります。

## T014-ROOT-002

### 実施した変更

- 対象PRは#50です。
- ブランチは`feature/t014-trust-root-bootstrap`です。
- 最新commitは`15c082a`です。
- develop向けのtrust root、trusted manifest、bootstrap extension、owner procedure、trust contractを追加しました。
- 品質ゲートCI run `32596723583`が成功しました。
- 停止時点では、trust root、trusted manifest、trust root検証、trusted PR検証、owner procedureに修正差分が残っていました。

### レビューで判明した未解決事項

- scanner rule 3ファイルの保護対象をmainとdevelopの検査へ一致させる必要があります。
- mainとdevelopのroot分離を許容する設計を解消する必要があります。
- manifest self-hashとbootstrap extensionの整合を固定する必要があります。

## T014-E2E-001

### 実施した検証

- 対象PRは#46です。
- ブランチは`feature/t014-periodic-e2e`です。
- 最新commitは`988a9d7`です。
- 静的レビューはCritical 0、High 0でした。

### 未実施の検証

Docker Engine未接続のため、PostgreSQL付きlocal E2Eの実行証跡はありません。

## T014-RATE-001

### 実施した検証

- 対象PRは#47です。
- ブランチは`feature/distributed-rate-limit-adapter`です。
- 最新commitは`8e53e80`です。
- 静的レビューはCritical 0、High 0でした。

### 未実施の検証

実Redis adapter、Luaまたは同等の原子処理、複数API instance、TTL、障害時503、非PIIキーをstagingで確認していません。

## API-001-RATE-002

### 実施した変更

- 対象PRは#60です。
- ブランチは`codex/api-rate-limit-route-coverage`です。
- `POST /api/v1/notifications/line`へ認証後のtenant/user単位rate limitを接続しました。
- exact members routeへwildcard middlewareを重ねないようにし、認証middlewareの重複実行を除去しました。
- rate limit keyの既知ハッシュ値、429応答、Retry-After、request ID、全members業務handlerとLINE producerの未実行をテストで固定しました。

### 検証結果

- `pnpm test`は138件成功しました。
- `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm lint:workflows`が成功しました。
- 最終敵対的レビューはCritical 0、High 0、Medium 0、Low 0でした。
- CI quality run `32611772876`が成功しました。
- PR #60は`a13eb4d`として`develop`へスカッシュマージ済みです。

### 残っている条件

- 構造化ログとruntime response schema検証の中央接続はAPI-001の残タスクです。
- staging、productionの実分散rate limit adapter検証は別の運用タスクとして残っています。

## API-001-OBS-003

### 実施した変更

- 対象PRは#62です。
- ブランチは`codex/api-structured-response-contracts`です。
- 構造化request logger、requestId相関、role別strict response schema、共通error response、response契約middlewareを現行中央APIへ接続しました。
- 非JSON成功responseはallowlist外を500へ収束し、OPTIONSの204だけを明示的に許可しました。
- promotion内部result、LINE response、未知role、client指定requestIdの公開境界をfail-closedにしました。
- OpenAPI生成元と生成物をruntime契約へ同期しました。
- 旧PR #29はそのまま統合せず、現行developへ必要な中央API hardeningだけを再構成しました。

### 検証結果

- rootの`pnpm test`は150件成功しました。
- `pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm lint:workflows`、`pnpm lint:openapi`が成功しました。
- 実DB統合テストは`DATABASE_URL`未設定のため5件失敗・1件skipとなり、RLSとtenant境界の実DB検証は別環境で再実行が必要です。
- 最終敵対的レビューは、対象差分のCritical 0、High 0、Medium 0、Low 0でした。
- 現行develop由来の別スコープとして、LINE feature appの中央mount、複数tenant所属時の明示的チーム選択、Auth session lifecycleが残っています。
- CI quality runは`32614821124`です。

### GitHub反映

- PR #62は`2ce3dbe`として`develop`へスカッシュマージ済みです。
- docs-only PR #63は`a3a735b`として`develop`へスカッシュマージ済みです。
- `origin/develop`の再開基準を`a3a735b`へ更新しました。

## EVT-001

### 実施した変更

- 対象PRは#65です。
- ブランチは`codex/evt-001-central-events-mount`です。
- 中央APIへ予定・出欠のlist、create、update、attendance、summaryを接続しました。
- Webへ認証context、member pagination、月間・週間のevents取得を接続しました。
- runtime response契約、OpenAPI、rate limit、tenant非公開projectionを接続しました。
- DB migrationへactive membership、同一tenant添付、回答一意性、締切後修正理由、一覧上限、集計snapshotの境界を追加しました。
- membership確認はSECURITY DEFINER関数、event競合はtransaction advisory lock、guardian担当判定はRLSの通常SELECTへ分離しました。

### 検証結果

- rootの`pnpm test`は全workspaceで成功しました。
- rootの`pnpm build`は全workspaceで成功しました。
- API単体テスト157件、contracts 20件、domain 12件、DB 4件が成功しました。
- `pnpm verify:trust-root`、`pnpm verify:migration-sql`、Biome検査が成功しました。
- CI quality run `32619201261`は実PostgreSQL統合テスト、型検査、build、release artifact検査を含め成功しました。
- Pascalの最終敵対的レビューはCritical 0、High 0、Medium 0、Low 2でした。
- Zenoの最終契約・統合レビューはCritical 0、High 0、Medium 4、Low 4でした。

### GitHub反映

- PR #65は`5f5a592`として`develop`へスカッシュマージ済みです。
- マージ後の`origin/develop`は`5f5a592`です。
- PR信頼ゲート未展開の判定境界はdocs-only PR #66で別管理しています。

### 再発防止

- 初回CIで発生したtrusted manifest登録漏れ、ハッシュ誤記、pnpmバージョン不一致、pnpm並列実行による依存再構成競合、Prisma値import漏れ、RLS row lock誤用、gh mergeのworktree衝突を`docs/verification-runbook.md`へ追記しました。

## 履歴の更新規則

履歴には、完了したタスクの根拠と、未完了タスクで既に実施した作業だけを記録します。

新しい作業を開始した場合、再開に必要な停止条件は残タスク台帳へ記録します。

作業が完了した場合、完了条件、commit SHA、CI run、検証結果、敵対的レビュー結果をこの文書へ追記し、残タスク台帳から該当項目を削除します。

履歴の内容が現在のブランチやcommitと異なる場合は、履歴を現状の根拠として扱わず、対象ブランチの最新状態を確認します。
