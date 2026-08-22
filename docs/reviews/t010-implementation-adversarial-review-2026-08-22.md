# T-010 実装後敵対的レビュー

## 対象

- 対象: T-005〜T-009の成果物（開発基盤、部員API、部員UI、認証・E2E）
- 基準ブランチ: `origin/develop` / `320296e`
- レビュー対象ブランチ: `feature/t009-e2e` / `ea66f91`
- レビュー日: 2026-08-22
- レビュー方式: 実装差分、機能仕様書・実装計画との照合、RLS/JWT/API/UI/Workflowの静的確認、既存のlocal実DB・Playwright・CI結果の確認

## 観点別判定

| 観点 | 判定 | 確認内容 |
| --- | --- | --- |
| テナント越境 | 要継続確認 | JWT subjectから所属を解決し、repository transactionでRLS contextとmembershipを再確認している。owner/admin/staff/guardianのlocal API・実PostgreSQLテストは成功している。一方、複数所属の明示的チーム選択は未実装。 |
| 認証・認可 | 要修正 | JWTのissuer/audience/署名/期限検証とowner/admin登録認可は実装済み。API起動時に許可済み環境・issuerを強制しておらず、直接起動時のfail-closed契約がない。 |
| 個人情報 | 要修正 | API DTOとguardianの担当範囲は確認できるが、部員一覧の検索語をAuditLog metadataへ保存しており、氏名等の自由入力が監査ログへ残る。 |
| 入力検証 | 要修正 | strict schemaで基本値は検証しているが、studentの`ageGroup`およびadultの`gradeLevel`を排他的に拒否していない。DB CHECK違反が400ではなく未処理エラーになり得る。 |
| 状態遷移 | 要継続確認 | 部員登録のactive/suspended入力は実装済み。複数チーム選択、Auth sessionの期限切れ・更新・logout、部員編集・退部・年度繰り上げは未実装で、Phase 1受け入れ条件全体は未達。 |
| 環境混同・供給経路 | 要修正 | `verify:environment`はWorkflow stepとして存在するがAPI起動時に接続されていない。staging/productionの配置stepはecho placeholderで、staging E2Eが実際に今回のartifactを検証した証拠にならない。 |
| テスト十分性 | 要継続確認 | T-009のlocal E2E 5件、実PostgreSQL 4件、CI qualityは成功。ただし上記の起動ガード、PII監査、区分不整合、実artifact配置、複数所属を直接検証するテストはない。 |

## 指摘

| ID | 重大度 | 指摘・攻撃シナリオ | 根拠 | 必須対応 |
| --- | --- | --- | --- | --- |
| T010-H-001 | High | APIをWorkflow外から直接起動すると、`APP_ENV`、Supabase URL/JWKS、R2 bucket、公開URLの許可値を検証しない。さらに`SUPABASE_ISSUER`を任意値で上書きできるため、意図しないSupabase projectのJWTを信頼する環境誤接続が起き得る。 | `apps/api/src/server.ts`、`scripts/verify-environment.mjs`。計画は起動時fail-fastとissuer/環境allowlist一致を要求している。 | API起動経路へ環境ガードを接続し、issuerを`SUPABASE_URL/auth/v1`と一致させる。未設定・不一致の起動拒否と、local/staging/production各境界のテストを追加する。 |
| T010-H-002 | High | stagingの「配置」がechoだけで実デプロイを行わず、直後のE2Eが既存URLの古いartifactに対して成功する可能性がある。`create-staging-evidence.mjs`も観測結果ではなく全項目を固定でsuccessとして作成するため、未検証artifactをproduction promoteの条件にできる。production配置も同じplaceholderである。 | `.github/workflows/staging-deploy.yml`、`.github/workflows/production-promote.yml`、`scripts/create-staging-evidence.mjs`。 | 実デプロイadapterと配置済みSHAの外部確認を実装する。adapterまたは配置検証がない場合はWorkflowを失敗させ、観測したmigration/smoke/E2E/配置結果だけからevidenceを生成する。 |
| T010-H-003 | High | 部員一覧の検索`q`をAuditLog metadataへそのまま保存している。利用者が氏名・ふりがな等を検索すると、個人情報が監査ログに複製され、ログ保持・閲覧範囲へ拡散する。 | `packages/db/src/index.ts` の`member.list`監査記録。計画はJWT・個人情報・アップロード内容をログへ出さないと定義している。 | 検索語を保存せず、必要なら検索実行・フィルター種別・件数等の非個人情報だけを記録する。既存ログの取り扱いと非保存テストを追加する。 |
| T010-H-004 | High | APIへstudentかつ`ageGroup`付き、またはadultかつ`gradeLevel`付きのJSONを直接送るとschemaを通過し、DB CHECK違反が未処理エラーになる。利用者入力を400へ閉じ込める契約に反し、連続送信で500を発生させられる。 | `packages/contracts/src/member-contract.mjs` の`superRefine`が必須値だけを確認し、相互排他を確認していない。`packages/db/prisma/migrations/20260822090000_phase1_foundation/migration.sql`のCHECKと不一致。 | categoryごとに不要な値を`null`または未指定へ限定し、400を返すAPIテストを追加する。想定外repositoryエラーも統一500応答へ収束させる。 |

## Medium / 未達事項

| ID | 重大度 | 内容 | 次の扱い |
| --- | --- | --- | --- |
| T010-M-001 | Medium | FS-AUTH-002の複数チーム選択がなく、active membershipが複数ならrepositoryがnullを返して403になる。 | T-011以降で選択中tenantを明示するAPI/UIとRLSテストを追加する。 |
| T010-M-002 | Medium | `scripts/run-e2e.mjs`は`APP_ENV`未設定時にproduction起動元を識別できず、環境引数を上書きしてE2Eを起動できる。 | T-011でAPP_ENVを必須・期待値一致にする。 |
| T010-M-003 | Medium | access tokenをlocalStorageへ保存し、refresh/logout/期限切れsessionの消去がない。 | 認証強化タスクで対応し、XSS時の影響を縮小する。 |
| T010-M-004 | Medium | APIのCORS allowlist、rate limit、構造化ログ、member responseのruntime schema検証が未実装。OpenAPIにもmember endpointが反映されていない。 | T-011のリリース判定で範囲を確定し、必要なものを実装する。 |
| T010-M-005 | Medium | staging E2Eの固定部員名にcleanup/idempotencyがなく、main pushごとにstagingデータが蓄積する。 | staging fixtureとテストデータの隔離・削除方針を追加する。 |
| T010-M-006 | Medium | この環境ではSupabase staging実接続・実配置を実行できず、実証証跡がない。 | 外部環境のsecret・deploy adapter接続後にWorkflowの成功証跡で再確認する。 |

## 再レビュー判定

テナントRLS、JWT検証、API認可、公開DTOの最小化、local実DB/E2Eは確認できた。しかし、T010-H-001〜T010-H-004が残っており、Critical 0件でもHigh 4件のためT-010は不合格とする。T-011でHighをすべて解消し、修正テスト・全CI・再度の敵対的レビューを完了するまでリリース判定および次の機能実装へ進めない。
