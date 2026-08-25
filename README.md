# CoCoLo

部活・クラブチームの運営を支援する、マルチテナント型のWebアプリケーションです。部員情報を中心に、チームごとの認証・権限・監査・データ分離を重視して段階的に機能を追加します。

## 現在の実装範囲

Phase 1 MVPでは、Supabase AuthのJWT検証、部員一覧・検索・登録、役割別の表示・操作制御、PostgreSQL RLS、監査ログ、OpenAPI契約、Docker上のSupabaseを使うE2E検証を実装しています。

年度繰り上げ（FS-MEM-005）、予定・出欠、役員、共同購買、添付、通知、送迎は、docs/functional-specification.md と docs/implementation-plan.md の仕様・実装計画に従って順次追加します。

Cloudflare R2はPhase 4で導入予定です。現在の外部サービス構成、将来のDB分離、導入前の停止条件は、外部サービス運用仕様とDB分離仕様・移行計画を参照してください。

## 技術スタック

| 領域 | 採用技術 |
| --- | --- |
| Runtime | Node.js 24.12以降（TypeScriptの型消去を標準実行） |
| Package manager | pnpm 10.26.0 |
| Web | React 19 / Vite 7 |
| API | Hono / TypeScript |
| DB | PostgreSQL 17 / Prisma 6 |
| 認証 | Supabase Auth / JWKS |
| ローカル基盤 | Supabase CLI 2.115.0 / Docker |
| 契約 | ZodからOpenAPI 3.1を生成 |
| テスト | Node test runner / Vitest / Playwright |
| 品質 | Biome / dependency-cruiser / GitHub Actions |

Node.jsのバージョンは `package.json` の `engines` で24.12.0以降に固定しています。
型消去可能なTypeScriptはNode.jsの標準機能で直接実行し、型検査は `pnpm typecheck` で行います。
pnpmは `packageManager` に記載された10.26.0を使用してください。

## リポジトリ構成

~~~text
apps/
  api/       Hono API、認証、リポジトリ接続
  web/       React + Viteの管理画面
packages/
  auth/      JWT検証
  contracts/ Zod契約とOpenAPI生成物
  db/        Prisma schema、migration、RLS下のDB処理
  domain/    業務ルール。環境変数やDBへ依存しない
  test-fixtures/ 統合テスト用fixture
  ui/        共通UI
docs/        機能仕様、実装計画、外部サービス仕様、レビュー記録
e2e/         Playwright E2E
scripts/     DB準備、検証、release、deploy補助
~~~

WebからDB・認証実装を直接参照せず、APIが認証・認可・RLS下のDB処理を担います。packages/domain はPrisma、Hono、React、process.envへ依存しません。

## ローカル開発

前提はNode.js 24.12.0、pnpm 10.26.0、Docker Desktopです。Node.jsとpnpmは、プロジェクトルートの `mise.toml` でバージョンを固定しています。Supabase CLIはプロジェクト依存として固定しています。

ローカルのAPIとWebはホストで起動し、Supabase AuthとPostgreSQLだけをDockerコンテナで起動します。開発用スタックは `cocolo-local` projectとDocker volumeを使い、起動のたびにDBをresetしません。

### 初期設定

~~~powershell
winget install jdx.mise
mise install
mise exec -- pnpm install
Copy-Item .env.example .env
~~~

`mise install` 後にプロジェクトのNode.jsとpnpmを明示して実行する場合は、`mise exec -- <command>` を使用します。たとえば、次のコマンドでバージョンを確認できます。

~~~powershell
mise exec -- node --version
mise exec -- pnpm --version
mise exec -- pnpm install
~~~

`mise.toml` を変更したときは、再度 `mise install` を実行してください。個人だけの上書き設定が必要な場合は、Git管理外の `mise.local.toml` を使用できます。

.env.exampleには各変数の用途、local / staging / productionでの違い、secretの扱いを記載しています。実際の鍵やパスワードは.envまたはCI/CDのsecretへ設定し、.env.exampleへ書き戻さないでください。

### 秘密情報の混入防止

Betterleaksをmiseで固定導入し、`pnpm ci:fast` とPull Requestの品質ゲートで秘密情報を検査します。ローカルのコミット前検査を有効にするには、リポジトリルートで次を一度実行します。

~~~powershell
mise install
git config core.hooksPath .githooks
pnpm security:betterleaks:staged
~~~

API key、token、password、password hashなどは検出時にコミットを拒否します。検証用のSHA-256 checksumは、migrationとtrust manifestの正本として必要なため検査対象から除外しています。Betterleaksの検出結果を保存せず、ログにも秘密値を出力しません。

### ローカル開発DBとAPI/Webの起動

次の一つのコマンドでSupabaseを起動し、未適用migrationだけを適用してAPIとWebをホスト起動します。

~~~powershell
pnpm dev:local
~~~

初回の空DBだけ、`owner-a@example.test` と匿名fixtureを投入します。2回目以降は既存データを保持し、Prismaの `migrate deploy` が未適用migrationだけを適用します。

`Ctrl+C` はAPIとWebを停止し、Supabaseのvolumeを保持します。状態確認は `pnpm local:status`、Supabase停止は `pnpm local:stop` です。

開発DBを明示的に作り直す場合だけ、データ消失を確認した上で `$env:LOCAL_DATABASE_RESET='true'; pnpm local:reset` を実行します。

### テストDBとテストデータ

統合テストとlocal E2Eは `cocolo-test` project、別ポート、別volumeのSupabaseスタックを使います。

