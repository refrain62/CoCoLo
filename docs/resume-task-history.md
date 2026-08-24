# 完了タスクと実施履歴

更新日：2026-08-24

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

## T014-DB-001（現行develop再構成）

### 実施した変更

- 現行`origin/develop` `a51e441534c6850123406057ea4540fc907fd620`を起点に、T014 DB整合性ゲートを再構成しました。
- 実装ブランチは`codex/t014-db-integrity-current`です。
- 実装PR #69はDraft作成後にReady化し、developへsquash commit `daa20025b9c5926fc4070901dcca15d96025a148`として統合しました。
- migration checksum、baseline、履歴、危険SQL、table ACL、RLS、policy、membership関数実体、completed payload不変性を検査対象へ追加しました。
- 実装PRと手順・失敗履歴を混在させず、このdocs-only PRへ分離しました。

### 検証結果

- ローカルのDB整合性fixtureは最終24件成功しました。
- ローカルのmigration SQL検査、workflow検査、trust root検査、Biome、scripts型検査を実行しました。
- CI run `32629376920`のdatabase-integrityが成功しました。
- CI run `32629376984`のqualityが成功しました。
- 実DBCIではPostgreSQL 17への全migration適用、role準備、権限・RLS・policy検査、seedを実行しました。
- 最終敵対的レビューは今回PR由来のCritical 0、High 0でした。

### 失敗から明文化したルール

- DB version検証の引数、role準備順序、migration最終権限、catalogの型cast、監査ログmembership policyを手順書へ固定しました。
- RLS検査は`OR true`、`IS NULL`、`IS NOT NULL`による境界無効化と、membership関数の再定義を拒否します。
- ローカルで`minimumReleaseAge`により全体pnpm検証が開始前に停止した場合は、lockfileを変更せず、CIを正本として記録します。
- 既存のowner-only trust bootstrapがbaseへ反映されていない場合は、実装PRへ混ぜず、owner先行作業を停止条件として残します。

### 残存条件

- T014-PR-001の既存trust bootstrap・PR trust gate展開は別タスクとして継続します。
- 残るMedium以下の後続検証は残タスク台帳で管理します。

## T014-DB-002 / T014-BOUNDARY-001（現行develop再構成）

### 実施した変更

- 現行`origin/develop` `16992813765535e255e82cddd78cc8ccced8e406`を起点に、DB security boundary検査を再構成しました。
- 実装PRは#74（`feature/t014-db-security-current`）で、`develop`へsquash commit `eff61c8414df7ad090a247d5cc663b3b2af3de5d`として統合しました。
- `DATABASE_URL`のapp roleと`DIRECT_URL`のadmin roleを分離して接続し、role属性、DB/schema/object owner、membership、ACL、default ACL、RLS、policy、app_guard functionを実DBのcatalogから検査するようにしました。
- 既存migrationは編集せず、enum・schema・app_guardの権限境界を追加しました。central feature schemaによる関数再作成で設定が失われないよう、後段の`20260823170000_finalize_app_guard_security` migrationでSECURITY INVOKER、`search_path=pg_catalog, public`、PUBLIC EXECUTE拒否、app role EXECUTEを再固定しています。
- Shadow DBは現行全テーブルのowner、ACL、default ACL、membership、RLSを検査し、実DB側は正本対象のphase1 tableと公告掲載者membership policyを検査します。検査対象外の関数を誤って要求しないよう、app_guard functionだけを明示対象にしました。
- PR #42と#43は、#69/#72/#74への再構成・統合済みとしてsuperseded closeしました。

### 検証結果

- ローカルでmigration checksum 17件、migration SQL、trust root、DB integrity 23/23、schema drift 42/42、workflow、typecheck、lint、build、全test（API 157件を含む）が成功しました。
- CI run `32679398348`のdatabase-integrity、`32679398455`のschema-drift、`32679398312`のqualityがすべて成功しました。
- 敵対的レビューでtenant越境、認可、個人情報、入力検証、状態遷移への実装影響を確認し、Critical / Highの指摘はありませんでした。

### 残存条件

- T014-PR-001のtrust bootstrap・PR trust gate展開、T014-E2E-001、分散rate limit、staging接続などは残タスク台帳で継続します。

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

### 完了追記（2026-08-24）

