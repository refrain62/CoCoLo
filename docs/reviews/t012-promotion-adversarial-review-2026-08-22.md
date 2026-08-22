# T-012 年度繰り上げ 敵対的レビュー

## 判定

実装範囲のレビューでは Critical 0件 / High 0件。Node.js 24を前提に、ローカル検証とCIのPostgreSQL検証を分けて判定し、Draft PRの品質ゲート成功を確認済みとする。

## 対象

- FS-MEM-005 年度繰り上げ
- `POST /api/v1/members/promote` の認証・入力検証・preview/execute
- `PromotionRun` の冪等性、失敗再試行、DB状態遷移
- active/student限定の学年繰り上げ、監査ログ、Web確認画面
- 実装コミット: `143a328`、`a2c2e38`、`ce22360`、`50f7907`、`e005d73`、`3e5313c`、`56b5812`、`cb7ca22`、`76b0bb6`、`1cc3be5`、`7cc5b17`

## 敵対的確認

| 観点 | 確認結果 |
| --- | --- |
| テナント越境 | tenantIdをリクエストから受け取らず、同一transaction内でユーザー単位のadvisory lockを取得してからRLS準拠のPrisma参照でactive membershipを確認する。年度処理はtenant単位のadvisory lockで直列化し、対象member行・PromotionRunをRLS下でロックし、member更新は`tenantId + id`で実行する。tenant A/BのPostgreSQL統合テストを追加。 |
| 認可 | APIはowner/adminだけを許可し、staffの403をテスト。DB側も`promotion_runs`と`members`のRLS policy、およびmembership再確認で二重化。 |
| 個人情報 | response、PromotionRun.result、監査metadataには部員名・kana・noteを保存せず、変更対象IDと学年値だけを保存。監査metadataにfixture名が混入しない統合テストを追加。 |
| 入力検証 | Zod strict schemaでmodeと年度を検証し、年度を2000〜2100に制限。executeのIdempotency-Key必須・128文字上限・空白除去をAPIで検証。 |
| 冪等性・競合 | tenant単位のadvisory lockで同一tenantの並行年度処理を直列化。同一年度のcompletedは保存済み結果を返し、同一keyのhash変更・年度変更・key変更は409。Web executeは毎回ランダムkeyを生成する。 |
| 状態遷移 | DB triggerでpreview開始、preview→completed/failed、failed→completed/failedだけを許可し、completedからの巻き戻し、tenant・年度・実行者・hash・keyの改変を拒否。学年上限超過はfailedに保存し、データ修正後の同一key再試行をテスト。 |
| transaction | member更新、監査ログ、PromotionRun更新を同一Prisma transactionで実行し、計画エラー以外の失敗はロールバックされる。 |
| UI確認 | preview結果の対象件数、対象外条件、17以上表示、卒業・留年の自動判定なし、退部非対象を表示し、確認ダイアログ後だけexecuteする。 |
| 契約 | OpenAPIにrequest、Idempotency-Key、response、400/401/403/409を追加し、生成物検証を追加。 |

## 検証

- `pnpm test`: 成功
- `pnpm test:unit`: 成功（Vitest 8件、API 22件、contracts/domain含む）
- `pnpm build`: 成功
- `pnpm typecheck`: 成功
- `pnpm verify:production-bundle`: 成功
- `pnpm lint:openapi`: 成功
- `pnpm lint:workflows`: 成功
- `pnpm --filter @cocolo/db build`: 成功
- `pnpm --filter @cocolo/api test:unit`: 成功
- `pnpm --filter @cocolo/api test:integration`: ローカルはDATABASE_URL未設定かつDocker API利用不可のため未実行。Draft PRの品質ゲート `32557510191` でPostgreSQL統合テスト成功を確認した。
- `pnpm lint`: ローカルの`core.autocrlf=true`により、既存LFファイルがCRLFとして読み込まれるためBiomeの既存ファイル書式検査で停止。今回の変更ファイルを指定したBiome検査は成功。CIのLinux checkoutで再検証する。
- PR品質ゲート `32557510191`: 静的品質検査、RLS用role、migration/fixture、契約・単体・統合テスト、型検査、Node.js 24のビルドがすべて成功。

## 未解決の外部条件

実Supabase staging接続、deploy adapter、staging専用ユーザー、外部サービス接続はT-009〜T-011の運用課題であり、T-012のコード上のCritical / Highではない。T-012の実装・敵対的レビュー・PR CI検証は完了した。
