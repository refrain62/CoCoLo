# T-009 認証・管理者登録E2E 敵対的レビュー

## 対象

- 対象機能: FS-AUTH-001、FS-AUTH-003、FS-MEM-002、T-009
- 対象ベース: T-008 Squash Merge `320296e`
- 対象実装: `origin/develop...3bd802e`
- レビュー日: 2026-08-22
- レビュー方式: 差分、認証/API実接続、RLS統合テスト、local Playwright、production bundle、workflow静的検査を確認

## 観点別確認

| 観点 | 確認結果 |
| --- | --- |
| 認証 | WebはSupabase Authのpassword grantへ接続し、取得したaccess tokenを部員APIへBearerで渡す。未認証・期限切れ・署名不正の最終拒否はT-007 APIが行う。 |
| テナント越境 | local test-only tokenは`owner-a`へ固定され、実APIはmembership解決・RLS context・複合境界を通る。管理者登録E2Eはmock APIを使わず実PostgreSQLへ接続する。 |
| 認可 | UIの表示ではなくAPIのowner/admin判定が登録権限を強制する。既存T-008の403 E2EとAPI unit/integration testを継続実行した。 |
| 個人情報 | 認証画面・test-only Authは本番個人情報を扱わない。部員の電話番号・保護者識別子・noteの非表示はT-008 E2Eで確認した。 |
| test-only Auth混入 | adapterは`apps/api/test`に置き、API production tsconfigの`src`対象外とした。`APP_ENV=local`を必須化し、production bundleで固定token・password・test-only文字列を検査する。 |
| 環境混同 | localはVite proxyと固定fixture、stagingはSupabase URL・anon key・専用E2E資格情報をworkflowから注入する。productionからのE2E起動拒否は既存runnerで確認する。 |
| 入力・状態 | ログインフォームのrequired、通信エラー、登録中disable、登録成功を実装し、管理者ログインから部員登録までのlocal E2Eを確認した。 |
| 本番秘密情報 | Service Role KeyをWebへ渡さず、staging buildへ渡すのは公開anon keyのみ。production bundleにtest-only Auth値がないことを確認した。 |

## 指摘と対応

| ID | 重大度 | 指摘 | 修正コミット | 再レビュー判定 |
| --- | --- | --- | --- | --- |
| T009-H-001 | High | `APP_ENV`未設定時にlocal test-only Auth serverが起動でき、環境誤接続のfail-openになる可能性があった。 | `3bd802e`で`APP_ENV=local`を必須化し、E2E runnerも環境値を明示注入。 | 解消。Critical / High 0件。 |
| T009-M-001 | Medium | access tokenをlocalStorageへ保存しているため、XSS時のtoken窃取リスクとrefresh/logout未実装が残る。 | `f4b3d0a`でAPI clientへ現在のAuth sessionを直接注入。保存は再読み込み互換のため残し、refresh/logoutは認証強化タスクへ繰り越す。 | T-009非ブロッカー。後続の認証強化で対応。 |
| T009-M-002 | Medium | この環境ではstaging Supabaseの実ユーザー・実デプロイ先へ接続できず、staging E2Eそのものは未実行。 | `52f43fe`で専用資格情報をsecretから注入し、未設定時はテストを失敗させる。 | T-009非ブロッカー。staging実行証跡をT-010/T-011で取得する。 |
| T009-M-003 | Medium | stagingの実デプロイadapterは既存workflowの環境依存範囲で、workflow上は配置処理がplaceholderのまま。 | 修正なし。実デプロイadapterは環境固有のT-010/T-011対象。 | T-009非ブロッカー。staging証跡取得時に再確認する。 |

## 検証結果

- `pnpm lint`: 成功
- `pnpm typecheck`: 成功
- `pnpm test`: 成功
- `pnpm test:unit`: 成功
- `pnpm test:integration`: 実PostgreSQL 4件成功
- `pnpm build`: 成功
- `pnpm verify:production-bundle`: 12ファイル検査成功
- `pnpm test:e2e:local`: 5件成功（health、T-008 UI 3件、管理者ログイン登録1件）
- `pnpm lint:workflows`: 成功

## 再レビュー判定

T009-H-001の修正後、Critical 0件 / High 0件。localの認証から実API部員登録までを確認できたため、T-009実装と敵対的レビューはクリアとする。Mediumはstaging実接続・実デプロイadapter・refresh/logoutの後続証跡として残し、Draft PRを`develop`宛てに作成する。