- 現行`develop`基準で実装を再構成し、PR #72（`feature/t014-schema-drift-fix`）として提出しました。旧PR #43の内容を直接mergeせず、PR #72へ必要な変更を集約しました。
- Prisma schemaとmigrationの実DB差分を修正し、schema drift workflow、Shadow DB専用role検査、migration checksum・baseline・履歴検査、staging evidenceとrelease provenanceの接続を含む検証を確定しました。
- CIは`quality`、`database-integrity`、`schema-drift`の全ジョブが成功しました。ローカルでもPrisma validate、schema drift 32/32、`pnpm build`、`pnpm test`（API 157件を含む）が成功しました。
- テナント境界、API認可、個人情報投影、入力検証、業務状態遷移の実装変更はありません。trusted manifestは変更ファイルのハッシュだけを更新し、migrationに存在しないDB制約はPrisma schemaへ追加していません。
- Critical / Highの指摘はありません。PR #72は2026-08-24にmerge commit `a3dcbcd`として`develop`へsquash mergeし、重複するPR #71はsupersededとしてcloseしました。
- 残るT014のtrust root、scanner、DB security boundary、定期E2E、分散rate limit、staging接続などは本台帳の別タスクで継続します。

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

## T037

### 実施した変更

- 対象は中央DB schema、機能別migration、RLS、tenant複合制約、監査、状態遷移、UUIDv7契約です。
- 旧PR #37をそのまま統合せず、現行`origin/develop`を起点にPR #67へ再構成しました。
- 中央migrationを既存Phase migrationの後段へ配置し、重複するenum、table、policy、DDLを除去しました。
- Prisma schemaとDB repositoryへ機能別モデル、UUIDv7生成、RLS transaction context、送迎状態遷移を接続しました。
- LINE通知、Webhook receipt、添付、回覧、注文、送迎、監査のtenant境界と状態制約をDBへ追加しました。
- `ride_plans`のtriggerで表に存在しない`NEW.plan_id`を参照していた不具合を動的列参照へ修正しました。
- DB側のride plan初期statusをdraftに固定し、repositoryをdraft INSERT後のopen遷移へ修正しました。
- 実装PRへ最終敵対的レビュー記録を追加し、手順・失敗履歴はこのdocs-only PRへ分離しました。

### 検証結果

- ローカルの最初のbuildは依存リンク不整合により失敗しましたが、pnpm 10.26.0で依存を再構成後に成功しました。
- 最終実装HEAD `8279af8`で`pnpm verify:migration-sql`、`pnpm verify:trust-root`、`pnpm build`、`pnpm test`、`pnpm typecheck`、`pnpm lint`、`git diff --check`が成功しました。
- CI run `32624831166`は、migration、実PostgreSQL RLS統合テスト、契約テスト、型検査、build、release artifact検証を含め成功しました。
- 最終レビュー記録追加後のCI run `32625018676`も成功しました。
- Hubbleの最終再レビューはCritical 0、High 0、Medium 1、Low 0でした。
- Peirceの最終再レビューはCritical 0、High 0、Medium 3、Low 4でした。
- 残るMediumは、既存UUIDv4行の移行前検査、回覧添付のavailable状態、board contact PIIのDB直接SELECT、Webhook receipt INSERT権限の専用actor限定です。
- CriticalとHighは0件であるため、T037の実装完了条件を満たしました。

### GitHub反映

- 実装PR #67はready化後、squash commit `c31d61a0fab8d9419ddd66fa767060614e0bb3a9`として`develop`へ統合しました。
- 実装PRの最終HEADは`b28c51e2244cb34a454c21d62832d2c31b86ab11`です。
- マージ後の`origin/develop`は`c31d61a`です。
- 実装PRと手順・履歴更新を同一PRへ混在させず、docs-only PRで別管理します。

### 再発防止

- T037で発生した依存導入、検証順序、migration重複、trusted manifest、RLS fixture、UUID型、trigger列、状態遷移、cleanup、merge後処理の失敗を`docs/verification-runbook.md`へ追記しました。
- 実DB接続情報がないローカル実行は、build・unit test成功だけでDB統合成功と判定しません。
- 今後の機能は、同手順書のT037再発防止チェックリストを実装PRとdocs-only PRの完了条件へ適用します。

