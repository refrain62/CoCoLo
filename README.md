# CoCoLo

部活・クラブチームの運営を支援する、マルチテナント型のWebアプリケーションです。部員情報を中心に、チームごとの認証・権限・監査・データ分離を重視して段階的に機能を追加します。

## 現在の実装範囲

Phase 1 MVPでは、Supabase AuthのJWT検証、部員一覧・検索・登録、役割別の表示・操作制御、PostgreSQL RLS、監査ログ、OpenAPI契約、local test-only AuthのE2E検証を実装しています。

年度繰り上げ（FS-MEM-005）、予定・出欠、役員、共同購買、添付、通知、送迎は、docs/functional-specification.md と docs/ implementation-plan.md の仕様・実装計画に従って順次追加します。

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

前提はNode.js 24、pnpm 10.26.0、PostgreSQL 17、接続可能なpsqlです。Dockerコンテナ内でDB操作する場合は PSQL_DOCKER_CONTAINER を設定します。

Supabase AuthはlocalではSupabase CLIの環境またはE2E用test-only Authを使用できます。test-only Authは APP_ENV=local のときだけ有効です。

### 初期設定

~~~powershell
pnpm install
Copy-Item .env.example .env
~~~

.env.exampleには各変数の用途、local / staging / productionでの違い、secretの扱いを記載しています。実際の鍵やパスワードは.envまたはCI/CDのsecretへ設定し、.env.exampleへ書き戻さないでください。

### DBの準備

DATABASE_URLにはRLSを適用する cocolo_app、DIRECT_URLにはmigration ownerの接続先を設定します。テスト用DBを使う場合は、既存データを壊さないよう専用DBを使用してください。

~~~powershell
pnpm db:prepare:test
pnpm --filter @cocolo/db exec prisma migrate deploy
pnpm db:seed:test
~~~

### APIとWebの起動

別々のターミナルで起動します。

~~~powershell
# local test-only Authを含むAPI（APP_ENV=local専用）
pnpm dev:test
~~~

~~~powershell
# Web: http://127.0.0.1:5173
pnpm --filter @cocolo/web dev --host 127.0.0.1 --port 5173
~~~

WebのVite proxyは /api、/auth、/health を http://127.0.0.1:8787 へ転送します。local E2Eでは VITE_SUPABASE_URL を空欄にするとtest-only Authへ接続できます。

## 主なコマンド

| コマンド | 用途 |
| --- | --- |
| pnpm test | workspaceで定義された基本テスト |
| pnpm test:unit | Vitest、contracts/domain、API単体テスト |
| pnpm test:integration | PostgreSQLを使う統合テスト |
| pnpm test:e2e:local | local API・Web・test-only AuthのE2E |
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

Pull RequestではNode.js 24、pnpm固定install、Biome・依存境界・migration検査、PostgreSQL 17のRLS統合テスト、型検査、buildを実行します。mainへのpushではstagingのmigration、immutable release artifact、配置、E2Eを実行し、本番はstagingで成功した同一artifact SHAと証跡を検証してから昇格します。

staging / productionの配置手順は docs/deployment-guide.md、配置アダプター契約は docs/deployment-adapter.md を参照してください。

## 開発ルール

機能仕様の正本は docs/functional-specification.md、実装計画とタスク状態の正本は docs/ implementation-plan.md です。

1. /docsで機能仕様IDと実装範囲を確認する。
2. developから機能単位の専用ブランチを作成する。
3. Red → Green → Refactorでテストを先に追加し、レビューしやすい単位で日本語コミットを作成する。
4. テナント越境、認可、個人情報、入力検証、状態遷移、テスト不足、仕様不整合を敵対的に確認する。
5. Critical / Highの指摘を解消し、Node.js 24で検証したうえでdevelop宛てDraft PRを作成する。

コードだけでは分かりにくい前提・制約・競合対策は、近接する日本語コメントまたは/docsへ記録します。

## 仕様・設計ドキュメント

- docs/functional-specification.md: 利用者向け機能仕様、権限、状態遷移、受け入れ条件
- docs/ implementation-plan.md: 技術選定、DB、CI/CD、実装タスク、完了記録
- docs/resume-task-list.md: 中断時点の残タスク、PR、作業ツリー、再開条件。再開時はこの文書だけを先に読みます
- docs/resume-task-history.md: 完了タスク、実施内容、検証結果、レビュー履歴。必要な場合だけ該当箇所を参照します
- docs/external-services-operations.md: Supabase、Cloudflare、GitHub Actionsの設定・権限・監視・障害対応
- docs/database-separation-plan.md: DB分離の不変契約、移行、照合、復旧
- docs/deployment-guide.md: staging / productionの環境設定、配置、昇格、障害対応
- docs/deployment-adapter.md: 配置アダプターの入力、証跡、失敗条件
- docs/reviews/: 実装前後の敵対的レビュー記録
