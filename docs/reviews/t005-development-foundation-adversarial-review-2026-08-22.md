# T-005 開発基盤の敵対的レビュー（2026-08-22）

## 対象

- ブランチ: `feature/t005-development-foundation`
- 対象: T-005 の未コミット作業ツリー（Biome 2.5.9 導入を含む）
- レビュー方式: 認証・テナント境界・供給網・CI昇格経路を攻撃者視点で再確認

## 指摘

### Critical

1. `production-promote.yml` は入力 SHA が空でないことだけを確認した後に任意 SHA を checkout する。staging の成功 run、workflow path、migration / smoke / E2E 成功、artifact の SHA-256 と provenance を checkout 前に検証していないため、未検証コードと migration を production secret の前で実行できる。

### High

1. `package-release.mjs` は release manifest のみを作成し、アプリ bundle・migration・checksum を不変 artifact としてまとめて検証する処理がない。
2. `run-e2e.mjs`、`db-prepare-test.mjs`、`db-seed-test.mjs`、`verify-database-version.mjs` が実DB・Playwrightの実行ではなく成功メッセージだけを返すため、品質ゲートの証拠にならない。

### Medium

1. dependency-cruiserとBiomeの実行は追加したが、Node 20 / pnpm 10.26.0以外のローカル実行は警告になる。CIの固定環境を唯一の合格環境としてREADMEに明記する必要がある。

後続の環境方針変更により、現在の固定環境はNode.js 24 / pnpm 10.26.0とする。上記は初回レビュー時点の記録として保持する。
2. T-005のタスク表と実際のworkflow・release・E2E証跡が一致していない。

## 判定

不合格。Critical / High を解消し、同じ攻撃経路を再検証してから T-006 へ進む。

## 再レビュー（2026-08-22）

### 対象

- 対象コミット: `4dc4eba..fb36532`
- 対象: workspace、Biome、Vitest、API/DB基盤、検査スクリプト、staging / production昇格Workflow
- 再確認: 越境、production secret投入前の未検証コード実行、artifact改ざん、環境混同、品質ゲートの成功偽装

### 再確認結果

#### Critical: 0件

- `production-promote.yml` はcheckout前に、40桁SHA、staging成功run、workflow path、main由来の証跡、migration / smoke / E2E成功、artifact SHA-256、GitHub artifact attestationを検証する。
- 検証後だけ入力SHAをcheckoutし、production secret投入とmigration適用へ進む。

#### High: 0件

- `package-release.mjs` はアプリbundle・Prisma schema・migration・lockfileをtar.gzへ集約し、SHA-256を生成する。`verify-release.mjs` がmanifestのcommit SHAとarchive checksumを再検証する。
- DB role準備、fixture投入、PostgreSQL major version確認は実際の `psql` を実行し、失敗時は非ゼロ終了する。
- local E2EはPlaywrightでhealth endpointを実行し、Vitest、既存unit test、Biome、依存境界、workflow SHA固定も実行済みである。
- staging / productionのSupabase URL、JWKS URL、公開URLは環境許可値との一致を必須化し、R2 bucketも環境別に固定した。

#### Medium: 2件（T-005のブロッカーではない）

1. 実stagingのDB、Supabase、R2、Playwrightユーザーをこのローカル環境から実行できないため、staging workflowの実行結果はCI環境で確定する。workflowは失敗時にartifact/evidenceを保存せず、production promoteも成功証跡なしでは停止する。
2. stagingへの実配置とproductionへの実配置は環境固有のdeploy adapterが未接続で、現状は検証済みartifactの配置位置を示すstepに留める。外部サービス接続を伴うため、T-009〜T-011の環境接続時に実adapterと監査証跡を追加確認する。

### 判定

合格。Critical / High は0件。T-005の開発基盤を完了し、T-006 Redへ進める。