## EVT-003

### 実施した変更

- 対象は「予定と締切をLINE outboxへ接続する」機能です。旧PR #40をそのまま統合せず、現行`develop`を起点にPR #77として再構成しました。
- 予定作成時のevent通知とdeadline通知を業務transaction内でoutboxへ登録し、UUIDv7、source単位のidempotency、固定payload、同一環境deep-link、接続世代をDB側で検証します。
- workerのclaim、外部送信直前の再検証、lease、attempt token、provider retry key、送信結果の`sent`・`failed`・`unknown`遷移を接続しました。
- tenantのadvisory lockに加え、同一LINE groupの再利用と外部送信をgroup advisory lockで直列化しました。送信中transactionのtimeoutは外部送信上限120秒より長い130秒に固定しています。
- 汎用LINE通知について、別tenantが同一groupを接続中の場合はclaim・送信前検証から除外し、送信中に再利用された場合は`unknown`へ収束させます。この修正は既存migrationを変更せず、後続migration `20260824120000_line_delivery_group_reuse_guard`へ分離しました。

### 検証結果

- ローカル最終実装HEADでは`pnpm test`が164件成功、`pnpm build`、`pnpm typecheck`、`pnpm lint:biome`、`git diff --check`が成功しました。
- migration baseline、checksum、SQL、trust-root、database-integrity 23件、schema-drift 42件が成功しました。
- `pnpm test:integration`は`DATABASE_URL`、`DIRECT_URL`等が未設定のため、実PostgreSQL統合テストを実行できませんでした。実DBのRLS、group再利用競合、timeout中のlock保持、LINE provider E2Eはstagingで別途確認が必要です。
- PR #80のCIはquality run `32686760497`、database-integrity run `32686760559`、schema-drift run `32686760496`がすべて成功しました。

### 敵対的レビュー

- 初回レビューで検出されたclaim後の接続変更と外部送信のTOCTOUは、送信・結果確定までtenant/group lockを保持する実装で解消しました。
- 再レビューで検出されたPrisma interactive transaction既定timeoutによるlock早期解放は、送信timeoutより長い明示timeoutを設定して解消しました。
- 最終レビューはCritical 0、High 0、Medium 2でした。残るMediumは実DB競合テスト未整備と、テスト・非production adapterで`withDeliveryLock`が未提供の場合にtenant lockへフォールバックする構成境界です。productionのPrisma wiringはgroup lockを提供します。

### GitHub反映

- 実装PR #77は`bdfaf9c`として`develop`へスカッシュマージ済みです。
- 旧修正PR #79は既存migration編集をbaselineが拒否するためクローズし、後続migrationへ分離したPR #80へ置き換えました。
- 修正PR #80は`22b2dc4`として`develop`へスカッシュマージ済みです。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- LINE providerのstaging接続、専用channel/groupを使ったE2E、provider送達確認と`unknown`照合運用は`LINE-DELIVERY-002`および`NOT-002`、`OPS-004`として残ります。

## LOCAL-SUPABASE-001

### 実施した変更

- 旧PR #78のquality失敗を起点に、ローカルSupabaseをDockerで起動し、DB role、migration、Auth fixture、RLS fixture、R2 worker環境を同一stackへ接続するPR #82へ再構成しました。
- Auth fixtureからDB fixtureを起動するときに管理者用DB URLを子プロセスへ渡さないよう修正し、fixture投入時だけ対象テーブルのRLSを停止し、必ずRLSとFORCE RLSを復元するようにしました。
- ローカルstackのmigration roleだけを`BYPASSRLS`として作成し、app roleとworker roleは通常のRLS境界を維持しました。ローカルSupabase URLのallowlist、秘密情報のログマスク、local R2固定、失敗時のstack cleanupも追加しました。
- 共有DBを使う統合テストを直列化し、固定fixture IDの衝突を解消しました。

### 検証結果

- ローカルで`pnpm test` 162件、`pnpm build`、`pnpm typecheck`、Biome検査、trust-root、production bundle、workflow検査が成功しました。
- Docker Engineはローカルに存在しないためlocal stack自体の起動証跡は作成できませんでしたが、PR #82のCIでquality run `32690000983`、database-integrity run `32690000984`、schema-drift run `32690000976`がすべて成功しました。

