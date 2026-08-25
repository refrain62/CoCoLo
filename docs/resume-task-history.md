# 完了タスクと実施履歴

更新日：2026-08-25

この文書は、完了済み作業の結果だけを短く残す履歴です。

現在の停止条件は[中断再開タスクリスト](resume-task-list.md)、業務仕様は[機能仕様書](functional-specification.md)、検証手順は[検証手順書](verification-runbook.md)を参照します。

## 完了済みの実装

| 区分 | 完了内容 | 判定 |
| --- | --- | --- |
| Phase 1 | 認証、tenant選択、部員管理、年度繰り上げ、管理者登録E2E | `develop`統合済み。Critical / High 0件 |
| Phase 2 | 予定、出欠、締切、集計、当番、予定詳細、中央API接続 | `develop`統合済み。実DBの残条件は再開台帳で管理 |
| API共通 | CORS、認証後rate limit、構造化ログ、response runtime検証、中央mount | `develop`統合済み |
| Web共通 | team選択、Auth session lifecycle、認証済みfetch、主要画面の共通UI | `develop`統合済み。role別受入は継続 |
| LINE | 接続、group世代、outbox、worker、管理者再送、Webhook、Web通知、公開response契約 | `develop`統合済み。実LINE受入と仕様差分は継続 |
| 添付・回覧 | R2 adapter配線、添付response契約、回覧添付のavailable DB guard、短期URL download | `develop`統合済み。実R2と回覧受入は継続 |
| 購買・送迎 | 注文APIとWeb、CSV・冪等性、送迎API、送迎Web、公開response契約 | `develop`統合済み。実DB・staging受入は継続 |
| CI・DB | Node.js / pnpm固定、Node 24、local-first quality、migration検査、UUIDv7移行前検査、schema drift検査、PR本文検査 | `develop`統合済み。mainのtrust rootと外部環境は継続 |
| UI安全性 | 二重送信防止、権限別操作表示、認証レイアウト、主要タップ領域、複数幅ブラウザ受入 | `develop`統合済み。認証済み主要画面のrole別受入は継続 |
| BILLING-001 | 有償・無償feature、チーム単位のplan・flag、effective entitlement、監査境界 | PR #172を`develop`へ統合。CI、`pnpm test`、`pnpm build`、migration・trust検証成功。課金provider接続は外部条件として継続 |
| BRD-001 / feature契約 | 役員・連絡先の`board-contacts`契約、API fail-closed、Webメニュー制御、無料feature migration | PR #185を`develop`へ統合。`pnpm test` 200件、`pnpm build`、unit、Biome、workspace boundary、migration、trust、品質ゲート成功。個人情報境界、Web閲覧、実DB/RLS受入は継続 |
| BRD-001 / 年度引き継ぎ | 行ごとのUUIDv7生成、INSERT影響行数による`copiedCount`、APIレスポンスの件数整合 | PR #187を`develop`へ統合。`pnpm test` 200件、`pnpm build`、lint、workspace boundary、品質ゲート成功。実DB/RLSの複数行受入は継続 |
| AUTH-003 / MEM-007 | 招待token、LINE・Google OAuthのprovider subject、member link、連携解除境界 | PR #173を`develop`へ統合。opaque token、fragment URL、active link、CI、`pnpm test`、`pnpm build`成功。OAuth provider実接続は外部条件として継続 |
| API-003 | 出欠、注文、送迎希望でactor userと対象memberを分離し、API・DBで再認可 | PR #174を`develop`へ統合。対象member契約、tenant境界、CI、`pnpm test`、`pnpm build`成功 |
| UI-004 / UI-005 | 管理画面のルート・メニュー分離、feature契約による表示制御、`packages/ui`共通primitive、デザイントークン、レスポンシブ管理シェル | PR #175を`develop`へ統合。招待URL発行、対象member選択、CI、`pnpm test`、`pnpm build`成功。実ブラウザ幅別受入とstaging E2Eは外部条件として継続 |
| NOT-001 / FS-NOT-001 | 中央LINE通知のsourceType・UUIDv7 sourceId、同一tenant resource検証、server生成deep link、API・workerのteam feature flag境界、旧outbox隔離 | PR #177を`develop`へ統合。`pnpm test` 198件、`pnpm build`、migration SQL 30件、DB整合性25件、品質ゲート成功。Web遷移先、未払いproducer、実LINE受入は継続 |
| NOT-001 / 回覧producer | 回覧掲載時のLINE通知outbox登録、feature flag fail-closed、同一transaction、tenant接続group、server生成deep link、staffのDB enqueue権限境界 | PR #183を`develop`へ統合。`pnpm test`、`pnpm build`、Biome、workspace boundary、migration SQL、trust-root、品質ゲート成功。未払いproducer、staffの手動通知権限仕様、実LINE受入は継続 |
| FS-NOT-002 | 通知deep linkの予定・回覧画面、OAuth復帰、複数チーム時の選択、403/404時の安全な再選択画面、拒否時の旧state残留防止 | PR #179/#181を`develop`へ統合。`pnpm test`、`pnpm build`、Web typecheck、対象Vitest 16件、品質ゲート成功。stagingのLIFF不可端末、通常ブラウザ、実LINE受入は継続 |

## 完了判定の共通結果

完了した実装は、tenant越境、認可、個人情報、入力検証、状態遷移、競合、外部サービス未接続の表示をレビュー対象にしました。

CriticalとHighが残る実装を完了扱いにしていません。

実DBや外部サービスを実行していない場合は、CI成功だけで実行済みとは扱わず、再開台帳の外部条件へ残しています。

## 継続中のレビュー指摘

| 分類 | 未解決事項 |
| --- | --- |
| Trust / CI | mainのowner-only bootstrap、scanner protected path、初回導入、default branchの強制 |
| DB | 既存UUIDv4の移行、添付の`available`状態、各機能のRLS受入 |
| 外部受入 | Supabase、R2、LINE、Redis相当、Google Mapsの実接続と障害表示 |
| 機能受入 | 役員、購買、回覧、通知、送迎のstaging E2Eとrole別ブラウザ受入 |

詳細な重大度と次の行動は[レビュー状況](reviews/README.md)と[中断再開タスクリスト](resume-task-list.md)に集約しています。

## 履歴の更新規則

- 完了済みの実装は、この文書へ一行で追記する。
- 実装PRへ履歴や検証ログを混在させず、docs-onlyの変更に分ける。
- 未完了の作業、PR番号、作業ツリー、停止条件はこの文書へ戻さず、再開タスクリストへ置く。
- 過去レビューの本文を再掲せず、未解決の指摘と完了判定だけを残す。
