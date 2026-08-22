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