### 敵対的レビュー

- 初回レビューで検出された秘密情報のログ露出、fixture権限、ローカルURL許可範囲、失敗時cleanupの問題を修正しました。
- 修正後の判定はCritical 0、High 0です。実Dockerを使ったローカル再現ができない制約はCI結果で補完し、Medium/Lowの追加改善は完成を妨げないため後続扱いとしました。

### GitHub反映

- 旧PR #78は修正内容をPR #82へ移行したためクローズしました。
- PR #82は`ec14ca87baf39788ca254242084e1f7c2f59c439`として`develop`へマージしました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- Supabase Auth、PostgreSQL、R2、LINE、分散rate limitのstaging接続と実サービスE2Eは、既存のOPS/LINE残タスクとして継続します。

## EVT-002

### 実施した変更

- 旧PR #49は古い`feature/line-notification-outbox`と中央Web mountをbaseとしていたため、そのまま統合せず、現行develop起点のPR #85へ予定詳細の責務だけを再構成しました。
- 予定詳細取得と現在の出欠回答取得をAPI、DB repository、中央APIのruntime response契約、OpenAPIへ追加しました。
- Webの予定一覧から詳細画面を開けるようにし、tenantの認可済み予定情報、保存済み出欠状態、回答登録、締切後の管理者修正理由入力を同じAPI契約へ接続しました。
- 現在の出欠取得ではguardianは自身の回答だけ、管理者はtenant内の最新回答だけを受け取り、`userId`や監査情報は公開レスポンスへ投影しません。

### 検証結果

- ローカルで`pnpm test` 166件、`pnpm test:unit`（Vitest 60件を含む）、`pnpm build`、`pnpm lint`、`pnpm typecheck`、OpenAPI、migration SQL、workflow検査が成功しました。
- 実PostgreSQLを使う統合テストとstaging E2Eは、接続情報およびDocker Engineがローカルにないため未実行です。実DBのRLS競合とstaging接続は既存のOPS/LINE残タスクとして継続します。
- PR #85のCIはquality run `32691578920`、database-integrity run `32691578967`、schema-drift run `32691578934`がすべて成功しました。

### 敵対的レビュー

- 別担当の最新HEADレビューはCritical 0、High 0、必須修正なしでした。
- tenant越境、guardianの回答者境界、公開レスポンスの個人情報、未登録runtime response契約を確認し、必要な修正を実装済みです。

### GitHub反映

- 実装PR #85は`f43b2316cd688f0f6564645028f04705c4283f80`として`develop`へマージしました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

## API-002 中央APIの現行feature mount

### 実施した変更

- 古いPR #35をそのまま統合せず、現行`develop`（`e98da0e`）を起点にPR #89を再構成し、auth team選択、役員連絡先、回覧板、送迎の既存feature appを中央APIへ接続しました。
- feature側の認証・認可・入力検証・projectionを再実装せず、中央APIのroute factoryへ接続しました。board/bulletinは中央認証コンテキストを利用し、二重認証による所属不一致を避けています。
- 複数所属ユーザーの`X-CoCoLo-Team-Id`をUUIDv7として検証し、auth team selection repositoryで`(userId, tenantId, active)`を再確認してから業務APIへ渡すようにしました。ヘッダーなしの複数所属は暗黙選択せず403へ収束します。
- 中央認証対象へboard/bulletin/rideを追加し、認証済みrate limitを適用しました。チーム選択ヘッダーをCORS allowlistへ追加し、ブラウザのpreflight経路も確認しました。
- `packages/db`のboard contact exportと、feature appの中央認証切替オプションを追加しました。既存のevents、LINE delivery outbox、members routeの契約は変更していません。

### 検証結果

