# ローカル検証手順書

## 目的

依存関係、workspace の生成物、型検査、テスト、ビルドの実行順を固定し、環境準備不足による誤判定や、検証手順の抜けを防止します。

## 現行CI契約（local-first）

PRで自動実行するGitHub Actionsは`quality.yml`の短時間ゲートだけです。DB/RLS、migration適用、integration、Playwright、staging検証はローカルで実行し、古いPR実行はキャンセルされます。GitHub Actionsは標準`ubuntu-24.04`だけを使用し、Workflowのartifact保持期間は短くします。

```powershell
# PRのqualityと同じ検査
pnpm ci:fast

# local PostgreSQL/Supabase、migration、RLS、seed、integration、E2Eを含む検査
pnpm ci:local

# 明示的に分離したstaging接続先でのみ実行（secret値はレポートへ記録しない）
pnpm ci:staging
```

`ci:staging`は`APP_ENV=staging`、`STAGING_DATABASE_URL`、`STAGING_DIRECT_URL`、`STAGING_DATABASE_ALLOWED_*`、`STAGING_SUPABASE_*`、`STAGING_R2_*`、`STAGING_PUBLIC_APP_URL`、`STAGING_RATE_LIMIT_ADAPTER_MODULE`、`STAGING_DEPLOY_ADAPTER`を要求します。実行時はそれらをstaging専用の接続先へマッピングし、production URL・DB・bucketの混入を拒否します。生成レポートは`.ci-reports/ci-*.json`にstep名、結果、所要時間、commit SHAだけを記録します。

PR本文には、実行した入口、commit SHA、Node/pnpm版、成功/失敗、未実行の長時間検証、staging接続の有無、secret・個人情報を出力していないことを記録します。

## 実行前の確認

1. 作業対象が最新の `develop` を起点にした専用ブランチであることを確認します。
2. 作業ツリーに利用者の未コミット変更がないことを確認します。変更がある場合は、破棄せず内容と所有者を確認します。
3. `node --version` と `pnpm --version` を記録し、`package.json` の `engines` と `packageManager` に一致する実行環境を使用します。
4. lockfileを変更しない検証では、必ず次を最初に実行します。

```powershell
pnpm install --frozen-lockfile
```

依存導入に失敗した状態でテスト結果を機能不具合と判定してはいけません。依存導入のログを保存し、環境問題として報告します。

## 固定する実行順

workspace のテストが別パッケージの `dist` を参照するため、テストより先にビルドを実行します。

