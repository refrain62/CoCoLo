# 統合契約

機能の業務ルールは[機能仕様書](../functional-specification.md)、未完了タスクは[中断再開タスクリスト](../resume-task-list.md)が正本です。

このディレクトリは、中央API・DB・外部サービスへ接続するときだけ必要な技術境界を置きます。

| 文書 | 対象 |
| --- | --- |
| `central-db-schema.md` | 中央DB、RLS、UUID、tenant複合制約 |
| `phase3-board-contact.md` | 役員名簿と連絡先の中央接続 |
| `phase3-orders-payments.md` | 共同購買、集金、CSVの中央接続 |
| `phase4-bulletin-board.md` | 回覧、既読、添付の中央接続 |
| `phase4-line-notifications.md` | LINE、outbox、worker、Webhook、deep link |
| `phase4-r2-attachments.md` | R2添付のAPI、実体検証、短期URL |
| `phase5-ride-operations.md` | 送迎、定員、割当、地図リンク |

完了済みの統合メモは残さず、完了履歴と機能仕様へ集約します。