- ローカルで`pnpm test` 170件、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm verify:migration-sql`、`pnpm lint:openapi`、`pnpm verify:trust-root`、`git diff --check`が成功しました。
- 初回PR CIでは、`packages/db/package.json`のexport変更に対するtrusted manifest hash更新漏れでquality/database-integrityが失敗しました。実ファイルのSHAをmanifestへ反映して再実行し、正本整合性を回復しました。
- 修正後のPR #89 CIはquality run `32694927172`、database-integrity run `32694927187`、schema-drift run `32694927177`がすべて成功しました。

### 敵対的レビュー

- 初回レビューのHighは、複数所属時に選択済みチームがboard/bulletin等の中央業務APIへ反映されない点でした。中央認証、featureの中央認証切替、CORS、複数所属統合テストを追加して解消しました。
- 再レビューはCritical 0、High 0でした。残るMediumは、中央response契約の`data: unknown`、auth team featureのrequestId middleware、bulletin/ride/tenant A-Bの中央統合テスト拡張です。今回の完成を妨げない後続課題としてAPI-002へ残します。

### GitHub反映

- 実装PR #89はready化後、squash commit `1e17288`として`develop`へ統合しました。
- 旧PR #35は#89へ置換、#37は既存中央schemaとの重複、#40は現行LINE outboxとの契約不一致を理由にコメントを残してクローズしました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- attachments/orders/LINE feature webhookの中央API接続、Web画面の中央mount、Auth session lifecycle、feature固有response契約の厳密化、staging/production実サービスE2Eは継続します。

## API-002 Webのチーム選択接続

### 実施した変更

- 現行developを起点にPR #91を作成し、ログイン後にactiveチーム一覧を取得するWeb導線を接続しました。単一所属は自動選択し、複数所属は業務画面の前に選択画面を表示します。
- 選択したtenant IDだけをlocalStorageへ保存し、再読み込み時はサーバーから取得したactiveチーム一覧と照合します。access token、refresh token、個人情報は追加保存しません。
- auth context、部員、予定のAPI clientへ`X-CoCoLo-Team-Id`を付与し、中央API側で毎回UUIDv7とactive所属を再検証する構成へ接続しました。選択中チームと役割もWebへ表示します。
- Vitest実行時にworkspace packageのdistが未生成でも動作するよう、ブラウザ側の固定header名をローカル定数として切り出しました。API契約の正本値と一致させています。

### 検証結果

- ローカルでWeb Vitest 63件、workspace `pnpm test:unit`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`git diff --check`が成功しました。
- 初回CIではWeb Vitestがworkspace packageのbuild前にruntime exportを解決できずqualityが失敗しました。ブラウザ側の固定header定数へ切り替えて再実行しました。
- 修正後のPR #91 CIはquality run `32696484156`、database-integrity run `32696484210`、schema-drift run `32696484226`がすべて成功しました。

### 敵対的レビュー

- 再レビューはCritical 0、High 0でした。tenant越境、PII・token保存、再読み込み時の候補照合、API header付与を確認しました。
- 残るMediumは、logout時の選択ID消去、利用中のチーム切替UI、画面状態の統合テストです。サーバー側の所属再検証で越境は防止されるため、今回の完成を妨げない後続課題としてAPI-002へ残します。

### GitHub反映

- 実装PR #91はready化後、squash commit `0db4fde`として`develop`へ統合しました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- attachments/orders/LINE feature webhookのAPI接続、board/bulletin/ride等のWeb画面mount、logout時の選択状態整理、チーム切替UI、Auth session lifecycle、feature固有response契約の厳密化を継続します。

## AUTH-002 WebのAuth session lifecycle接続

### 実施した変更

- 現行developを起点にPR #96を作成し、既存のAuthSessionManagerが提供する`authenticatedFetch`を、チーム選択、auth context、部員、予定、役員連絡先、回覧板のWeb APIクライアントへ接続しました。
- 期限前refresh、401時の一度だけの再送、single-flight、Authorizationの最新token上書きは既存のAuthSessionManagerへ委譲し、API・DB・ストレージ・token保存方式は変更していません。
- 選択中チームヘッダーにlogoutを追加し、session消去後に既存の選択チームIDもクリアするようにしました。logout失敗時も、メモリ上のsessionと選択状態は先に消去されます。

### 検証結果

- Web Vitest 68件、workspace `pnpm test:unit`、`pnpm test`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`git diff --check`が成功しました。
- PR #96のquality run `32700420470`、database-integrity run `32700420478`、schema-drift run `32700420490`がすべて成功しました。

### 敵対的レビュー

- Critical 0、High 0でした。401 refresh/retry、Authorization更新、logout時のsessionと選択tenant状態、依存配列、tenant越境、PII露出を確認しました。
- 残るMediumは、チーム選択前・所属0件画面のlogout導線と、mainからAuthSessionManagerまでを検証する画面統合テストです。今回の最小スコープでは業務API表示前の導線とテスト拡張の課題であり、マージを妨げない後続課題としてAPI-002へ残します。

### GitHub反映

- 実装PR #96はready化後、squash commit `b14f891`として`develop`へ統合しました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- チーム選択前のlogout導線、画面統合テスト、staging Supabase E2E、attachments/orders/LINE feature webhookのAPI接続、送迎画面の予定選択、feature固有response契約の厳密化を継続します。

## API-002 Webの役員連絡先と回覧板接続

### 実施した変更

- 現行developを起点にPR #93を作成し、ログイン後の中央Webへ役員連絡先画面と回覧板画面を接続しました。
- 役員連絡先APIと回覧板APIの全リクエストに、選択中チームの`X-CoCoLo-Team-Id`を付与しました。中央API側で認証所属を再検証するため、画面からtenant IDを業務入力として送信しません。
- 役員連絡先画面では、owner/adminだけに登録、編集、削除、年度引き継ぎを表示します。staffなどの一覧では、APIが投影した範囲の連絡先だけを表示します。
- 年度切替時に取得失敗した場合は旧年度の一覧を残さず、見出しのアクセシビリティ属性も接続しました。

### 検証結果

- Web Vitest 65件、workspace `pnpm test:unit`、`pnpm test`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`git diff --check`が成功しました。
- PR #93のquality run `32698162776`、database-integrity run `32698162800`、schema-drift run `32698162801`がすべて成功しました。

### 敵対的レビュー

- Critical 0、High 0でした。tenant越境、選択チームheaderの付与、役員連絡先のPII投影、回覧板の未読者境界、非管理者の管理操作表示を確認しました。
- Mediumのうち、権限表示の既定値、年度切替時の旧データ表示、見出し参照先は修正しました。
- 残るMediumは、mainからのmountとrole制御、初期ロードや既読処理を含む画面統合テストです。既存のAPI単体テストでheader付与を確認しており、今回のマージを妨げない後続課題としてAPI-002へ残します。

### GitHub反映

- 実装PR #93はready化後、squash commit `31a4c04`として`develop`へ統合しました。
- 本記録と残タスク台帳の更新は、実装PRと分離したdocs-only PRで反映します。

### 残タスク

- attachments/orders/LINE feature webhookのAPI接続、送迎画面の予定選択、全画面の統合テスト、logout時の選択状態整理、チーム切替UI、Auth session lifecycle、feature固有response契約の厳密化を継続します。

## FIL-001 R2添付APIの中央mount統合

### 実施した変更

- 現行developを起点にPR #102を作成し、`POST /api/v1/uploads`、complete、download、cleanupの添付APIを中央APIへmountしました。
- 中央認証から解決した利用者、選択中tenant、owner境界を利用し、認証済みrate limit、response契約、Prisma attachment repository、Cloudflare R2実adapterを接続しました。
- staging / production WorkflowへR2 endpoint、bucket、access key、secretの引き渡しを追加しました。trusted manifestも実ファイルのSHAへ更新しました。
- 添付Web画面、localのR2互換サービス起動、staging実バケットE2Eは後続タスクとして残します。

### 検証結果

- ローカルで`pnpm test`（API 171件を含む）、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm lint:workflows`、`pnpm verify:trust-root`、`git diff --check`が成功しました。
- PR #102のquality run `32703822824`、database-integrity run `32703822814`、schema-drift run `32703822773`がすべて成功しました。

