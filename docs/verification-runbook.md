# ローカル検証手順書

## 目的

依存関係、workspace の生成物、型検査、テスト、ビルドの実行順を固定し、環境準備不足による誤判定や、検証手順の抜けを防止します。

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
