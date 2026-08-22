# 全機能統合ベース

## 目的

このブランチは、完成済み機能のコード、契約、ドメイン、リポジトリ、テスト、レビュー記録を一つの作業基盤へ集約するためのものです。
中央API、Webエントリーポイント、Prismaスキーマ、中央OpenAPIへの接続は後続の中央統合で行います。

## 統合条件

- 起点: `origin/develop` `d7e5f16`（Node.js 24の標準TypeScript実行環境）
- 統合ブランチ: `integration/all-features`
- 対象: Phase 1、Phase 2、Phase 3役員連絡先、Phase 3購買集金、Phase 4 R2添付、Phase 4 LINE通知、Phase 5送迎
- 対象外: 回覧板、認証チーム選択、共通API強化
- PR: このブランチからのPRは作成せず、後続の中央接続作業へ引き渡します。

## 取り込み結果

| 機能 | 取り込み元の最新commit | 統合内容 |
| --- | --- | --- |
| 部員ライフサイクル | `6ecd3be` | 契約、ドメイン、DB、APIテスト、Web、E2E、レビュー記録 |
| 予定・出欠 | `2a88106` | 契約、ドメイン、DB、API、Web、migration、テスト、レビュー記録 |
| 役員・連絡先 | `8e4ad83` | 契約、ドメイン、DB、API、Web、テスト、レビュー記録 |
| 購買・集金 | `b7f7749` | 契約、ドメイン、DB、API、Web、テスト、レビュー記録 |
| R2添付 | `55ff814` | 契約、ドメイン、DB、API、Web、migration、R2 adapter、テスト、レビュー記録 |
| LINE通知 | `2e4f738` | 契約、ドメイン、DB、API、Web、adapter、テスト、レビュー記録 |
| 送迎 | `9df17f6` | 契約、ドメイン、DB、API、Web、テスト、レビュー記録 |

各機能のリポジトリ実装は、機能ブランチの内容をそのまま取り込みました。
統合時に機能コードの削除、簡略化、仕様変更は行っていません。

## 競合解消方針

競合したのは、複数機能が同時に更新した `packages/contracts/package.json`、`packages/db/package.json`、`packages/domain/package.json` だけです。
各機能の公開サブパスを併記し、Node.js 24の標準TypeScript実行に合わせたスクリプトを維持しました。
DBのテストスクリプトは、TypeScriptテストと既存のMJSテストを両方実行できる設定に統合しました。
依存関係の変更を伴うブランチの `pnpm-lock.yaml` は取り込み内容を保持し、手動で依存バージョンを変更していません。

統合単位のコミットは次のとおりです。

- `19d84ea` 部員ライフサイクル取り込み
- `9cc953d` 予定・出欠取り込み
- `0d7a3b5` 役員・連絡先取り込み
- `329baee` 購買・集金の公開設定競合解消
- `df9e2d4` 添付の公開設定競合解消
- `726d639` LINE通知の公開設定競合解消
- `059760e` 送迎の公開設定競合解消

## 中央接続ファイルを除外した理由

次のファイルは `origin/develop` の内容へ戻しました。

- `apps/api/src/app.ts`
- `apps/web/src/main.tsx`（対象ブランチから変更なし）
- `packages/db/prisma/schema.prisma`（対象ブランチから変更なし）
- `packages/contracts/openapi.yaml`
- `packages/contracts/src/openapi-source.ts`

これらはルート登録、Web画面登録、DBスキーマ、中央OpenAPIの責務を持ちます。
機能コードを先に集約して中央接続を後続作業へ分離するため、統合ベースでは変更していません。
部員ライフサイクルのAPIルートも同じ理由で中央APIへ接続せず、機能ブランチ側の実装とテストを取り込み対象として保持しています。
R2添付の契約変更と中央OpenAPIの同期は、中央接続時に同一変更単位として確認してください。

## 後続作業への注意

- 各機能のmigrationをPrismaスキーマへ統合し、migration順序、RLS、grant、tenant境界を確認する。
- 各機能のAPIを `apps/api/src/app.ts` へ登録し、中央OpenAPIを契約ソースから再生成する。
- 各機能のWeb画面を `apps/web/src/main.tsx` へ登録する。
- 実PostgreSQL、R2、LINEのstaging接続で結合テストを行う。
- 統合後に、認可、テナント越境、個人情報、入力検証、状態遷移、外部サービス障害時の挙動を再度敵対的に確認する。
