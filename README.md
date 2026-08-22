# CoCoLo

部活・クラブチームの運営を支援する、マルチテナント型のWebアプリケーションです。部員情報を中心に、チームごとの認証・権限・監査・データ分離を重視して段階的に機能を追加します。

## 現在の実装範囲

Phase 1 MVPでは、次の機能を実装しています。

- Supabase AuthのJWT検証とチーム所属・役割の解決
- 部員一覧、検索、絞り込み、部員登録
- owner / admin / staff / guardianごとの表示・操作制御
- PostgreSQL RLSによるテナント境界
- 監査ログとOpenAPI契約の生成・検証
- Playwrightによるlocal test-only AuthのE2E検証

年度繰り上げ（FS-MEM-005）、予定・出欠、役員、共同購買、添付、通知、送迎は、`docs/functional-specification.md`と`docs/ implementation-plan.md`の仕様・実装計画に従って順次追加します。

## 技術スタック

| 領域 | 採用技術 |
| --- | --- |
| Runtime | Node.js 24 |
| Package manager | pnpm 10.26.0 |
| Web | React 19 / Vite 7 |
| API | Hono / TypeScript |
| DB | PostgreSQL 17 / Prisma 6 |
| 認証 | Supabase Auth / JWKS |
| 契約 | ZodからOpenAPI 3.1を生成 |
| テスト | Node test runner / Vitest / Playwright |
| 品質 | Biome / dependency-cruiser / GitHub Actions |

Node.jsのバージョンは`package.json`の`engines`で24系に固定しています。pnpmはリポジトリの`packageManager`に記載された10.26.0を使用してください。

## リポジトリ構成

```text
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
docs/        機能仕様、実装計画、レビュー記録
e2e/         Playwright E2E
scripts/     DB準備、検証、release、deploy補助
```

依存方向には境界があります。WebからDB・認証実装を直接参照せず、APIが認証・認可・RLS下のDB処理を担います。`packages/domain`はPrisma、Hono、React、`process.env`へ依存しません。

## ローカル開発

### 前提

- Node.js 24
- pnpm 10.26.0
- PostgreSQL 17（Dockerまたはローカルインスタンス）
- DBへ接続できる`psql`。Dockerコンテナ内で実行する場合は`PSQL_DOCKER_CONTAINER`を設定します

Supabase Authは、localではSupabase CLIの環境またはE2E用test-only Authを使用できます。test-only Authは`APP_ENV=local`のときだけ有効です。

### 初期設定

```powershell
pnpm install
Copy-Item .env.example .env
```

`.env.example`には各変数の用途、local / staging / productionでの違い、secretの扱いを記載しています。実際の鍵やパスワードは`.env`またはCI/CDのsecretへ設定し、`.env.example`へ書き戻さないでください。

APIやDBのNodeスクリプトは、実行するシェルの環境変数を参照します。`.env`を自動的に読み込まないコマンドを実行する場合は、使用するシェルやsecret管理ツールから値を読み込んでください。Viteはルートの`.env`から`VITE_`で始まる変数だけをブラウザへ公開します。

PowerShellでこのターミナルに`.env`を読み込む例です。値を変更した場合は、各ターミナルで再実行してください。

```powershell
Get-Content .env | Where-Object { $_ -and $_ -notmatch '^\s*#' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  Set-Item -Path "Env:$($name.Trim())" -Value $value
}
```

bash系シェルでは`set -a; . ./.env; set +a`でも読み込めます。

### DBの準備

`DATABASE_URL`にはRLSを適用する`cocolo_app`、`DIRECT_URL`にはmigration ownerの接続先を設定します。

```powershell
pnpm db:prepare:test
pnpm --filter @cocolo/db exec prisma migrate deploy
pnpm db:seed:test
```

`db:prepare:test`は`cocolo_app` roleと権限を準備します。`db:seed:test`はテナントA/B、owner、guardian、部員のfixtureを投入します。テスト用DBを使う場合は、既存データを壊さないよう専用DBを使用してください。

### APIとWebの起動

別々のターミナルで起動します。

```powershell
# local test-only Authを含むAPI（APP_ENV=local専用）
pnpm dev:test
```

```powershell
# Web: http://127.0.0.1:5173
pnpm --filter @cocolo/web dev --host 127.0.0.1 --port 5173
```

