# 中断再開タスクリスト

更新日：2026-08-29

基準：`origin/develop`

この文書は、未完了タスクと再開時の停止条件だけを管理します。

完了事項、詳細な検証結果、過去レビューは[完了履歴](resume-task-history.md)へ移します。

## 状態

`[~]`は実装済み部分を含む継続作業、`[ ]`は未着手または受入待ち、`[!]`は外部操作や資格情報が必要な停止条件です。

| 状態 | ID | 次に確認すること |
| --- | --- | --- |
| `[!]` | T014-ROOT / T014-SCAN / T014-PR | `main`のowner-only bootstrapはPR #51、UUIDv7検査のowner-only拡張はPR #247・#249・#250、trusted PRのowner-only extension適用境界はPR #259・#260で`develop`へ統合済み。protected path renameのfail-closed実装も完了したが、scanner初回導入、rename・削除経路の実行確認、branch protectionを同一rootで確認する |
| `[ ]` | T014-E2E | PostgreSQL付きperiodic E2Eの定期・手動実行、固定レポート、失敗Issue同期を実行する |
| `[ ]` | T014-RATE | 実Redis相当、原子的consume、TTL、複数API instance、障害時503をstagingで確認する |
| `[ ]` | T014-RELEASE | T-014各検査が同じ最新SHAで成功した証跡をまとめる |
| `[~]` | LINE-DELIVERY-001 | 実DB、unknown照合、Windows改行差分はPR #231で確認済み。LINE provider、staging送信・再送・Webhook受入を確認する |
| `[ ]` | LINE-DELIVERY-002 | unknownの照合、保持期間、再送、監査、担当者を運用仕様に確定する |
| `[~]` | API-001 / DB-002 | events/LINEのlocal統合回帰はPR #231、共通RLSのactive membership/role再検証はPR #235でdevelop統合済み。分散rate limitの本番条件、UUIDv7移行前検査、staging実DB/RLS受入を継続する |
| `[ ]` | RELEASE-001 | stagingとproductionのsecret、bucket、JWT、artifact、migration境界を分離する |
| `[~]` | BRD-001 | feature契約ゲートはPR #185、年度引き継ぎUUIDとcopiedCountはPR #187、staff/guardianの閲覧専用WebはPR #189、DB PII境界はPR #191で統合済み。OpenAPI、staging実DB/RLS受入を完了する |
| `[~]` | ORD-001 | 注文・集金のrepository、RLS、状態遷移、同時実行、staging E2Eを確認する |
| `[~]` | FIL-002 | R2実adapter、署名URL期限、実体検証、cleanup、認可downloadをstagingで確認する |
| `[~]` | ANN-001 | 回覧、既読、添付download、R2認可、未読者の個人情報境界を確認する |
| `[~]` | NOT-001 | 中央producerの通知元境界はPR #177、回覧掲載producerはPR #183で統合済み。未払いproducer、staffの手動通知権限仕様、実LINE受入を確定する |
| `[~]` | NOT-002 / NOT-003 | FS-NOT-002のWeb deep link・OAuth復帰・複数チーム選択はPR #179で実装済み。staging専用LINE groupの接続、Webhook、送信、unknown、再送、実ブラウザ受入を残す |
| `[!]` | RIDE-002-ACCEPTANCE | 確定配車の表示名・乗車人数projection、プロフィール表示名更新、確定公開中の名前固定、2つのplanへの同一運転者同時登録の実DB回帰検証（PR #229）を実装済み。Google Mapsのkey・origin・費用・障害時表示、Supabase staging実DBのRLS・競合、manager/guardianの実ブラウザ受入を確認する（実装履歴は[完了履歴](resume-task-history.md)のRIDE-002見出し） |
| `[!]` | OPS-001〜007 | Auth、PostgreSQL、R2、LINE、rate limit、GitHub保護、production昇格、公開LPの性能基準とstaging再計測の外部条件を満たす |
| `[ ]` | ORIG-REQ-001 | 当初要求の未実装分を機能単位に分解し、仕様・コード・実DB・staging受入まで完了する |
| `[~]` | UI-001〜003 | role別主要画面、保存APIの冪等性、未接続・失敗・権限不足の表示を受入する |
| `[!]` | ADMIN-TEAM-001-ACCEPTANCE | ログイン後回帰修正とチーム画面のシェル・ダッシュボード統合はPR #233・#238・#256で`develop`統合済み。stagingでSupabaseの`system_admin` claim付与、migration適用、実DBのRLS（公開publishedのみ・tenant越境不可）、実ブラウザの`/admin`・`/team`・`/dashboard`受入を確認する（実装履歴は[完了履歴](resume-task-history.md)） |

各IDの詳細な仕様は[機能仕様書](functional-specification.md)と[統合契約](integration/)を参照します。

## 再開手順

1. `git status --short --branch`で差分を確認し、未コミット変更を破棄しない。
2. Node.jsとpnpmの固定版、`origin/develop`、対象branchの最新SHAを確認する。
3. 対象仕様IDの受入条件と、この表の停止条件を確認する。
4. `pnpm ci:fast`、必要なら`pnpm ci:local`、staging受入の順に実行する。
5. tenant越境、認可、個人情報、入力、状態遷移、冪等性、競合、障害表示をレビューする。
6. CriticalとHighが0件になったら、実装PRとdocs-onlyの履歴更新を分けて完了する。

## 完了判定

- `develop`の実装と機能仕様書の受入条件が一致している。
- API、Web、DB、OpenAPI、RLS、staging E2Eが対象範囲で揃っている。
- 外部サービス未設定・失敗状態を成功として表示しない。
- stagingで検証した同一artifactだけをproductionへ昇格できる。
- CriticalとHighが0件で、残るMediumと外部停止条件をこの表へ記録している。
