# CoCoLo 実装計画

更新日：2026-08-25

## この文書の役割

この文書は、技術境界と実装順を定める「どう作るか」の正本です。

機能の振る舞い、権限、状態遷移、受け入れ条件は[機能仕様書](functional-specification.md)に置き、未完了タスクは[中断再開タスクリスト](resume-task-list.md)に置きます。

完了済みの実装とレビューは[完了履歴](resume-task-history.md)、検証コマンドと失敗条件は[検証手順書](verification-runbook.md)を参照します。

企画時の要求との差分は[当初要求トレーサビリティ](original-requirements-traceability.md)で管理します。

## 技術境界

| 領域 | 採用 | 境界 |
| --- | --- | --- |
| Web | Vite、React、TypeScript | `packages/contracts` と `packages/ui` だけを参照し、DB・秘密情報・API実装へ直接依存しない |
| API | Hono、Node.js 24 | 認証、tenant解決、認可、レート制限、監査、レスポンス契約を入口で強制する |
| DB | Supabase PostgreSQL、Prisma | `packages/db`だけがschema、migration、repositoryを所有する |
| 認証 | Supabase Auth | WebはBearer tokenを送り、Service Role Keyはサーバーだけが扱う |
| 契約 | Zod、OpenAPI 3.1 | 公開DTOを生成元とし、DB modelをそのまま公開しない |
| 添付 | Cloudflare R2 | 非公開bucketへ保存し、認可後に短期URLを発行する |
| テスト | Vitest、Node test、Playwright | local実DBとstaging接続を分離し、外部サービス未接続を成功扱いにしない |

WebとAPIの公開経路は`/api/v1`のHTTPS JSON APIです。

全ての業務データはtenantと利用者の所属を境界にし、DBのRLSをAPIの認可と併用します。

IDはUUIDv7、tenantに属する参照はtenantを含む複合制約で検査します。

## DBとmigration

Prismaのschema変更からmigration SQLを生成し、SQL、RLS、権限、複合外部キーをレビューしてから適用します。

ローカルでは`migrate dev`、stagingとproductionでは`migrate deploy`を使います。

migrationは英語のsnake_case、UTF-8 BOMなし、LF改行とし、作成または変更した表と列には用途を示すSQLコメントを付けます。

既存データの変換、UUIDv7移行、状態trigger、権限変更を含むmigrationは、適用前検査と実DB検証を完了条件にします。

## 実装順

1. **共通基盤**：認証、tenant選択、公開契約、RLS、部員、年度更新。
2. **予定運用**：予定、出欠、締切、リマインド、当番。
3. **チーム運営**：役員・連絡先、共同購買、集金、CSV。
4. **配信と資料**：添付、回覧、LINE通知、Webhook、worker。
5. **送迎**：希望、提供枠、割当案、確定、公開、地図リンク。
6. **外部受入**：Supabase、R2、LINE、Redis相当、Google Mapsのstaging検証。

各機能は、仕様IDの確認、API・Web・DBの実装、tenant境界と認可の検査、local実DB検証、staging受入、独立レビューの順に完了させます。

自動処理は割当案や通知登録までに留め、利用者へ確定状態を公開する処理は明示的な権限と状態遷移を通します。

## 開発とCI

Node.jsは`24.12.0`以上`25`未満、pnpmは`10.26.0`に固定します。

検証は同時実行せず、依存関係、静的検査、build、test、typecheck、lint、実DB、E2Eの順に行います。

| コマンド | 用途 |
| --- | --- |
| `pnpm ci:fast` | PRの短時間品質ゲート。static、契約、unit、typecheck、build |
| `pnpm ci:local` | local PostgreSQL/Supabase、migration、RLS、integration、E2Eを含む検証 |
| `pnpm ci:staging` | stagingのmigration、配置、smoke、E2E。未設定時はfail-closed |

GitHub Actionsの長時間Workflowは手動起動とし、productionはstagingで検証した同一commitとartifactだけを昇格させます。

CIの詳細、schema drift、trust root、DB整合性は[検証手順書](verification-runbook.md)に統合しています。

## 文書を更新する順序

仕様を変更するときは、機能仕様書、実装計画、API・DB・画面の契約、テスト、再開台帳の順に更新します。

完了事項をこの文書へ追記せず、完了履歴へ一行で記録します。

現在の停止条件は[中断再開タスクリスト](resume-task-list.md)だけを参照してください。