~~~powershell
pnpm test:integration
pnpm test:e2e:local
~~~

各コマンドはテスト開始時にテストスタックを再構築し、Prisma migration、Authの合成ユーザー、DB fixtureを投入します。終了時に `supabase stop --no-backup` でテストDBを破棄します。

テストfixtureはloopbackの `cocolo-local` / `cocolo-test` 以外へ接続できず、stagingとproductionでは実行できません。fixture投入経路はrelease artifactへ含めず、本番へテストユーザーやテストデータを適用しません。

APIとWebはホットリロードのためホストで起動します。開発用Webは `http://localhost:5173`、local E2EのWebは `http://localhost:4173`、Supabase APIはそれぞれ `54321` / `55321` で待ち受けます。

## 主なコマンド

| コマンド | 用途 |
| --- | --- |
| pnpm test | workspaceで定義された基本テスト |
| pnpm test:unit | Vitest、contracts/domain、API単体テスト |
| pnpm test:integration | 破棄専用Supabase test DBを毎回作る統合テスト |
| pnpm test:e2e:local | 破棄専用Supabase Auth・DBを使うlocal E2E |
| pnpm dev:local | 永続SupabaseとホストAPI/Webの開発起動 |
| pnpm local:status | 永続Supabaseの状態確認 |
| pnpm local:stop | 永続Supabaseの停止。volumeは保持 |
| pnpm local:reset | 明示承認付きの永続Supabase再構築 |
| pnpm lint | Biome、workspace lint、依存境界 |
| pnpm typecheck | 全workspaceの型検査 |
| pnpm build | API、Web、各packageのビルド |
| pnpm lint:openapi | OpenAPI生成物の整合性 |
| pnpm verify:environment | 環境値、URL、bucket、保持期間 |

## アーキテクチャとセキュリティ境界

~~~text
Browser
  ↓ Bearer JWT / REST
React + Vite
  ↓ /api/v1
Hono API
  ├─ Supabase JWKSでJWTを検証
  ├─ membershipからtenantとroleを解決
  └─ Prisma transactionでRLS contextを設定
       ↓
PostgreSQL（cocolo_app / RLS）
~~~

tenant IDを利用者入力の認可根拠にせず、JWTのuser IDからactive membershipを解決します。Service Role Keyはサーバー専用で、WebのVITE_変数、ログ、監査metadata、release artifactへ含めません。

## 外部サービスと将来のDB分離

- Supabase Authは認証とJWT発行、Supabase PostgreSQLは現行のアプリケーションデータを担当します。
- Cloudflare R2はprivate bucketと短期署名URLを前提にPhase 4で導入予定です。未実装の機能を運用済みとして扱いません。
- DBを将来分離しても、認証ユーザー識別子は外部IDの文字列として保持し、Auth内部schemaを移行対象にしません。
- 移行時のRLS、ロール、バックアップ、照合、切り戻し、forward recoveryはDB分離仕様・移行計画に従います。

## CI/CD

Pull RequestではNode.js 24、pnpm固定install、静的検査、契約、unit、型検査、buildを実行します。localではPostgreSQL 17のRLS統合テストを追加し、mainへのpushではstagingのmigration、immutable release artifact、配置、E2Eを実行します。本番はstagingで成功した同一artifact SHAと証跡を検証してから昇格します。

staging / productionの配置手順と配置アダプター契約は docs/deployment-guide.md を参照してください。

## 開発ルール

機能仕様の正本は docs/functional-specification.md、技術方式の正本は docs/implementation-plan.md、未完了タスクの正本は docs/resume-task-list.md です。

1. /docsで機能仕様IDと実装範囲を確認する。
2. developから機能単位の専用ブランチを作成する。
3. Red → Green → Refactorでテストを先に追加し、レビューしやすい単位で日本語コミットを作成する。
4. テナント越境、認可、個人情報、入力検証、状態遷移、テスト不足、仕様不整合を敵対的に確認する。
5. Critical / Highの指摘を解消し、Node.js 24で検証したうえでdevelop宛てDraft PRを作成する。
6. タスク完了時は、実装PRと別にタスク関連の台帳、仕様、運用記録だけを含むPRを作成し、レビューとCI完了後にdevelopへマージする。

PR本文の共通フォーマット、改行規則、既存PRの見直し手順は [docs/pull-request-guidelines.md](docs/pull-request-guidelines.md) を参照してください。本文の機械検査は `pnpm verify:pr-description` で実行します。

コードだけでは分かりにくい前提・制約・競合対策は、近接する日本語コメントまたは/docsへ記録します。

## 仕様・設計ドキュメント

- docs/functional-specification.md: 利用者向け機能仕様、権限、状態遷移、受け入れ条件
- docs/implementation-plan.md: 技術境界、DB、実装順、CIの正本
- docs/resume-task-list.md: 未完了タスク、停止条件、再開手順。再開時はこの文書だけを先に読みます
- docs/resume-task-history.md: 完了タスクと残るレビュー指摘の要約
- docs/verification-runbook.md: local、staging、trust root、DB、schema driftの検証順と停止条件
- docs/external-services-operations.md: Supabase、Cloudflare、GitHub Actionsの設定・権限・監視・障害対応
- docs/rate-limit-operations.md: 分散レート制限のadapter契約、環境設定、障害対応
- docs/database-separation-plan.md: DB分離の不変契約、移行、照合、復旧
- docs/deployment-guide.md: staging / productionの環境設定、配置、昇格、障害対応
- docs/reviews/: レビューの完了判定と未解決指摘の要約
