# 共通API強化の接続契約

この文書は、共通API強化機能を中央APIへ接続するときの境界を定める。

実装は `apps/api/src/security/` と `packages/contracts/src/` に分離している。
この機能ブランチでは中央統合を行わないため、`apps/api/src/app.ts` と `apps/api/src/main.ts` は変更していない。

## 接続順序

中央APIでは次の順序でmiddlewareを登録する。

1. `createRequestLoggerMiddleware` を最外周に登録する。
2. `createCorsMiddleware` を認証middlewareより前に登録する。
3. 認証middlewareでBearer JWTを検証し、active membershipからtenantIdとuserIdを解決する。
4. `createRateLimitMiddleware` を認証済みrouteへ登録し、`{ kind: 'user', tenantId, userId }`をkey resolverから返す。
5. `createResponseContractMiddleware` をrouteの前に登録し、各公開JSON routeのmethod、path、status、Zod schemaを登録する。

CORSのallowlistは環境変数から読み込むが、空値、`*`、path付きURL、認証情報付きURLは起動時に拒否する。
Bearer認証を使うため、`Access-Control-Allow-Credentials`は返さない。
認証前のCORS検査で不許可origin、preflight method、preflight headerを拒否する。

## レート制限

初期値は実装計画の契約に合わせる。

- 認証済み利用者：毎分60件
- アップロードセッション発行：毎分10件

rate limitのkeyはtenantとuserの組を必須とする。
未認証経路では、信頼できるgatewayのclientIdと接続元IPの組を使う。
IPだけをkeyにするresolverは作成しない。

`InMemoryRateLimitStore`はlocalと単一プロセスの検証用である。
容量上限に達した場合は新しいkeyを成功扱いにせず503で停止する。
stagingとproductionではRedis、Cloudflare Durable Objectsなど、複数instanceから原子的にconsumeできるstoreへ差し替える。
store障害、identity欠落、key生成失敗は成功扱いにせず、503で停止する。
上限超過は429と`Retry-After`を返す。

## 構造化ログ

ログはJSON Linesとして次の固定項目だけを出力する。

- `timestamp`
- `level`
- `event`
- `service`
- `environment`
- `requestId`
- `method`
- `path`
- `status`
- `durationMs`
- `errorCode`（必要な場合だけ）

Authorization、Cookie、JWT、secret、リクエスト本文、クエリ、IP、氏名、kana、電話番号、tenantId、userIdをログへ出さない。
中央APIはrequest loggerへroute template resolverを渡し、生のURL pathnameをログへ渡さない。
resolver未指定時は未解決routeを示す固定値だけを記録する。
schema検証に失敗したentryは出力せず、sink障害もリクエスト成功へ影響させない。

## 公開レスポンス検証

公開JSON routeには必ずmethod、path正規表現、HTTP status、Zod schemaを登録する。
未登録の `/api/v1` 成功レスポンス、JSON解析失敗、schema不一致は、元の本文を返さずrequestId付き500へ置換する。
4xxと5xxは共通のerror response schemaで検証する。
CSVなどJSON以外の公開形式は別の契約と検証器を追加してから公開する。

Phase 2以降の機能を中央統合するときは、各機能の公開項目をこのregistryへ追加する。
DBモデルや内部例外をそのままresponse schemaへ指定しない。
