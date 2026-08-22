# 分散レート制限adapter 実装後敵対的レビュー

## 対象

- 対象ブランチ: `feature/distributed-rate-limit-adapter`
- 基準ブランチ: `origin/develop` / `5e346d1be3be4ef17e826fcd289b13cde0901350`
- レビュー日: 2026-08-23
- 対象範囲: adapter契約、環境別store選択、API接続、tenant/userキー、起動検証、Workflow、運用文書、テスト

## 観点別判定

| 観点 | 判定 | 確認内容 |
| --- | --- | --- |
| テナント越境 | 問題なし | 認証後に解決したmembershipのtenant IDとJWT user IDだけを使い、tenant/userの組を別カウンターへ分離する。 |
| 認証・認可 | 問題なし | rate-limit middlewareは認証middlewareの後に実行し、identity欠落時はIPアドレスへフォールバックせず503で停止する。 |
| 個人情報 | 問題なし | 外部adapterへ渡すキーはscopeとidentityのSHA-256値だけであり、wrapperも未ハッシュ形式を拒否する。 |
| 原子性 | 条件付き問題なし | `consumeAtomic`がカウンター加算、初回TTL設定、判定値の取得をprovider側の原子的処理として実装する契約を持ち、同一キーの同時消費テストで超過分を429へ閉じ込める。 |
| fail-closed | 問題なし | staging/productionのmemory、adapter欠落、fail-open設定を起動時と環境検証で拒否し、稼働後のstore障害は503で業務handlerへ到達させない。 |
| 入力検証 | 問題なし | adapter入力のキー形式、制限値、期間、時刻と、adapter応答の許容範囲をwrapperで検証する。 |
| テスト十分性 | 継続条件あり | 契約・同時消費・PII非露出・設定境界・API接続をテストしたが、実Redis providerの接続とLua実行は配置先adapterのstaging検証に残る。 |

## 指摘と対応

| ID | 重大度 | 攻撃シナリオ・指摘 | 対応 | 判定 |
| --- | --- | --- | --- | --- |
| DRL-H-001 | High | Honoの同一prefixへexact routeとwildcard routeを重ねてrate-limitを登録すると、1リクエストを二重消費して正当な利用者を早期に429へ到達させる可能性がある。 | wildcard middlewareだけへ統一し、認証済みmembers APIのadapter呼び出しが1リクエスト1回である回帰テストを追加した。 | 解消 |
| DRL-H-002 | High | tenant/userを区切り文字で単純連結すると、区切り文字を含む識別子の組み合わせが同じ保存キーへ衝突し、別主体の制限を共有する可能性がある。 | JSON配列で構造化したtenant/userまたはclient/IPをハッシュし、衝突回帰テストを追加した。 | 解消 |
| DRL-H-003 | High | staging/productionでadapter未設定時に既定のin-memoryへ戻ると、複数instance間で制限を共有できず、障害時に制限を回避できる。 | 非local環境ではdistributed modeとadapterを必須にし、未設定時は構成生成とAPI起動を拒否する。 | 解消 |
| DRL-H-004 | High | adapter障害やidentity解決失敗を許可扱いにすると、分散store停止中に制限対象の業務処理が通過する。 | middlewareの例外を503へ収束し、後続handlerを実行しないfail-closedテストを追加した。 | 解消 |
| DRL-H-005 | High | Redisキー、ログ、メトリクスへtenant IDやuser IDをそのまま渡すと、rate-limit用途から個人情報が漏えいする。 | API側でハッシュ済みkeyだけを生成し、adapter wrapperとキー形式テストで生値の外部流出を拒否する。 | 解消 |

Critical 0件、High 0件であり、実装差分に対するブロッカーは残っていない。

## 残存する配置条件

実Redis adapter本体は配置先の責任範囲として本リポジトリへ同梱せず、`createRateLimitAdapter`と`consumeAtomic`の契約だけを提供する。

staging配置前に、Luaまたは同等のサーバー側原子処理、初回TTL、接続障害、複数API instance同時消費、キー非PIIを実providerで検証する。

productionではstagingとRedis endpoint、Secret、ネットワーク許可を分離し、adapter module未設定時に昇格が停止するWorkflow条件を維持する。

## 確認したファイル

- `apps/api/src/security/rate-limit.ts`
- `apps/api/src/security/rate-limit-adapter.ts`
- `apps/api/src/app.ts`
- `apps/api/src/runtime-environment.ts`
- `apps/api/src/server.ts`
- `apps/api/test/rate-limit-adapter.test.ts`
- `apps/api/test/runtime-environment.test.ts`
- `scripts/verify-environment.ts`
- `.github/workflows/staging-deploy.yml`
- `.github/workflows/production-promote.yml`
- `docs/rate-limit-operations.md`

## 判定

CriticalとHighの攻撃経路は実装、テスト、設定検証で閉じられているため、本ブランチの実装レビューは合格とする。

実providerのstaging実証だけを配置時の継続条件として残す。