### 敵対的レビュー

- 初回レビューのHighは、staging / production WorkflowからR2 endpointとaccess key、secretがdeploy adapterへ渡らない点でした。`92f8a95`で修正し、`ec0201d`でtrusted manifestを更新しました。
- 最終レビューはCritical 0、High 0、Medium 1でした。残るMediumは中央mountのcomplete、download、rate limit、tenant切替に対する結合テスト拡張で、今回のマージを妨げない後続課題です。

### GitHub反映

- 実装PR #102は、最新developを取り込んだ`65971ab`でCIを再実行し、squash commit `ced1e71`として`develop`へ統合しました。

### 残タスク

- 添付Web画面の接続、local R2互換サービス起動、staging実バケットE2E、中央mount固有の結合テストをAPI-002、FIL-002の後続作業として管理します。

## API-002 Web添付画面接続

### 実施した変更

- PR #105で、中央APIへmount済みの添付upload sessionをWebの`AttachmentUploader`へ接続しました。
- 認証済みfetcher、選択中tenantの`X-CoCoLo-Team-Id`、既存のMIME・サイズ検証を接続し、guardianにはupload UIを表示しないようにしました。
- 署名URLへの直接PUTは通常の`fetch`で実行し、Bearer tokenとtenant headerを署名URLへ転送しない境界を維持しました。

