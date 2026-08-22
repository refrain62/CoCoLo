# FS-AUTH-002 敵対的レビュー

## 対象

対象ブランチは`feature/auth-team-selection`です。

対象仕様は`docs/functional-specification.md`のFS-AUTH-002です。

中央統合前の専用部品として、契約、ドメイン、DB adapter、APIルート、Web部品を確認しました。

## 観点別の確認

| 観点 | 確認内容 | 判定 |
| --- | --- | --- |
| テナント越境 | tenant IDをJWTやrepositoryのuser IDとの組み合わせで再検証し、他利用者の所属は403にする。 | 合格 |
| 認可 | active所属だけを一覧・選択対象にし、roleはリクエストbodyから受け取らない。 | 合格 |
| 所属状態 | `invited`と`suspended`を選択肢から除外し、直接選択も403にする。 | 合格 |
| 入力検証 | UUIDv7、未知キー、JSON形式をAPI境界で検証する。 | 合格 |
| 個人情報 | 応答にはtenant ID、チーム名、roleだけを含め、user IDや所属状態を返さない。 | 合格 |
| 選択状態 | 同一利用者がactive所属を明示的に切り替え、選択結果を更新できる。 | 合格 |
| 競合 | 選択状態をサーバーの暗黙状態にせず、中央統合後は各業務リクエストで所属を再検証する。 | 合格（中央統合で継続確認） |
| DB境界 | adapterは既存schemaのread契約に閉じ、業務APIでRLS contextを設定する統合契約を文書化する。 | 合格（中央統合で継続確認） |

## 指摘

### Critical

指摘なし。

### High

指摘なし。

### Medium

| ID | 内容 | 対応 |
| --- | --- | --- |
| AUTH-TEAM-M-001 | このブランチでは中央middleware、共有API、Prisma schema、実PostgreSQL統合テストを変更していない。 | 中央統合でヘッダー再検証、RLS、tenant A/Bの実DBテストを追加する。 |
| AUTH-TEAM-M-002 | Webの選択状態はメモリ上のため、ページ再読み込み後は再選択が必要になる。 | Auth session統合時にactive所属一覧を再取得し、未選択状態を業務画面へ渡さない。 |

## 判定

専用部品の範囲ではCritical 0件、High 0件で合格とします。

中央統合前のため、Mediumの二項目は未解消のまま残し、統合ブランチの受け入れ条件として記録します。