```powershell
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

`pnpm test` を先に実行して `ERR_MODULE_NOT_FOUND`（例: `packages/domain/dist/index.js`）が出た場合は、テスト実装の失敗とは扱わず、`pnpm build` 未実行または生成物欠落を確認します。ビルド後に同じテストを再実行し、最終結果を記録します。

DBやOpenAPIを含む変更では、対象に応じて次も実行します。

```powershell
pnpm verify:migration-sql
pnpm generate:openapi
git diff --exit-code -- packages/contracts/openapi.yaml
pnpm test:unit
pnpm test:integration
```

実PostgreSQL、staging、外部サービスが必要な検証を実行できない場合は、未実行のまま成功扱いにせず、接続先・未設定変数・代替確認範囲をPR本文とレビュー記録へ残します。

## PR作成前チェックリスト

- `git status --short` が意図した変更だけを示している。
- 変更対象の機能仕様ID、依存PR、統合順序をPR本文に記載している。
- `pnpm build`、`pnpm test`、`pnpm lint`、`pnpm typecheck` の実行結果と環境情報を記録している。
- 失敗したコマンドは原因を特定し、修正後に同じコマンドを再実行している。
- tenant越境、認可、個人情報、入力検証、状態遷移、監査、テスト不足を敵対的に確認している。
- Critical / High が0件であることをレビュー記録に残している。
- 中央登録点、migration、OpenAPI、staging実接続など、統合後に残る作業を成功条件と混同していない。

## 今回の再発防止記録（2026-08-23）

最初のベースライン実行では、依存導入前に `pnpm test` と `pnpm build` を実行し、`node_modules` 不足と `packages/domain/dist/index.js` 不在で失敗しました。その後、`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test` の順にやり直して成功しました。

今後は「依存導入 → build → test」の順を必須とし、テストが生成物不足で止まった場合は、コード修正へ進む前にこの順序へ戻します。

### 追加記録：ブランチ統合後の再検証（2026-08-23）

PR #39 の競合解消後、`apps/api/package.json` の `test` script と `packages/domain/package.json` の `./line` exportを二重記載し、CIのBiome検査を失敗させました。

競合解消後は、コミット前に対象JSONをパーサーまたはBiomeで検査し、重複キーと競合マーカーを確認します。

また、ブランチ切替直後に `pnpm exec biome check` を実行したところ、依存モジュール再構成の非対話確認で停止しました。

ブランチ切替・develop追随後は、検証開始前に `pnpm install --frozen-lockfile --config.confirmModulesPurge=false` を実行し、`pnpm build` 完了後にlint・testを実行します。

### 追加記録：scheduler統合後の実行環境確認（2026-08-23）

PR本文に「Node/pnpm本体がないためローカル未実行」と記録されていても、直接`node`がPATHにないだけで、workspaceの`pnpm`が提供する実行環境を利用できる場合があります。

実行可否は推測せず、`pnpm --version`、`pnpm exec node --version`を確認し、可能なら`pnpm`経由で検証します。

今回のscheduler統合では、`pnpm build`、`pnpm test`（130件）、`pnpm lint`、`pnpm typecheck`が成功しました。

### 追加記録：trust-rootとスカッシュマージ（2026-08-23）

PR #50 のowner bootstrapコミットSHAを `trust-root.json` に保持したままスカッシュマージしたため、元ブランチのSHAがdevelopの祖先にならず、CIの `pnpm verify:trust-root` が失敗しました。

スカッシュマージで履歴上のコミットSHAが変わる保護設定では、マージ直後に実際のdevelop上のスカッシュコミットSHAへ参照を更新し、`pnpm verify:trust-root` を実行してから後続PRを検証します。

同時に、bootstrap後に追加されたworkflow、script、migrationがtrusted manifestへ登録されておらず、manifest欠落でもCIが停止しました。

bootstrap後に保護対象ファイルを追加するPRでは、ファイル内容のSHA-256をmanifestへ追加し、`pnpm verify:trust-root` を実行して未登録ファイルがないことを確認します。

なお、JSON以外の手順書をJSONパーサーへ渡す誤検査も発生しました。JSONはパーサー、Markdownは`git diff --check`と内容レビューという対象別の検査を徹底します。

GitHub CLIの差分確認では、`gh pr diff <番号> --patch`のオプションと、`git diff origin/develop...HEAD -- <paths>`のパス指定を混在させて引数エラーを起こしました。統計や特定パスの確認はGitで行い、GitHub上のPR全体確認は`gh pr diff`の対応オプションだけを使います。

検証コマンドを`;`で連結した際、途中の`pnpm verify:trust-root`が失敗しても後続の`git commit`まで実行されました。検証失敗時にコミットへ進まないよう、重要なゲートは単独で実行するか、PowerShellの`$LASTEXITCODE`を確認してから次のGit操作へ進みます。

release artifactの専用テストで、公開Supabase設定を必須化した実装に対してテスト環境変数を渡しておらず、`VITE_SUPABASE_URL が未設定です`で失敗しました。必須環境変数を追加した実装では、テストにも実値ではない検証用ダミー値を明示し、専用テストを再実行してから全体検証へ進みます。

同じ公開設定必須化をCIのrelease artifact検証stepへ反映し忘れ、`pnpm package:release`がCIだけ環境変数不足で失敗しました。ローカル専用テストとworkflowの実行stepを別々に確認し、workflow側にも秘密でない固定ダミー値を設定してからCIを再実行します。

### 追加記録：protected検査器変更時のowner-only境界（2026-08-23）

`scripts/verify-trusted-pr.ts`を変更し、追加した`verify-trusted-pr.test.ts`をmanifestへ登録する前に`pnpm verify:trust-root`を実行したところ、manifest欠落で停止しました。

protectedなscript、workflow、package設定を変更するときは、実装を先にコミットせず、次の順序を守ります。

1. 変更対象がtrusted manifestの保護対象か確認する。
2. 新規または変更した全ファイルのSHA-256をmanifestへ同期する。
3. `pnpm verify:trust-root`を単独実行する。
4. `pull_request_target`が読むbase側のowner-only extensionと、変更PRのhead/base SHAが一致することを確認する。
5. extensionが古い、対象ファイルが欠落している、またはowner-only bootstrapが未実施なら、通常PRとして進めずowner操作待ちにする。

`pnpm verify:trust-root`が成功しても、現行checkoutのowner-only extensionがstaleでないことや、PR信頼ゲートが最新baseの正本を読んでいることは別途確認します。検査器自身の保護境界を、同じPRの変更内容だけで自己承認しません。

保護対象のGitHub files API差分は`filename`だけで判定せず、`previous_filename`も検査します。protected pathから保護外pathへのrename、protected pathの削除、保護対象のpath変更は、owner-only extensionなしではfail-closedにします。

### 追加記録：検証途中のworkspace依存リンク欠落（2026-08-23）

`pnpm build`と`pnpm test`が成功した直後の`pnpm lint`で、Prismaの`@prisma/engines`が見つからず生成処理が停止しました。その後の`pnpm build`ではworkspaceの`tsc`が未検出になりました。

コードの修正へ進まず、次のコマンドを単独で実行して依存リンクを再構成し、失敗した検証コマンドを最初から再実行します。

```powershell
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
pnpm build
```

今回のローカル実行環境はNode.js `v24.18.0`、pnpm `9.15.9`で、`package.json`が要求するpnpm `10.26.0`と一致していません。Node.js要件は満たしていても、pnpmの不一致は成功判定の前提から外し、CIのpnpm `10.26.0`で再検証します。

### 追加記録：追加テストのBiome検査漏れ（2026-08-23）

rename境界の追加テストを作成した直後、`pnpm lint`がBiomeのformat差分だけで失敗しました。追加テストを作成したら、全体検証前に対象ファイルへBiome検査を実行し、整形・typecheck・専用テストを通してからworkspace検証へ進みます。

### 追加記録：スカッシュマージ前後の再確認（2026-08-23）

次のPRをスカッシュマージする前に、`origin/develop`の最新SHA、PRのbase/head SHA、`mergeStateStatus`、最新headに対する必須CI、Critical/Highのレビュー結果を同じ時点で確認します。

マージ後は、実際のスカッシュコミットSHA、trusted rootの祖先判定、trusted manifest、OpenAPI生成差分、台帳を同期してから後続PRを検証します。古いbaseが`CLEAN`でも、重複migration・旧route・旧trust contractの意味検査を省略しません。

### 追加記録：台帳・運用記録の分離（2026-08-23）

resume-task-list、resume-task-history、verification-runbookの更新は実装PRへ混在させず、develop起点のdocs-only Draft PRで管理します。実装PRにはコード、テスト、必要なmanifest同期だけを含め、作業順・失敗原因・レビュー記録はdocs-only PRへ記録します。

### 追加記録：ghマージ後の別worktree衝突（2026-08-23）

`gh pr merge --squash --delete-branch`はリモートのスカッシュマージ後にローカル`develop`をcheckoutして後処理するため、別worktreeが`develop`を使用中だとローカル側だけが失敗します。

このエラーを見たときは再度マージせず、最初に`gh pr view <番号> --json state,mergedAt,mergeCommit`でリモート状態を確認します。`state=MERGED`なら、`git fetch origin develop --prune`で実際のスカッシュSHAを同期し、ローカルworktreeの削除やbranch cleanupだけを必要に応じて別途行います。

### 追加記録：レート制限経路実装時の検証漏れ（2026-08-23）

ブランチ切替後に依存リンクを再構成する前の`pnpm test`で、`@prisma/engines`が見つからず失敗しました。

pnpmのworkspace状態が変わった検証では、次のコマンドを最初に単独実行し、終了コード0を確認してから対象テストを開始します。

```powershell
pnpm install --frozen-lockfile --config.confirmModulesPurge=false
```

通常実行のpnpmがpackage.jsonの`packageManager`と異なる場合、依存再構成後の`.modules.yaml`を別バージョンが再利用して再インストールを要求することがあります。

`pnpm --version`、`node --version`、`package.json`の`packageManager`、`.modules.yaml`の`packageManager`を同じ検証記録へ残し、CIのpnpm 10.26.0を正本として扱います。

通常およびofflineの依存再構成がregistryのEACCESや無出力の長時間実行になった場合、同じコマンドを重ねて実行せず、プロセスを安全に中断してから、権限が承認された環境でlockfile固定のinstallを一度だけ実行します。

Node.js 24の`node --test`はstrip-only実行のため、`.test.ts`でTypeScriptのparameter propertyを使うと`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`になります。

テストfixtureのclassは、parameter propertyではなく明示的なフィールド宣言とconstructor代入を使います。

認証済みmembers routeへrate limitを追加するとき、既存の`/api/v1/members/*`はexactの`/api/v1/members`にも適用されるため、exact middlewareを重ねて登録してはいけません。

同じ理由で、`authenticate`のexact登録とwildcard登録も二重実行になり得るため、routeごとのmiddleware呼び出し回数をテストし、重複する登録を削除します。

経路追加のテストでは、認証済みの許可、429応答契約、ハッシュ済みtenant/userキー、生の個人情報を含まないこと、429時の全業務handlerと外部producerの未実行を同時に確認します。

検証失敗を修正した後は、失敗したコマンドだけで終わらせず、`pnpm test`、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm lint:workflows`を同じHEADで再実行し、CI成功と照合します。

### 追加記録：PR信頼ゲート未展開時の判定境界（2026-08-23）

現行のdefault branchであるmainには`.github/workflows/pr-trust-gate.yml`が存在せず、GitHub workflow APIでも404となります。

`gh workflow list --all`で確認できるactive workflowは、品質、DB整合性、schema drift、セキュリティの4系統です。

したがって、PR #65の現行CIにはPR信頼ゲートが存在せず、trusted manifest差分を理由にPR #65の機能、品質、セキュリティ判定をブロックしません。

PR #65のtrusted manifestへのmigration登録は、現行の品質・DB整合性・schema drift・セキュリティ検査の対象として扱います。

T014-PR-001で`pr-trust-gate.yml`を有効化する際は、owner-only操作としてmainのdefault branchへworkflowを反映し、base側trusted manifest、bootstrap extension、owner承認SHA、workflow permissions、変更ファイルAPI検査を同時に確定します。

gate有効化前のPRへ、後からtrust gateの必須checkを遡及適用しません。

gate有効化後は、owner-only前提が満たされたbase SHAで悪性fixture、protected path、rename、削除、manifest hashのfail-closed検査を再実行します。

### 追加記録：中央API hardening実装時の手順漏れ（2026-08-23）

新規テストfixtureの型を`Record<string, unknown>`のまま作成し、`MemberRepository`の`MemberRecord`戻り値契約に適合せず、`pnpm lint`のtest typecheckで`TS2322`が発生しました。

新規fixtureは最初に既存repository型をimportし、固定fixtureへ明示的な型注釈を付けてから専用typecheckを実行します。

新規contractsテストのimport拡張子を既存規約の`.ts`ではなく`.js`にしたため、Node.js 24のstrip-onlyテスト実行で`ERR_MODULE_NOT_FOUND`が発生しました。

新規テストを追加するときは、同じpackageの既存テストのimport拡張子、`tsconfig`の`allowImportingTsExtensions`、実行scriptを先に確認します。

requestId共通化でstructured loggerから旧control-character helperを削除した際、path検証の参照を置換し忘れてAPI buildが失敗しました。

rate-limitへ同じ共通化を適用した際、requestId以外のidentity検証で旧helperを参照しており、API buildが失敗しました。

共通helperを削除または移動する変更では、削除前に`rg -n "helperName" apps packages`で全参照を検索し、変更後にpackage buildを実行します。

requestIdをUUID形式へ厳格化した後、rate-limit回帰テストの期待値だけが旧文字列のまま残り、API専用テストが1件失敗しました。

公開形式や固定値を変更したときは、実装、fixture、レスポンスheader、JSON bodyの期待値を同時に検索し、専用テストを再実行します。

実DB統合テストを環境変数なしで実行したため、`attachments-db`、`events-db`、`line-delivery-db`、`members-db`、`promotion-db`の5件が`DATABASE_URLが必要です`で失敗し、実DB検証は未実施となりました。

実DB統合テストの前には、`$env:DATABASE_URL`の存在、接続先が検証用DBであること、migration適用状態、RLS検証用roleを確認し、未設定時はテストを開始せず環境前提として停止します。

今回の最終検証では、rootの`pnpm test`が150件成功し、`pnpm build`、`pnpm lint`、`pnpm typecheck`、`pnpm lint:workflows`、`pnpm lint:openapi`も同じHEADで成功しました。

CI quality run `32614821124`が成功し、実装PR #62は`2ce3dbe`としてdevelopへスカッシュマージされました。

### 追加記録：EVT-001中央接続の実DB検証漏れとRLSロック境界（2026-08-23）

EVT-001では、実装PRの初回CIで新規migrationをtrusted manifestへ登録し忘れ、品質ゲートのmanifest検査で停止しました。

migrationを追加または変更したときは、コミット前にSHA-256を再計算してmanifestへ同期し、`pnpm verify:trust-root`を単独実行します。

manifest更新時にハッシュ文字列を誤記し、検証が64桁hex形式エラーになりました。

ハッシュ更新後は値の形式検査と実ファイルの再計算を行い、検証が成功するまでcommitへ進みません。

membership検証で`tenant_memberships`へ直接`FOR UPDATE`を使ったところ、SELECT-only RLS境界と衝突して実DBテストが失敗しました。

その後`FOR SHARE`へ変更しても同じ失敗が続いたため、RLS対象表の直接row lockを認可確認に使わず、SECURITY DEFINERのactive membership検証関数とtransaction advisory lockへ分離しました。

guardianの予定参照で`SELECT ... FOR UPDATE`を使ったところ、予定更新権限を持たないguardianから行が不可視になりました。

予定更新・出欠更新・集計はevent単位のadvisory lockを同じ順序で取得し、guardianの予定参照は通常SELECTで行います。

guardian_membersの担当判定でも`FOR SHARE`がRLSのSELECT-only境界と衝突したため、担当判定は通常SELECTに限定しました。

RLS対象表へrow lock句を追加するときは、対象roleのSELECT、UPDATE、FORCE RLS、policy commandを実DBで確認し、認可確認と競合制御を同じSQL句へ混在させません。

summaryへRepeatable Readを追加した際、`Prisma`をtype-only importして型検査に失敗しました。

runtime enumやtransaction isolation levelを使う変更では、値importとtype importを分け、package typecheckを直後に実行します。

events migrationの初期レビューでは、無条件DELETE、tenantを含まない添付参照、`NOT VALID`制約、過大な一覧取得が検出されました。

migrationは適用前データ検査、同一tenant複合制約、許可状態trigger、上限付きquery、rollback不可の影響をレビューし、破壊的SQLを含めません。

ローカルでは通常のpnpmバージョンがpackageManagerの10.26.0と一致せず、依存リンク再構成が発生しました。

`pnpm --version`を記録し、検証はpackageManagerと同じ`pnpm@10.26.0`を使い、複数のpnpm検証を同時実行しません。

pnpm test、build、installを並列実行した際、node_modulesの再構成が競合して非対話環境の`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`になりました。

依存導入、build、test、lint、typecheckは一つずつ完了と終了コードを確認してから次へ進みます。

GitHub CLIのsquash mergeは、別worktreeがdevelopを使用中だとローカル後処理だけ失敗することがあります。

mergeコマンドが失敗した場合は再実行せず、`gh pr view <番号> --json state,mergedAt,mergeCommit`でリモート状態を確認し、MERGEDならdevelopをfetchして先へ進みます。

EVT-001の最終CI runは`32619201261`で、実PostgreSQL統合テスト、型検査、build、release artifact検査が成功しました。

最終PR #65はCritical 0、High 0の敵対的レビュー後、squash commit `5f5a592`としてdevelopへ統合しました。

### 追加記録：T037中央DB統合で発生した検証順序・migration・fixture漏れ（2026-08-23）

T037では、実装PR #67の初期案をそのままマージせず、現行`develop`を起点に再構成してから検証しました。

ローカルの`pnpm`は`11.19.0`で、`package.json`の`pnpm@10.26.0`と不一致でした。

依存リンクが壊れた状態で`pnpm build`を先に実行し、`zod`の`json-schema.js`欠落で失敗しました。

検証開始前にNode.jsと`packageManager`指定を確認し、`$env:CI='true'; pnpm dlx pnpm@10.26.0 install --frozen-lockfile`で依存を再構成してから検証します。

依存導入なしで`pnpm test`を実行すると、`@cocolo/domain/dist`が存在せず`ERR_MODULE_NOT_FOUND`になりました。

実行順序を「依存導入、migration静的検査、trust manifest検査、build、test、typecheck、lint、DB統合テスト、CI」と固定し、前段の終了コードを確認してから次へ進みます。

pnpmのinstall、build、testを並列実行すると、`node_modules`再構成が競合して`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`になりました。

pnpmを使う検証は同時に一つだけ実行し、非対話環境では`CI=true`を設定します。

Prisma clientの戻り値型推論で`TS2742`が発生し、`createPrismaClient`へ明示的な戻り値型を付けました。

その後、Honoのfactory関数でも`TS2742`が発生したため、8個のAPI factoryへ公開戻り値型を付けました。

公開factory、Prisma client、repositoryの型を変更したときは、package単位のtypecheckだけでなくrootのbuildとtypecheckを再実行します。

event API fixtureのBiome整形漏れでlintが失敗しました。

新規fixtureやSQLテストを追加した直後に対象ファイルのBiome検査を行い、全体lintの前に整形差分を解消します。

新規migrationをtrusted manifestへ登録し忘れ、manifest検査でCIが停止しました。

SQLを一文字でも変更した場合は、`Get-FileHash <migration> -Algorithm SHA256`でハッシュを再計算し、manifest、`pnpm verify:trust-root`、`git diff --check`を同じコミット前に実行します。

ハッシュを手入力して64桁のhexを誤記したため、manifest形式検査でも停止しました。

ハッシュはコピーした実計算値をlowercaseで反映し、形式検査と実ファイル再計算の両方が成功するまでcommitしません。

既存Phaseと中央migrationが同じenumを作成し、CI run `32620791346`で`event_type already exists`が発生しました。

既存Phaseと中央migrationが同じattachment policyを作成し、CI run `32621007796`で重複policyエラーが発生しました。

既存Phaseと中央migrationが同じannouncement enumを作成し、CI run `32621155766`で`announcement_status already exists`が発生しました。

中央migrationの作成前に全migrationのDDL、policy、trigger、適用順を一覧化し、既存オブジェクトは再作成せず、必要な差分だけを後段migrationへ置きます。

RLS fixtureでuploaded添付にsha256と`complete_attempts`を同時設定し、CI run `32621642247`で状態triggerに拒否されました。

fixtureはuploadedで作成し、実体検証結果を反映してからavailableへ遷移させます。

guardian fixtureのmembership userと参照userが異なり、CI run `32621743800`で担当境界テストが失敗しました。

fixtureのidentity表を先に作成し、membership、guardian_members、events、orders、ridesのuser/member参照を同じ表から転記します。

guardianとownerのfixture操作を同一transactionへ混在させ、CI run `32621888205`で実行roleが残りました。

role境界を検証するfixtureはroleごとに`withContext` transactionを分離し、各transactionの開始時にRLS contextを設定します。

memberの割当先を取り違え、CI run `32622189948`でguardian対象件数が0になりました。

注文entryと送迎requestのmember IDを別のfixture memberへ設定し、CI run `32622366819`でorder entry件数が0になりました。

出欠、注文、送迎のfixtureは、作成後にtenant、member、user、resourceの関連をcountと所属queryで確認してから権限テストへ進みます。

ride fixtureのBiome整形漏れと、raw audit IDをuuid列へ渡すcast漏れがCI run `32622446624`で同時に発生しました。

raw SQLでuuid列へ値を渡すときは`::uuid`を明示し、UUID生成器、audit insert、cleanupを同じ型境界で検査します。

LINE workerがUUIDv4のaudit IDを生成し、UUIDv7制約追加後にAPIが500になりました。

既存worker関数を中央migrationでUUIDv7生成へ置換し、migration適用後のLINE成功・失敗・unknown全経路を実DBで確認します。

監査ログを直接DELETEしてfixture cleanupを行い、CI run `32622850560`でappend-only triggerに拒否されました。

本番のappend-only制約を無効化するcleanupを許可せず、実DBテスト専用transaction内で明示的にcleanup境界を管理し、cleanup自体も検証対象として記録します。

UUIDv7のprovider retry keyをscheduler正規表現が拒否し、同じCI run `32622850560`でLINE claim応答が不正になりました。

外部仕様のUUID versionを固定値で制限するときは、実際に生成するversion、fixture、正規表現、契約テストを同時に更新します。

CI run `32623139581`で、上記のRLS fixture、UUID、LINE、cleanup修正後の品質ゲートが成功しました。

trust rootとride state guardを追加したCI run `32623387388`も成功しました。

共通trigger関数から表固有の`NEW.plan_id`を直接参照し、CI run `32624315536`で`ride_plans`更新時にPostgreSQL `42703`が発生しました。

異なる表へ付けるtrigger関数では表固有列を直接参照せず、`TG_TABLE_NAME`と`to_jsonb(NEW)`などの安全な動的境界を使い、各対象表のINSERT・UPDATEを実DBで実行します。

DB側でride planの初期statusをdraftに固定した後、repositoryがopenで直接INSERTしている不一致を検出できていませんでした。

repositoryはdraft INSERT後に同一transactionでopenへ遷移させ、DB状態遷移triggerと実装の初期状態を一致させます。

実DB統合テストが無効なローカルではこの二つのtrigger不具合を検出できなかったため、`DATABASE_URL`と`DIRECT_URL`を確認できない場合は、実DB検証未実施として成功扱いにしません。

最終実装HEAD `8279af8`のCI run `32624831166`で、migration、RLS統合テスト、build、typecheck、release artifact検証が成功しました。

最終レビュー記録追加後のHEAD `b28c51e`でも、CI run `32625018676`が成功しました。

最終敵対的レビューはCritical 0、High 0であり、Mediumは既存データのUUIDv7移行、添付available状態のDB保証、board contactのPII直接SELECT、Webhook receipt INSERT権限の専用actor限定として後続タスクへ記録しました。

最終検証では、`pnpm verify:migration-sql`、`pnpm verify:trust-root`、`pnpm build`、`pnpm test`、`pnpm typecheck`、`pnpm lint`、`git diff --check`を同じ実装HEADで成功させました。

実装PRのmerge後に`gh pr merge --squash --delete-branch`がローカルworktreeで失敗する場合は、再実行せず、`gh pr view <番号> --json state,mergedAt,mergeCommit`でリモート状態を確認します。

リモートがMERGEDなら、merge commitを正本として`origin/develop`をfetchし、ローカルbranch削除エラーを追加のmerge失敗と扱いません。

T037ではPR #67をsquash commit `c31d61a`としてdevelopへ統合し、実装PRとこの手順・履歴更新を別のdocs-only PRへ分離しました。

#### T037の再発防止チェックリスト

1. `pnpm --version`と`package.json`の`packageManager`が一致していることを確認します。
2. 依存導入を完了し、生成物が存在することを確認してからbuildを実行します。
3. `verify:migration-sql`、trust manifest、`verify:trust-root`をmigration変更ごとに実行します。
4. build、test、typecheck、lint、DB統合テストを並列実行しません。
5. fixtureのtenant、user、member、role、status、cleanup条件を表にしてから実DBテストを実行します。
6. triggerごとに対象表のINSERTとUPDATEを実DBで実行し、表固有`NEW`列参照を検索します。
7. repositoryの初期status、DBの初期status、状態遷移trigger、API契約を同じfixtureで照合します。
8. CI成功だけで完了扱いにせず、最新HEADを対象に独立した敵対的レビューを2系統実施します。
9. CriticalとHighが0件であること、残るMediumを履歴と後続タスクへ記録したことを確認します。
10. merge後は必ずリモートPR状態とmerge commitを確認し、同じmergeを再実行しません。

### 追加記録：T014 DB整合性ゲートで発生したCI手順漏れと実DB検査不足（2026-08-23）

T014の現行develop向け再構成は、Draft PR #69として実装し、最終的にsquash commit `daa20025b9c5926fc4070901dcca15d96025a148`でdevelopへ統合しました。

初回CI run `32627658299`では、`verify-database-version`へ`--expected-major 17`を渡し忘れ、既定値の引数解釈が壊れて失敗しました。

DBバージョン検証コマンドは、必ず`pnpm verify:database-version --expected-major 17`の形式で実行します。

実DB用roleを作成する`db:prepare:test`より先にapp roleへ接続し、CI run `32627783973`でpassword authentication failureになりました。

実DB検証の順序は、role準備、PostgreSQL major version検証、migration適用、migration履歴検証、実DB権限検証、seedの順に固定します。

テストDB準備で全テーブルへ初期`SELECT/INSERT/UPDATE`を付与し、migrationの最小権限allowlistと衝突しました。

テストDB準備ではschema usageとrole作成だけを行い、table権限は正本migrationへ委譲します。

中央migrationの実効権限とallowlistが一致せず、`announcement*`のUPDATE権限検査でCI run `32628010543`が失敗しました。

権限allowlistは意図ではなく、全migration適用後の`has_table_privilege`実測値と照合して更新します。

PostgreSQLのpolicy catalogは`current_setting('app.tenant_id'::text, true)`や括弧を正規化して返すため、SQL正本だけでなくcatalog表現をfixtureへ固定します。

監査ログINSERT policyが`app_has_active_membership(tenant_id)`へ置換されているのに旧`app.tenant_id`トークンを要求し、CI run `32628366460`で失敗しました。

allowlistのpolicy要件は、対象migrationの最終policy本文と同じtenant境界方式へ更新します。

RLS検査は`OR true`、`tenant_id IS NOT NULL`、`tenant_id IS NULL`による境界無効化を拒否し、membership関数のowner、language、SECURITY DEFINER、本体のtenant・user・role・active status条件を実DBcatalogで検証します。

実装PRへdocsを混在させず、失敗内容とルールはこの手順書を含むdocs-only PRへ分離します。

ローカルにPostgreSQLがない場合は、実DB検証を成功扱いにせず、CI run `32629376920`を実DB検証の正本として記録します。

ローカルのpnpmがpackageManager指定と不一致の場合は、`$env:CI='true'; pnpm dlx pnpm@10.26.0 install --frozen-lockfile`を最初に一度だけ実行します。

既存lockfileが`minimumReleaseAge`により現在時刻基準で拒否された場合は、lockfileの再生成やポリシー緩和を行わず、CIを正本として記録します。

trust root検査、manifest hash検査、migration SQL検査は依存関係installより先に実行し、未信頼PRのinstall scriptをtrust検証前に動かしません。

manifestのhashは手入力せず、`Get-FileHash <path> -Algorithm SHA256`の実値をlowercaseで反映し、64桁検査と`pnpm verify:trust-root`を同じcommit前に実行します。

`bootstrap-extension.json`のowner-only bootstrapがbaseへ未反映の環境では、trust gateの判定を実装PRへ混在させず、owner先行のbootstrap作業を停止条件として台帳へ記録します。

#### T014 DB整合性ゲートの完了ルール

1. `pnpm`の固定版、CI環境、依存lockfileの状態を最初に記録します。
2. trust root、workflow、migration正本、manifest hashをinstall前に検証します。
3. role準備なしにapp role接続のDB検証を開始しません。
4. test DBへ全テーブルの初期権限を付与せず、migrationが付与する最小権限だけを検査します。
5. policy検査はSQL正本、PostgreSQL catalogの正規化表現、tenant越境悪性fixtureの3点で確認します。
6. membership境界関数は関数名の文字列だけでなく、owner、language、SECURITY DEFINER、本体条件を実DBで確認します。
7. CIのdatabase-integrityとqualityが同じ最新HEADで成功するまでReady化やmergeを行いません。
8. merge後はPRのstate、mergedAt、mergeCommitを確認し、同一mergeを再実行しません。
