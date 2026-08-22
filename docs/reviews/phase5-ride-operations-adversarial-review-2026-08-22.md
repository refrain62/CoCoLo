# Phase 5送迎機能の敵対的レビュー

レビュー日: 2026-08-22

対象: `feature/phase5-ride-operations`

仕様: FS-RIDE-001、実装計画のPhase 5

## 結論

Critical 0件、High 0件です。

このブランチの機能コードは、共有ファイルを変更せずにcontract、domain、DB repository、API、Webの責務を分離しています。

Prisma schema、中央API、中央Webへの統合と実DBのmigrationは、依頼で指定された変更禁止境界のため統合側の完了条件として残しています。

これは未解消の脆弱性ではなく、統合前に必ず確認する前提です。

## 確認観点

| 観点 | 結果 | 根拠 |
| --- | --- | --- |
| tenant越境 | 合格 | actorのtenantをHTTP入力から受け取らず、全SQLのtenant条件、transaction-local RLS、active membership再確認を実施 |
| 認可 | 合格 | 予定作成、補助マッチング、手動割当、配車表、メトリクスをowner、admin、staffへ限定し、guardianは担当memberだけへ限定 |
| 個人情報 | 合格 | 利用者向けprojectionから他人のuserIdを除外し、監査とメトリクスへ氏名、住所、電話番号を保存しない |
| 入力検証 | 合格 | Zodのstrict schema、容量上限、人数上限、UUID、日時、Google Maps URLの二段検証 |
| 定員超過 | 合格 | domainの残席計算、手動割当前の再計算、plan単位transaction lock、未割当状態、専用テスト |
| 状態遷移 | 合格 | `pending`、`assigned`、`unassigned`、`cancelled`とoffer、planの状態をrepositoryで条件付き更新 |
| 外部リンク | 合格 | HTTPS、許可host、Maps pathのみを受け付け、credential、port、fragmentを拒否し、Webにも再検証を残す |
| 監査 | 合格 | 状態変更とaudit INSERTを同じtransactionへ束ね、件数とIDだけをmetadataへ保存 |
| メトリクス | 合格 | 個人を含まない席数集計と割当率を管理者だけへ返す |
| テスト不足 | 条件付き合格 | domain、contract、DB repository、API、Webの専用テストを追加した。実PostgreSQLのride検証はmigration後に必要 |
| 仕様不整合 | 合格 | FS-RIDE-001の車、希望、割当結果、未割当、変更履歴、Maps、監査、メトリクスを実装範囲へ対応付けた |

## 指摘と対応

### RIDE-H-001 認証middlewareを機能routeが直接持たない

初期確認では、`registerRideRoutes`がJWT検証そのものを実装せず、`getAuth`依存性を受け取る点を確認しました。

この機能は中央`app.ts`を変更できないため、既存の認証middlewareと分離したroute登録が必要です。

未認証時に`getAuth`がnullを返す場合は401を返し、tenant、user、roleをHTTP入力から作らない契約を`docs/integration/phase5-ride-operations.md`へ固定しました。

専用APIテストで未認証401を確認し、統合チェックリストでrouteを認証後へ登録することを必須化したため、High 0件としてクローズします。

### RIDE-H-002 割当競合で定員を超える可能性

単純な残席計算だけでは、二つの要求が同時に同じ車へ入ると定員を超えます。

DB repositoryはplan単位の`pg_advisory_xact_lock`、行ロック、残席再計算、assignment INSERTを同じtransactionへ束ねました。

domainは既存assignmentを差し引き、手動割当は同じrequestの既存割当を除外して再計算します。

統合migrationへ外部writer対策のtriggerまたは遅延検査を要求し、実DBの競合試験を統合チェックリストへ残したため、機能ブランチのHigh 0件としてクローズします。

### RIDE-H-003 guardianが任意memberの希望を登録する可能性

リクエストにmemberIdを受け取るだけでは、別のguardianが他家庭のmemberを指定できます。

repositoryは同じtenantの`guardian_members`に同じuserIdとmemberIdの組がある場合だけINSERTを成立させます。

管理者は管理操作としてtenant内memberを扱えますが、guardianへは自分の担当範囲だけを返します。

APIテストで担当member限定と他人のuserId非表示を確認したため、High 0件としてクローズします。

### RIDE-H-004 Mapsリンクから任意サイトへ誘導する可能性

URL形式だけを検査すると、外部host、HTTP、credential付きURL、fragment付きURLを受け付ける可能性があります。

contractはURL基本形式を検査し、domainはHTTPS、許可host、Maps path、credential、port、fragmentを再検査します。

Webも表示直前にdomain検証し、`target="_blank"`へ`rel="noreferrer"`を付けます。

外部Maps APIや任意リダイレクトを導入しないため、High 0件としてクローズします。

## 残存する統合前提

次の項目は、このブランチで変更してはいけないファイルに依存するため、統合側の作業として記録します。

- ride用Prisma schemaとmigrationがまだ存在しない。
- 中央APIへrouteを登録していない。
- 中央Webからpanelへ遷移するnavigationを追加していない。
- 実PostgreSQLでRLS、複合外部キー、定員競合、監査原子性をまだ実行していない。

これらを解消せずにproductionへ配置することはできません。

## 検証結果

```text
pnpm --filter @cocolo/domain build       成功
pnpm --filter @cocolo/db build           成功
pnpm --filter @cocolo/api build          成功
pnpm --filter @cocolo/ui build            成功
pnpm --filter @cocolo/web build           成功
pnpm --filter @cocolo/api test:unit       26 tests passed
pnpm vitest run packages/db/test/ride-repository.vitest.ts apps/web/src/features/ride-operations/ride-operations-api.vitest.ts 5 tests passed
pnpm exec biome check 対象ファイル       成功
```

全体の`pnpm test`、`pnpm build`、実PostgreSQLのride統合テストは、統合migrationと中央route接続後に実行します。
