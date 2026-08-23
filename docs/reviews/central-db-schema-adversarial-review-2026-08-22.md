# 中央DBスキーマ敵対的レビュー

レビュー日: 2026-08-22

対象ブランチ: `feature/central-db-schema`

対象: `20260823150000_central_feature_schema`、Prisma schema、中央RLS fixture、統合契約。

## 結論

Criticalは0件である。

Highは0件である。

実PostgreSQLのfresh DBへ既存Phase migrationと中央migrationを適用し、tenant越境、role境界、担当部員境界、状態遷移、監査、個人情報、LINE metadata、送迎定員をfixtureで確認した。

## 指摘と対応

| 重要度 | 指摘 | 対応 |
| --- | --- | --- |
| Critical | RLS policyの相関サブクエリが外側のtenantを誤って自己相関する可能性 | 外側の表名を明示し、別tenantの行を参照できない形へ修正した |
| High | LINE SQL repositoryがtransaction-local RLS contextを設定しない | DB roleのBYPASS RLSでは回避せず、adapterがtransaction開始時にtenant、user、roleを設定する契約をdocsへ固定した |
| High | LINE SQL repositoryが`line_notification_queue.id`をINSERTせずNOT NULL違反になる | `line_notification_queue.id`だけはSQL側の`app_uuidv7()` DEFAULT生成へ統一し、ID省略INSERTを実DBで確認した |
| High | 遅延注文合計triggerが表ごとに異なるNEWフィールドを共通参照する | `order_entries`は`NEW.id`、`order_lines`は`NEW.order_entry_id`として表名と操作種別ごとに分岐した |
| High | 監査ログ更新・削除で改ざんできる | append-only trigger、`REVOKE UPDATE, DELETE`、fixtureの更新拒否を確認した |
| Medium | FS-ORDの永続SQL repositoryが未実装 | 暫定的な表名を採用し、SQL adapter実装時の照合条件を統合docsへ残した |
| Medium | Board/Bulletinの現行ID生成がUUIDv7でない | UUIDv7 CHECKによりmount前に検出できることと、repository交換が必要な条件をdocsへ残した |
| Medium | 単一DB roleでは同一行の個人情報列をrole別に隠せない | API DTOで電話番号・LINE連絡先を投影する契約とテスト条件をdocsへ残した |

## 攻撃観点

### テナント越境

tenant Aのownerからtenant Bのevent、attachment、LINE connectionを見えなくした。

tenant Aのeventへtenant Bのattachmentを関連付けるINSERTを拒否した。

全資源表のtenant複合外部キーとRLS FORCEを確認した。

### 認可と担当部員

owner、staff、guardianで可視行数と書き込み境界を比較した。

guardianは担当部員の出欠、注文、送迎希望だけを扱え、未担当部員の出欠INSERTを拒否された。

context未設定ではeventとattachmentが0行となった。

`cocolo_app`が`rolbypassrls = false`であることを確認した。

### 状態遷移と競合

添付の`uploaded → available`を実行し、`available → uploaded`を拒否した。

購買案件の不正な状態遷移とLINE通知の不正な状態遷移を拒否した。

注文合計の遅延検証と送迎割当のadvisory lock付き定員検証を適用した。

### 個人情報と外部サービス

board contactの電話番号をguardian、staffへそのまま返さないAPI DTO条件を記録した。

R2本体、署名URL、Supabase Auth内部情報、LINE secret、Webhook raw bodyをDBへ保存しないことを確認した。

監査metadataへ電話番号を複製しないfixtureを確認した。

## 検証結果

`pnpm --filter @cocolo/db exec prisma validate`に成功した。

`pnpm verify:migration-sql`に成功した。

対象ファイルのBiome checkに成功した。

`pnpm test`に成功した。

`pnpm build`に成功した。

`pnpm typecheck`に成功した。

fresh専用PostgreSQLへPhase 1と中央migrationをpsqlで適用し、中央RLS fixtureに成功した。

`pnpm lint`は今回の書き込み範囲外にある既存CRLFファイル82件をBiomeが指摘して失敗した。

Prismaのhost側`migrate deploy`はschema engineが接続エラーの詳細を返さず実行不能だったため、migration SQLはpsqlで適用して検証した。

## 残る中央統合条件

LINE SQL repositoryをRLS context設定済みのtransaction clientへ接続するadapter実装は、LINE機能repository側の担当作業である。

DB側でIDを生成する例外はLINE通知キューだけであり、他の表へ同じ責務を暗黙に拡張してはならない。

FS-ORDのSQL adapter、Board/BulletinのUUIDv7生成器、R2 adapterの実体検証は中央DBのCritical/High未解消とは扱わないが、中央mount前の必須条件である。
