# OAuthセキュリティ契約

WebのLINE・GoogleログインはSupabase AuthのAuthorization Code + PKCEで実行します。

- redirect URIは各環境の`/auth/callback`だけをallow listへ登録する。
- Webは`state`、`nonce`、PKCE verifier/challengeを生成し、callbackではstateと有効期限を検証する。
- Supabase AuthはproviderのID tokenに対するnonce検証を有効化する。Google・LINEのprovider設定でnonce検証を無効化してはならない（`skip_nonce_check=false`）。PKCE callbackは`code`と`state`を返し、providerのnonce検証はcode exchange側で完了するため、Web callbackのnonce query欠落は許可する。
- 招待画面では、招待tokenのSHA-256をOAuth transactionへ束縛し、code exchange成功後に現在の招待tokenと一致した場合だけ受諾APIを呼ぶ。
- OAuth transactionはtab単位のsessionStorageへ10分だけ保存し、callback開始時に一度だけ消費する。access token、refresh token、旧implicit flowのhashは受け付けず、callback URLから除去する。

この契約を満たせない環境はOAuthを有効化せず、staging受入でprovider設定とredirect allow listを確認する。