WebのVite proxyは、`/api`、`/auth`、`/health`を`http://127.0.0.1:8787`へ転送します。local E2Eでは`VITE_SUPABASE_URL`を空欄にするとtest-only Authへ接続できます。

## 主なコマンド

| コマンド | 用途 |
| --- | --- |
| `pnpm test` | workspaceで定義された基本テストを実行 |
| `pnpm test:unit` | Vitest、contracts/domain、API単体テストを実行 |
| `pnpm test:integration` | PostgreSQLを使う統合テストを実行 |
| `pnpm test:e2e:local` | local API・Web・test-only AuthのE2Eを実行 |
| `pnpm test:e2e:staging` | stagingの実環境に対するE2E smokeを実行 |
| `pnpm lint` | Biome、各workspaceのlint、依存境界を検査 |
| `pnpm typecheck` | 全workspaceの型検査 |
| `pnpm build` | API、Web、各packageをビルド |
| `pnpm generate:openapi` | Zod契約からOpenAPI YAMLを生成 |
| `pnpm lint:openapi` | OpenAPI生成物の整合性を検査 |
| `pnpm verify:environment` | 環境値、URL、bucket、保持期間を検証 |
| `pnpm verify:production-bundle` | production bundleへのsecret・test-only Auth混入を検査 |
| `pnpm verify:release` | release artifactのSHA・migrationを検証 |

統合テストとE2EはDB・環境変数・外部サービスが必要です。失敗した場合は、先に`DATABASE_URL`、`DIRECT_URL`、migration適用、fixture、`APP_ENV`を確認してください。

## アーキテクチャとセキュリティ境界

```text
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
```

- tenant IDを利用者入力の認可根拠にせず、JWTのuser IDからactive membershipを解決します。
- APIの認証・認可に加えて、PostgreSQL RLSでもテナント境界を強制します。
- Service Role Keyはサーバー専用です。Webの`VITE_`変数、ログ、監査metadata、release artifactへ含めません。
- guardianやstaffには役割に応じた最小限の部員情報だけを返します。
- 書き込み操作はtransaction、監査ログ、入力スキーマ、状態遷移制約を組み合わせます。

APIの公開パスは`/api/v1`です。HTTP契約の生成元は`packages/contracts`で、`packages/contracts/openapi.yaml`は生成物として差分検証します。

## CI/CD

- Pull Request: Node.js 24、pnpm固定install、Biome・依存境界・migration検査、PostgreSQL 17のRLS統合テスト、型検査、buildを実行します。
- `main`へのpush: staging環境のURL・secret・R2 bucketを検証し、migration、fixture、immutable release artifact、配置、staging E2Eを実行します。
- 本番昇格: stagingで成功した同一artifact SHAと証跡を検証してから、手動Workflowでproductionへ昇格します。

staging / productionの配置adapter契約は[`docs/deployment-adapter.md`](docs/deployment-adapter.md)を参照してください。

## 開発ルール

機能仕様の正本は[`docs/functional-specification.md`](docs/functional-specification.md)、実装計画とタスク状態の正本は[`docs/ implementation-plan.md`](docs/%20implementation-plan.md)です。

1. `/docs`で機能仕様IDと実装範囲を確認する。
2. `develop`から機能単位の専用ブランチを作成する。
3. Red → Green → Refactorでテストを先に追加し、レビューしやすい単位で日本語コミットを作成する。
4. テナント越境、認可、個人情報、入力検証、状態遷移、テスト不足、仕様不整合を敵対的に確認する。
5. Critical / Highの指摘を解消し、Node.js 24で検証したうえで`develop`宛てDraft PRを作成する。

コードだけでは分かりにくい前提・制約・競合対策は、近接する日本語コメントまたは`/docs`へ記録します。詳細は[`AGENTS.md`](AGENTS.md)を参照してください。

## 仕様・設計ドキュメント

- [`docs/functional-specification.md`](docs/functional-specification.md): 利用者向け機能仕様、権限、状態遷移、受け入れ条件
- [`docs/ implementation-plan.md`](docs/%20implementation-plan.md): 技術選定、DB、CI/CD、実装タスク、完了記録
- [`docs/deployment-adapter.md`](docs/deployment-adapter.md): staging / production配置adapterの契約
- [`docs/reviews/`](docs/reviews/): 実装前後の敵対的レビュー記録
