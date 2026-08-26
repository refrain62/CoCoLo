# レビュー状況

更新日：2026-08-25

ここでは、レビューで残った指摘と完了判定だけを管理します。

実装の現在状態は[中断再開タスクリスト](../resume-task-list.md)、完了履歴は[完了タスクと実施履歴](../resume-task-history.md)を参照します。

## 完了したレビュー

Phase 1の基盤、認証、部員、年度更新、Phase 2の予定・出欠、中央API接続、UI共通基盤、toolchain、PR品質ゲートは、Critical / High 0件で完了しています。

完了済みレビューの詳細な再掲は廃止し、判定と残課題だけをこの文書へ集約しました。

| まとめた対象 | 判定 |
| --- | --- |
| 実装前計画、T-005〜T-012 | Critical / High 0件。残るMediumは後続タスクへ移管 |
| 認証、チーム選択、部員、予定・出欠、UI | Critical / High 0件。外部接続とrole別受入は継続 |
| 役員、購買、添付、回覧、LINE、送迎 | 指摘を実装または残タスクへ移管。実DB・外部サービス受入は継続 |
| 外部サービス、DB分離、配置、toolchain、PR本文 | 契約を運用文書へ統合。未設定時はfail-closed |
| UI-018〜024 | 認証済みroot、feature flag導線、モバイル表、設定画面分離、共通UI、役員連絡先のrole別導線 | 最新feature branchのCritical / High 0件、実装PRとdocs-only PRの分離、`develop`統合 |

## 残る指摘

| 対象 | 指摘 | 完了条件 |
| --- | --- | --- |
| T-014 trust | mainのowner-only bootstrap、protected path、scanner初回導入、rename・削除の境界 | 同一trusted rootで悪性fixtureとmain/default branchの強制を確認 |
| T-014 E2E | PostgreSQL付きperiodic E2Eの実行証跡 | 日次・週次・手動SHA指定・失敗Issue同期を確認 |
| T-014 rate limit | 実provider、原子性、TTL、複数instance、障害時503 | stagingで実Redis相当を確認 |
| DB | 既存UUIDv4、添付`available`、board contactのPII直接SELECT | migration、trigger、RLS、個人情報投影を実DBで確認 |
| 役員・購買・回覧 | 中央schema、RLS、状態遷移、実DB受入 | Critical / High 0件とstaging E2E |
| LINE | deep linkのorigin・resource・tenant束縛、staff権限、回覧・未払いproducer | 仕様、API、Web、DB、実LINE受入を一致させる |
| 添付・送迎・UI | 実R2、Maps外部条件、role別主要画面 | 未接続・失敗・権限不足を含む受入記録 |

## レビュー時の必須観点

tenant越境、認可、個人情報、入力検証、状態遷移、冪等性、競合、監査、外部サービス未設定・障害時の表示を確認します。

CriticalまたはHighが残る変更は、mergeとproduction昇格を停止します。
