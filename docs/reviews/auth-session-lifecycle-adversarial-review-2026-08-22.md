# Auth session lifecycle敵対的レビュー

## 対象

- 対象機能：`FS-AUTH-001`の期限切れ、T-009の`T009-M-001`、`T010-M-003`
- 対象ブランチ：`feature/auth-session-lifecycle`
- 対象実装：`auth-client.ts`、`auth-context.tsx`、専用Vitest
- レビュー日：2026-08-22

## 確認観点

| 観点 | 確認結果 |
| --- | --- |
| refresh競合 | 同一refresh tokenに対する進行中Promiseを共有し、refreshを一度だけ実行する。 |
| 401再試行 | access tokenを一度だけrefreshし、成功時だけ元の要求を一度再送する。 |
| 期限前更新 | `expires_at`の60秒前に更新を開始し、更新後にタイマーを張り直す。 |
| 古い応答 | logoutまたは再ログイン後の古いrefresh応答をsessionへ適用しない。 |
| logout | リモート呼び出し前にReact state、保存領域、タイマーを消去する。 |
| 個人情報と秘密 | password、access token、refresh tokenをログ、画面、Authエラー本文へ出さない。 |
| Supabase境界 | Auth clientは公開anon keyだけを使い、Service Role Keyとtest-only adapterを参照しない。 |
| テナントと認可 | API、DB、チーム選択のコードを変更せず、既存の認可責務を移動していない。 |
| 入力と状態 | refresh応答のaccess tokenを検証し、refresh失敗時はsessionを消去して再ログインを要求する。 |

## 指摘

| ID | 重大度 | 指摘 | 対応 | 判定 |
| --- | --- | --- | --- | --- |
| AUTH-SESSION-H-001 | High | refresh失敗後に古いaccess tokenを保存領域または画面へ残すと、期限切れsessionを利用し続ける可能性がある。 | refresh失敗、401時のrefresh不能、明示logoutで3つの保存キーとReact stateを消去する。 | 解消 |
| AUTH-SESSION-H-002 | High | 同時401が別々のrefreshを送ると、Supabaseのrefresh token rotationで片方が失敗し、正しいsessionも消去する可能性がある。 | `refreshInFlight`でPromiseを共有し、古いaccess tokenを条件に結果を適用する。 | 解消 |
| AUTH-SESSION-H-003 | High | Auth providerの応答本文や通信例外をそのまま画面へ出すと、tokenや内部情報が漏れる可能性がある。 | Auth clientとAuth providerで固定メッセージへ変換し、応答本文と例外本文を表示しない。 | 解消 |
| AUTH-SESSION-M-001 | Medium | `localStorage`保存はXSS時にtokenを読み取れるリスクを残す。 | 現行API clientとの互換性を保つため今回の範囲では維持し、BFFとHttpOnly cookieへの移行条件を統合ドキュメントへ記録した。 | 継続 |
| AUTH-SESSION-M-002 | Medium | `authenticatedFetch`を中央Web mountと既存feature APIへ接続するまで、401時の自動refresh保証が全画面へ及ばない。 | 中央mountでの接続条件を記録した。今回の書き込み範囲外のため後続統合で対応する。 | 継続 |
| AUTH-SESSION-M-003 | Medium | 実Supabaseのstaging E2Eは、このローカル検証だけでは証明できない。 | 専用ユーザーとstaging環境での確認項目を記録した。 | 継続 |
| AUTH-SESSION-M-004 | Medium | 明示logoutをAuthenticated画面の操作へ接続するには中央Web mountの変更が必要である。 | `useAuth().logout`を公開し、接続条件として記録した。今回の範囲ではmountを変更しない。 | 継続 |

## 再現テスト

専用テストは次の9項目を実行する。

- password grantのsession変換
- refresh grantのtoken rotation
- access tokenだけを使うlogout
- Auth providerエラー本文の秘匿
- 期限前refreshとBearer更新
- 同時401のrefresh単一化と一回再送
- refresh失敗時の保存領域消去
- リモートlogout失敗時の先行消去
- Auth providerへの通信例外の秘匿

`pnpm test:unit`は専用Vitest 9件を含む17件が成功した。

`pnpm exec biome check apps/web/src/auth-client.ts apps/web/src/auth-context.tsx apps/web/src/auth-client.vitest.ts`は成功した。

`pnpm exec tsc -p apps/web/tsconfig.json --noEmit`は成功した。

`pnpm --dir apps/web exec vite build`は成功した。

## 判定

Critical 0件、High 0件と判定する。

Mediumは中央Web mount、storage方式、staging実接続の後続作業として残す。
