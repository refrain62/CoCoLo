# 現行機能の棚卸し

更新日：2026-08-25

基準：`develop` の `d2deb05`（PR #162反映後）

この文書は、機能実装へ着手する前に、利用者が何を行えるか、管理者が何を設定するか、現行 `develop` に何が入っているか、何が残っているかを確認するための状態台帳です。

業務上の正本は [機能仕様書](functional-specification.md) です。

残作業の正本は [中断再開タスクリスト](resume-task-list.md) です。

## 状態の読み方

| 状態 | 意味 |
| --- | --- |
| 統合済み | `develop` に実装が入り、残りは外部環境または受入確認です。 |
| 部分統合 | API、Web、DB、外部サービスのいずれかが残っています。 |
| 未統合 | 仕様または旧feature branchは存在しますが、現行 `develop` の利用機能として扱いません。 |
| 対象外 | 現行仕様で実装しない機能です。 |

## 機能一覧

| 機能 | 主な利用者 | 管理者の操作 | 現行 `develop` | 残作業と完了条件 | 正本・タスク |
| --- | --- | --- | --- | --- | --- |
| 認証、所属チーム、role | 全利用者 | 所属承認、停止、チーム選択 | 統合済み | role別ブラウザ受入、stagingの複数所属と停止状態を確認する | FS-AUTH、API-001、UI-003 |
| 部員、保護者連携、年度繰り上げ | owner、admin、staff、guardian | 部員の登録、編集、退部、年度繰り上げ | 統合済み | 実DBの認可、個人情報投影、年度繰り上げの受入証跡を確認する | FS-MEM、T-012、UI-003 |
| 予定、出欠、締切、当番 | owner、admin、staff、guardian | 予定、締切、当番、集計を管理する | 統合済み | role別の作成、編集、回答、締切後制御をstagingで確認する | FS-EVT、FS-DUT、EVT-001、UI-003 |
| 役員、連絡先 | owner、admin、staff | 年度役職、担当、連絡先表示を管理する | 未統合 | 中央schema、RLS、個人情報投影、Web、実DB受入を完了する | FS-BRD、BRD-001 |
| 共同購買、集金、CSV | owner、admin、staff、guardian | 商品、注文、支払い、未払い、CSVを管理する | 部分統合 | 実DBのRLS、状態遷移、同時実行、staging E2Eを確認する | FS-ORD、ORD-001 |
| 添付ファイル、非公開画像 | owner、admin、staff、guardian | 添付の登録、公開範囲、削除を管理する | 部分統合 | stagingの実R2、署名URL期限、実体検証、cleanup、認可downloadを確認する | FS-FIL、FIL-002 |
| 回覧、既読管理 | owner、admin、staff、guardian | 回覧掲載、添付、未読者を管理する | 部分統合 | R2認可、既読境界、個人情報投影、staging受入を確認する | FS-ANN、ANN-001 |
| LINEグループ通知 | owner、admin、staff、guardian | owner/adminがgroup IDを接続、切断、汎用通知、再送する | 部分統合 | 実LINE受入、deep linkのtenant束縛、staff権限、回覧と未払いproducerの仕様決定を完了する | FS-NOT、NOT-001〜003、OPS-004 |
| 送迎、配車表 | owner、admin、staff、guardian | 定員、希望、割当、受付、確定、公開を管理する | 部分統合 | role別UI、状態遷移、Google Maps境界、staging E2Eを確認する | FS-RIDE、UI-003 |
| UI共通基盤、レスポンシブ表示 | 全利用者 | role別に許可操作を表示する | 部分統合 | 390pxから1280px以上、キーボード、focus、disabled、未接続、role別の受入を記録する | UI-001〜003 |

## LINE機能の現行契約

LINEは個人アカウントをCoCoLoへ紐付ける機能ではありません。

Botが参加するLINEグループを一つのteamへ接続し、Webで正本を管理する予定と出欠締切を通知します。

予定の作成と更新は owner、admin、staff が行えます。

予定作成時の予定通知と出欠締切通知は、接続済みgroupがある場合だけ、予定保存と同じtransactionへ登録します。

予定更新時は出欠締切通知を更新します。

Web画面からの汎用通知登録と再送は owner と admin に限定しています。

staffの汎用通知登録、回覧の自動通知、未払い通知の自動producerは現行 `develop` にありません。

公式アカウントへの配信、個人LINEへの配信、QRコード接続、LINE OAuth接続、返信による業務状態更新は対象外です。

利用手順、API、outbox、Webhook、障害運用、受入条件は [LINE通知の利用契約](integration/phase4-line-notifications.md) に記載します。

## 実装着手時の確認順

1. 対象機能の機能仕様IDと、利用者および管理者の操作をこの文書で確認します。
2. 現行 `develop` に統合済みか、旧feature branchだけが存在する未統合機能かを確認します。
3. API、Web、DB、RLS、外部サービス、ログ、監査、未接続時の挙動を残作業へ分解します。
4. tenant越境、role認可、個人情報、入力検証、状態遷移、冪等性、競合、障害時の表示を受入条件へ記載します。
5. 実装、敵対的レビュー、local検証、staging受入、証跡保存、docs更新を同じ機能単位で完了させます。
