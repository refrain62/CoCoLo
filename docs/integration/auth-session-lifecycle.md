# Supabase Authセッションの寿命管理

## 対象と前提

この文書は、`FS-AUTH-001`の期限切れ対応と、T-009敵対的レビューの`T009-M-001`で残ったrefresh/logoutを定義する。

対象実装は`apps/web/src/auth-client.ts`と`apps/web/src/auth-context.tsx`であり、APIのJWT検証、チーム選択、中央Web mountは変更しない。

`local`と`test`ではDocker上のSupabase Authへ接続し、`staging`と`production`では`VITE_SUPABASE_URL`と`VITE_SUPABASE_ANON_KEY`だけをブラウザへ渡す。

Service Role Key、test-only固定token、test-onlyパスワードはWebの実行時設定とproduction bundleへ渡さない。

## セッションの保存

ログイン成功時はSupabaseが返す`access_token`、`refresh_token`、`expires_at`を`AuthSession`へ変換する。

本番のブラウザ実行ではtokenを`localStorage`や`sessionStorage`へ保存せず、AuthSessionをメモリだけで保持する。XSSで永続領域からtokenを抜き取れる経路を作らないためである。`createAuthSessionManager`の`storage`引数は、保存処理の単体テストまたは明示的に安全性を確認したadapterを注入する場合だけ使用する。

| キー | 内容 | 取り扱い |
| --- | --- | --- |
| `cocolo.accessToken` | APIへ送る短期access token | 明示注入したテスト用storageだけで扱い、画面、ログ、例外へ出さない |
| `cocolo.refreshToken` | Supabase Authへ返すrefresh token | 明示注入したテスト用storageだけで扱い、URLへ置かずAuth APIのrequest bodyだけで使う |
| `cocolo.expiresAt` | Unix epoch秒の有効期限 | 明示注入したテスト用storageだけで扱い、期限前更新の判定にだけ使う |

パスワードはpassword grantのrequest bodyへ渡した後に保持しない。

Auth providerのエラー本文は認証情報を含む可能性があるため、固定された利用者向けメッセージへ変換する。

## 更新の動作

`AuthSessionManager`は有効期限の60秒前を更新開始の基準とする。

期限情報がない旧形式のsessionは互換のため復元するが、期限前更新は行わず、APIが`401`を返した時にrefreshを試みる。

同じrefresh tokenによる更新が同時に発生した場合は、進行中のPromiseを共有してSupabaseへのrefreshを一度だけ送る。

更新中にlogoutまたは再ログインが完了した場合、古いrefreshの応答で新しいsessionを復活させない。

## 401時の再試行

中央Web mountは、API clientへ`useAuth().authenticatedFetch`を渡して認証付き要求を送る。

要求前に期限が近ければ一度refreshし、要求が`401`になった場合も一度だけrefreshして新しいaccess tokenで同じ要求を再送する。

refreshが失敗した場合は元の`401`を返し、sessionと保存済みtokenを消去して再ログイン要求を通知する。

bodyが再利用できない`ReadableStream`の要求は、refresh後に再送せず元の`401`を返す。

`authenticatedFetch`を使わず、保存領域からaccess tokenを直接読むAPI clientは、期限前refreshの反映は受け取れるが、401時の自動refreshと一回再送の保証を持たない。

## logoutの動作

明示logoutは、リモートAPIを呼ぶ前にReact state、更新タイマー、明示注入されたstorageの値を消去する。

リモートlogoutにはaccess tokenだけを`Authorization: Bearer`で渡し、refresh tokenは送らない。

リモートlogoutが失敗しても画面上のsessionは残さず、利用者へは固定された一般エラーだけを表示する。

## 中央Web mountへの接続条件

中央mountの実装では、認証済みAPI clientが次の条件を満たす必要がある。

1. `useAuth().authenticatedFetch`を全認証付きAPI要求の入口にする。
2. `session.accessToken`を直接読み、要求ごとに独自のrefresh処理を実装しない。
3. `logout`を利用者が明示的に実行できる操作へ接続する。
4. `requiresReauthentication`が`true`になった場合は、保護画面を再ログイン導線へ遷移させる。
5. チームID、権限、個人情報の判定は引き続きAPIとDBの認可へ任せる。

今回の変更では`apps/web/src/main.tsx`と既存featureのAPI clientを変更していない。

## 環境境界

local/testのAuth fixtureはloopbackの `cocolo-local` / `cocolo-test` projectだけを受け付ける。固定tokenを返すtest-only Auth adapterはE2Eの起動経路で使用しない。

`staging`と`production`のAuth endpointは`VITE_SUPABASE_URL`から組み立て、公開anon key以外の秘密値を入力として受け付けない。

refresh tokenの実値を含むfixtureはリポジトリへ追加せず、テストでは固定されたダミー値だけを使う。

## 検証

専用テストはpassword grant、refresh grant、logout、認証エラーの秘匿、期限前refresh、同時401、refresh失敗、logout失敗を確認する。

`pnpm exec vitest run apps/web/src/auth-client.vitest.ts`で8件が成功する。

`pnpm exec tsc -p apps/web/tsconfig.json --noEmit`と`pnpm --dir apps/web exec vite build`でWebの型検査とproduction buildを確認する。

## 残るMedium

メモリ保持へ変更したため、ブラウザ再読み込み時は再ログインが必要になる。永続sessionが必要になった場合は、ブラウザへtokenを置くのではなく、BFFとHttpOnly Secure SameSite cookieの採用を別設計・別レビューで検討する。

中央Web mountが未接続の間は、既存API clientの401要求を自動refreshできないため、接続完了をこの機能の運用開始条件とする。

実Supabaseを使うstaging E2Eは、専用ユーザー、環境変数、デプロイ先が揃った環境でログイン、期限切れ、refresh失敗、logoutを確認する。