### 検証結果

- Web Vitest 69件、API unit 171件、`pnpm test:unit`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`git diff --check`が成功しました。
- PR #105のquality run `32705511939`、database-integrity run `32705511824`、schema-drift run `32705511908`がすべて成功しました。

### 敵対的レビュー

- Critical 0、High 0でした。tenant header、guardian認可、署名URLへのBearer非転送を確認しました。
- 残るMediumは、R2実環境CORS、complete失敗時の再試行・cleanup UI、complete/downloadの追加headerテスト、画面統合テストです。今回の最小スコープでは後続課題としてAPI-002/FIL-002へ残します。

### GitHub反映

- 実装PR #105はsquash commit `e4d7af0`として`develop`へ統合しました。

### 残タスク

- R2 CORSの実環境確認、complete失敗時のUI再試行・cleanup、添付画面の統合テストを後続作業で管理します。

## T014-CI-LOCAL-001 CIのlocal-first整理

### 実施した変更

- PR #104でqualityを静的検査・OpenAPI・contract/unit・typecheck・build中心へ整理し、database integrity、schema drift、E2E、staging deployの自動起動を手動実行へ分離しました。
- `pnpm ci:fast`、`pnpm ci:local`、`pnpm ci:staging`を追加し、local依存がない環境ではfail-closedで停止する構成を固定しました。

### 検証結果

