# T-008 部員一覧・登録UI 敵対的レビュー

## 対象

- 対象機能: FS-MEM-001 部員一覧、FS-MEM-002 部員登録、FS-MEM-004 学年表示
- 対象実装: `298e1eb..3b058e1`
- レビュー日: 2026-08-22
- レビュー方式: 実装差分、API契約、Red/Greenテスト、実PostgreSQL統合テスト、ローカルE2E、本番bundle検査の確認

## 観点別確認

| 観点 | 確認結果 |
| --- | --- |
| テナント越境 | UIの入力・一覧表示・登録bodyに`tenantId`を持たせていない。APIはJWTの所属membershipからtenantを解決し、API側のunit/integration testで別tenant非混入を確認済み。 |
| 認証・認可 | API clientはBearer tokenを付与し、token未設定時は401として扱う。登録APIの403を画面上の権限エラーとして表示する。認可の最終判断はUIではなくT-007 APIに残している。 |
| 個人情報 | UIの公開型とtable表示に電話番号、保護者識別子、特記事項を含めない。悪意ある追加フィールドを含むmock responseでも電話番号とnoteが表示されないE2Eを確認済み。 |
| 入力検証 | 氏名の空文字、studentの学年必須・1〜16、adultの年代必須を画面で検証する。`tenantId`と`note`は送信しない。API側のstrict Zod契約でも再検証する。 |
| 状態遷移 | T-008の対象は一覧と登録。登録中の二重送信をbutton disableで抑止し、loading、空データ、通信エラー、403、登録成功を区別して表示する。編集・退部はFS-MEM-003の後続範囲。 |
| 環境混同 | `VITE_APP_ENV`を表示し、production buildで未設定の場合に`local`と誤表示しない。test-only AuthとService Role Keyの本番bundle混入検査も成功。 |
| アクセシビリティ | label、見出し、table caption、status/alert role、キーボード送信可能なformを実装し、状態を色だけで伝えない。 |

## 指摘と判定

| ID | 重大度 | 指摘 | 対応・修正コミット | 再レビュー判定 |
| --- | --- | --- | --- | --- |
| T008-M-001 | Medium | 現在の既定token providerはT-008の仮接続として`localStorage`を読む。Supabase Authのsession更新・実ログインとの接続は未実装。 | 修正なし。T-009でSupabase Auth adapterへ置換・接続する前提を実装計画に残す。 | T-008単体では非ブロッカー。T-009完了条件へ繰り越し。 |
| T008-M-002 | Medium | E2EはAPI responseをroute mockしており、staging Supabaseの実ログインから登録までを検証していない。 | 修正なし。T-009のstaging E2Eで実ユーザー・実APIを検証する。 | T-008単体では非ブロッカー。T-009完了条件へ繰り越し。 |
| T008-M-003 | Medium | 部員登録の冪等性やAPI responseのruntime schema検証はT-008 UIの範囲外で、T-007 APIおよび後続の共通API強化に残る。 | UIでは登録中の二重送信を抑止。APIの冪等性・response検証は別タスクとして扱う。 | Critical / Highに該当せず、T-008はクリア。 |

## 検証結果

- `pnpm lint`: 成功
- `pnpm typecheck`: 成功
- `pnpm test`: 成功
- `pnpm test:unit`: 成功
- `pnpm test:integration`: 実PostgreSQL 3件成功
- `pnpm build`: 成功
- `pnpm test:e2e:local`: 4件成功
- `pnpm verify:production-bundle`: 12ファイル検査成功

## 再レビュー判定

Critical 0件、High 0件。T-008の実装・検証・敵対的レビューはクリアとし、Draft PRを`develop`宛てに作成してT-009へ進める。
