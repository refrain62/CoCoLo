# CoCoLo

部活・クラブチームの予定、メンバー、保護者、出欠などを管理するWebアプリです。WebとAPIをpnpm workspaceで管理し、APIの業務データはPostgreSQL、認証はSupabase Authを利用します。

## 現在の構成

- Web: Vite + React + TypeScript
- API: Hono + Node.js 24
- DB: Supabase PostgreSQL + Prisma
- 認証: Supabase Auth（APIでJWTを検証）
- CI/CD: GitHub Actions
- 添付ファイル: Cloudflare R2をPhase 4で導入予定

ブラウザからDBや秘密情報へ直接接続しないこと、テナント境界をRLSとAPI認可で守ることを基本方針としています。DBを将来Supabaseから分離してもAPI契約と`packages/db`の境界を維持できるよう、分離仕様を別文書に残しています。

## 開発環境

前提はNode.js 24系とpnpm 10系です。環境変数は[`.env.example`](.env.example)をコピーして設定します。各項目の用途、取得元、秘密情報の扱いはファイル内のコメントと[外部サービス運用仕様](docs/external-services-operations.md)を確認してください。

```powershell
pnpm install
Copy-Item .env.example .env
pnpm build
pnpm test
```

ローカルのSupabase・PostgreSQLを利用する場合の準備やmigrationは、現在の実装スクリプトと[実装計画書](docs/%20implementation-plan.md)に従ってください。

## ドキュメント

- [機能・業務仕様](docs/functional-specification.md): 機能仕様IDと利用者向けの業務ルール
- [実装計画書](docs/%20implementation-plan.md): 技術構成、パッケージ境界、migration、CI/CDの計画
- [外部サービス運用仕様](docs/external-services-operations.md): Supabase、Cloudflare、GitHub Actionsの設定・権限・監視・障害対応
- [DB分離仕様・移行計画](docs/database-separation-plan.md): Supabase PostgreSQLから分離する場合の不変契約、移行対象、照合、復旧
- [デプロイ配置アダプター契約](docs/deployment-adapter.md): staging / productionの配置と証跡の契約

外部サービスの仕様が変更された場合は、コードだけでなく該当する文書、環境変数の説明、staging検証結果、障害対応手順も同じ変更単位で更新します。

## 品質確認

コード変更後は、次の検査を実行します。

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

機能単位の実装は`develop`から専用ブランチを作成し、小さな日本語コミットに分けます。実装、敵対的レビュー、指摘修正、検証、Draft PR作成が終わるまで別機能の変更を混在させません。
