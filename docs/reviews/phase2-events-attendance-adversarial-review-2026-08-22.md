# Phase 2の敵対的レビュー

レビュー対象は`feature/phase2-events-attendance`の`759b2d0`です。

対象機能はFS-EVT-001〜003です。

## 判定

Criticalは0件です。

Highは0件です。

Phase 2のfeature実装はDraft PRへ進めます。

## 確認項目

### tenant越境

予定と出欠回答は`tenant_id`を持ち、予定と回答の外部キーはtenantを含む複合キーです。

repositoryはtransaction-localなRLS contextを設定し、active membershipを同じtransactionで再確認します。

APIの公開DTOから`tenantId`を除外し、tenantをrequest bodyから受け取りません。

APIテストでは、JWTで解決したtenant以外の予定を返さないことを確認しています。

### 認可

予定の登録と編集は`owner`、`admin`、`staff`に限定しています。

guardianの回答は`guardian_members`の担当関係をrepositoryとRLSで確認します。

guardianは締切後に回答を変更できません。

出欠集計は`owner`、`admin`、`staff`だけが利用できます。

APIテストでは、owner、admin、staff、guardianの拒否と許可を確認しています。

### 個人情報

予定DTOへtenant IDを返しません。

出欠DTOへ回答者のuser IDと監査情報を返しません。

出欠集計は氏名を返さず、未回答部員のopaqueなIDだけを返します。

締切後の修正理由は監査ログと回答行へ保存し、通常の回答では保存しません。

### 入力検証

予定契約は未知の項目を拒否し、開始時刻、終了時刻、出欠締切、集合時刻の前後関係を検証します。

試合の対戦相手、会費、日時、出欠回答の列挙値をAPI契約で制限します。

repositoryでもドメイン検証を再実行するため、API以外の呼び出し経路が契約検証を迂回しても時間関係を保持します。

### 状態と競合

出欠回答は`tenant_id`、イベントID、回答者ID、部員IDのunique制約で一意になります。

repositoryは同じ組み合わせをupsertし、同一回答の再送で行を増やしません。

DB triggerは回答者、tenant、イベント、部員の識別子を更新できないようにします。

DB triggerは締切後のguardian回答を拒否し、管理者修正理由を要求します。

### 監査

予定の一覧、登録、編集、出欠回答、出欠修正、集計を監査ログへ記録します。

監査主体はRLS contextのuser IDと一致し、予定の作成者と更新者もDB policyで実行者へ固定します。

## 修正した指摘

| ID | 重大度 | 指摘 | 修正 | 修正コミット |
| --- | --- | --- | --- | --- |
| PH2-H-001 | High | repositoryを経由しない直接SQLで予定の作成者や出欠回答者を偽装できる余地があった | RLS policy、識別子固定trigger、回答者固定trigger、締切後理由triggerを追加 | `fbf8a37` |
| PH2-H-002 | High | APIに予定編集があってもWeb画面から編集できなかった | owner、admin、staff向けの予定編集フォームを追加 | `759b2d0` |

上記のCriticalとHighは修正後に再確認し、残っていません。

## 検証結果

次の検証は成功しました。

* `pnpm test:contracts`
* `pnpm --filter @cocolo/domain test`
* `node --test apps/api/test/events.test.mjs`
* `pnpm exec vitest run apps/web/src/features/events/events-api.vitest.ts`
* `pnpm --filter @cocolo/api build`
* `pnpm --filter @cocolo/web typecheck`
* `pnpm --filter @cocolo/web build`
* `pnpm --filter @cocolo/db build`
* `pnpm verify:migration-sql`
* `git diff --check`

`apps/api/test/integration/events-db.test.mjs`は実PostgreSQLで実行するテストです。

今回の分離環境ではDocker EngineのAPIへ接続できなかったため、実PostgreSQLの統合テストはローカル実行できていません。

Draft PRの品質ゲートではmigration適用後にこの統合テストを実行し、SQL triggerとRLSの実行結果を確認する必要があります。

## 残余リスク

中央`app.ts`と`main.tsx`を変更していないため、Draft PRをdevelopへ統合する際にAPI routeとWeb画面の登録が必要です。

OpenAPI生成元へのpath追加、中央登録後のPlaywright E2E、staging Supabaseとの結合はこのfeatureブランチの対象外です。

これらは機能の認可とデータ境界を未検証のままにする指摘ではなく、明示した統合段階の作業です。