- `pnpm ci:fast`、`pnpm test`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm lint:workflows`が成功しました。
- `pnpm ci:local`はDocker / Podman未導入のため、実DB検証を成功扱いにせず停止しました。

### GitHub反映

- PR #104はsquash commit `0903dd6`として`develop`へ統合しました。

### 残タスク

- Docker / Podman等のlocal実DB依存を用いた統合検証、staging実サービスE2E、production昇格証跡はOPS/T014の外部条件として継続します。

## ORD-001 共同購買・集金の中央接続

### 実施した変更

- PR #109で注文・集金のPrisma repositoryを追加し、`purchase_orders`、`order_products`、`order_entries`、`order_lines`、`order_idempotency_keys`を既存のmigration/RLSへ接続しました。
- transaction-local RLS context、active membershipの再確認、tenant・role・guardian担当部員境界、UUIDv7、SHA-256冪等性、監査ログ、BigInt安全変換、状態遷移・選択肢・金額のdomain検証をrepositoryへ閉じ込めました。
- 注文APIを中央認証、選択tenant、認証済みrate limit、response contractへmountし、CSVはUTF-8 BOMと式注入対策を維持しました。
- PR #110でWebの注文API clientへ`X-CoCoLo-Team-Id`を追加し、ログイン後の注文画面をowner/admin/guardianへmountしました。staffには画面を表示せず、チーム切替時は画面をremountして旧tenantの注文状態を破棄します。

### 検証結果

- `pnpm test`、`pnpm build`、`pnpm typecheck`、`pnpm lint`が成功しました。
- API unitは173件、注文Web API clientは3件、domainの注文集計安全整数テストを含むVitestが成功しました。
- PR #109のquality run `32708819991`、PR #110の修正後quality run `32709995858`が成功しました。PR #110の初回run `32709758334`は、workspace package build前にcontractsのruntime subpathを解決できないCI構成差分で失敗し、既存のWeb内header定義へ変更して解消しました。

### 敵対的レビュー

- 初回レビューのHighは、guardianへ`paymentConfirmedBy`を返す投影と、注文数増加時の集計安全整数超過でした。guardian投影の最小化、domainの安全整数検査、in-memory adapterのエラー変換を追加しました。
- Webレビューで確認されたチーム切替時の旧注文状態競合は、`key={selectedTeamId}`によるremountと一覧・選択・集計の初期化で解消しました。
- 最終レビューはCritical 0、High 0でした。実ブラウザE2Eと実PostgreSQL repository統合テストは未実施です。

### GitHub反映

- PR #109はsquash commit `e708e96`としてdevelopへ統合しました。
- PR #110はsquash commit `750c08e`としてdevelopへ統合しました。

### 残タスク

- local/staging PostgreSQLでのrepository・RLS・状態遷移・同時実行の実DB検証、staging Supabase E2E、feature固有response契約の厳密化をORD-001/API-002の後続作業として管理します。

## API-002 送迎・logout・LINE接続の中央接続

### 実施した変更

- PR #112で送迎予定一覧APIを追加し、中央認証後のtenantだけをtransaction-local RLSで検索するようにしました。Webの送迎APIへ選択tenant headerを付与し、一覧から予定を選択して詳細、車登録、乗車希望、補助マッチング、配車表を操作できる画面をmainへ接続しました。予定切替時は旧予定のsnapshot、集計、配車表を破棄します。
- PR #113で、複数所属時のチーム選択画面から既存AuthProviderのlogoutを実行できる導線を追加しました。処理中は二重送信を防ぎ、認証・tenant選択の契約は変更していません。
- PR #114でLINEの接続状態確認、グループ接続、接続解除を中央認証、選択tenant、認証済みrate limit、Prisma transaction、transaction-local RLSへ接続しました。WebのLINE API clientにも選択tenant headerを付与しました。
- LINEの通知登録・再試行・Webhookは中央mountから意図的に除外しました。既存featureの`line_notification_queue`と現行schedulerの`line_delivery_outbox`が別契約であり、公開すると登録成功後にschedulerが処理しない状態になるためです。Webhookは公開入口にJWT actorがなく、現行SQL repositoryのactive membership actor境界も別途必要です。

### 検証結果

- `pnpm --filter @cocolo/db test:unit`、`pnpm --filter @cocolo/api test:unit`、`pnpm --filter @cocolo/web typecheck`、`pnpm --filter @cocolo/web build`を実行しました。
- API unitは174件が成功しました。送迎一覧のtenant境界、LINE中央mountの認証済みstatus、中央mountで未統合通知routeを公開しないことを追加テストで固定しました。
- Webの送迎APIテスト5件、LINE API clientテスト3件、logout対象テスト3件が成功しました。`git diff --check`とBiome対象検査も成功しています。
- PR #112 quality run `32712208656`、PR #113 quality run `32712244248`、PR #114 quality run `32712448036`が成功し、いずれもsquashマージ済みです。

### 敵対的レビュー

- Critical 0、High 0です。確認対象はtenant越境、中央認証前の未認証、role境界、チーム切替時の旧状態、logout二重送信、LINE通知queue/outbox混在、Webhook actor境界です。
- 実ブラウザE2E、実PostgreSQL repository/RLS統合、staging Supabase/LINE実サービス接続は未実施です。これらを完了扱いにはしていません。

### GitHub反映

- PR #112はsquash commit `9e89c9c`としてdevelopへ統合しました。
- PR #113はsquash commit `18cac79`としてdevelopへ統合しました。
- PR #114はsquash commit `8c96baf`としてdevelopへ統合しました。

### 残タスク

- LINE通知登録・再試行を現行`line_delivery_outbox`と同一認可・監査契約へ接続し、公開Webhookの署名、destination、重複排除、未知group、RLS actor境界を統合します。
- local/staging PostgreSQLのRLS・同時実行検証、staging Supabase E2E、staging専用LINE channel/groupの実サービス受入れを継続します。
- feature固有response contractの厳密化と全画面の実ブラウザ統合テストを継続します。

## 履歴の更新規則

履歴には、完了したタスクの根拠と、未完了タスクで既に実施した作業だけを記録します。

新しい作業を開始した場合、再開に必要な停止条件は残タスク台帳へ記録します。

作業が完了した場合、完了条件、commit SHA、CI run、検証結果、敵対的レビュー結果をこの文書へ追記し、残タスク台帳から該当項目を削除します。

履歴の内容が現在のブランチやcommitと異なる場合は、履歴を現状の根拠として扱わず、対象ブランチの最新状態を確認します。
