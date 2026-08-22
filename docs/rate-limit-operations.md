# 分散レート制限の運用契約

この文書は、CoCoLo API のレート制限を local、staging、production で運用するための設定、adapter 契約、障害対応を定めます。

通常の制限値は認証済み利用者あたり毎分60リクエストとし、アップロードセッション発行は毎分10リクエストとします。

制限超過は `429` と `Retry-After` を返し、制限を計算できない場合は `503` を返して後続処理を実行しません。

## 環境ごとの保存先

| 環境 | `RATE_LIMIT_STORE` | 実装 | 設定上の扱い |
| --- | --- | --- | --- |
| `local` | `memory` | `InMemoryRateLimitStore` | 開発と単体テスト専用 |
| `staging` | `distributed` | 配置先が提供する分散 adapter | adapter 未設定時は起動を停止 |
| `production` | `distributed` | 配置先が提供する分散 adapter | adapter 未設定時は起動を停止 |

`local` で分散 adapter を指定する構成は拒否します。

`staging` と `production` で `memory` を指定する構成は拒否します。

`RATE_LIMIT_FAIL_CLOSED` は全環境で `true` に固定します。

環境変数の検証は API 起動時と `pnpm verify:environment` の両方で実行します。

## 設定値

| 変数 | `local` | `staging` と `production` | 秘密情報 |
| --- | --- | --- | --- |
| `RATE_LIMIT_STORE` | `memory` | `distributed` | いいえ |
| `RATE_LIMIT_FAIL_CLOSED` | `true` | `true` | いいえ |
| `RATE_LIMIT_ADAPTER_MODULE` | 未設定 | `createRateLimitAdapter` を公開するNode module | いいえ |
| Redis接続URLなどprovider固有値 | 未設定 | 配置先のSecret | はい |

このrepositoryには実Redis providerを同梱していません。

そのため、adapter packageのallowlistは空であり、stagingとproductionの `RATE_LIMIT_ADAPTER_MODULE` は未設定のままです。
moduleを設定して起動を継続するには、provider packageをlockfileへ追加し、ソースのallowlistへ同じpackage名を登録してから、契約テストを通過させる必要があります。
未設定またはallowlistとlockfileのどちらかにないmoduleは、API起動と `pnpm verify:environment` の両方で拒否します。

`RATE_LIMIT_ADAPTER_MODULE` はGitHub EnvironmentのVariableまたは配置先の非秘密設定で管理します。
ただし、provider未同梱の現在は設定してはいけません。

Redis接続URL、認証情報、TLS秘密鍵は adapter が参照する Secret として管理し、リポジトリ、成果物、ログへ出力しません。

## adapter 契約

配置先の module は `createRateLimitAdapter` という名前付きexportを一つ公開します。

factory は次の `consumeAtomic` 契約を満たすオブジェクトを返します。

```ts
type RateLimitConsumeInput = {
  key: string;
  limit: number;
  windowMs: number;
  nowMs: number;
};

type RateLimitConsumeResult = {
  allowed: boolean;
  remaining: number;
  resetAtMs: number;
};

type RateLimitConsumeContext = {
  signal: AbortSignal;
  timeoutMs: number;
};

type DistributedRateLimitAdapter = {
  consumeAtomic: (
    input: RateLimitConsumeInput,
    context: RateLimitConsumeContext,
  ) => Promise<RateLimitConsumeResult>;
};

type RateLimitStore = {
  distributed: boolean;
  consume: (
    input: RateLimitConsumeInput,
    options?: {
      signal?: AbortSignal;
      timeoutMs?: number;
    },
  ) => Promise<RateLimitConsumeResult> | RateLimitConsumeResult;
};

type CentralRateLimitStore = RateLimitStore & {
  distributed: true;
  adapter: DistributedRateLimitAdapter;
  namespace: 'local' | 'staging' | 'production';
};

export async function createRateLimitAdapter(): Promise<DistributedRateLimitAdapter> {
  return {
    async consumeAtomic(input, context) {
      return executeAtomicRateLimitOperation(input, context);
    },
  };
}
```

`consumeAtomic` はカウンターの加算、初回だけの有効期限設定、現在値の読み取りを分散ストア上の一つの原子的操作として実行します。

APIは各呼び出しに正の有限値である `timeoutMs` と派生した `AbortSignal` を付けます。
外部storeがsignalを無視しても、timeoutでadapter呼び出しを打ち切り、middlewareは `503 RATE_LIMIT_UNAVAILABLE` を返します。
リクエストの中断も同じsignalへ伝播させます。

中央統合側へ渡す分散storeは `distributed: true`、注入済みの `adapter`、`APP_ENV` 由来の `namespace` を公開します。
stagingとproductionでは、このstoreを生成するためのadapterがなければ構成生成を拒否します。

Redis を使う場合は `INCR` と初回の `PEXPIRE` を Lua `EVAL` または同等のサーバー側スクリプトへまとめます。

`MULTI/EXEC` だけで実装する場合は、初回判定と有効期限設定を別クライアントから割り込まれないことを provider の仕様とテストで確認します。

adapter は入力 `key` をそのままストレージキーとして使い、利用者の tenant ID、user ID、IPアドレスを再構成してはいけません。

adapterが受け取るキーは `user:<APP_ENV>:<sha256>:<sha256>` または `client:<APP_ENV>:<sha256>:<sha256>` の形式に限ります。
`APP_ENV=staging` と `APP_ENV=production` は異なるnamespaceを使うため、同じtenantとuserでもカウンターを共有しません。

API 側の adapter wrapper はこの形式以外のキーを外部ストアへ渡しません。

## moduleの読み込み制限

`RATE_LIMIT_ADAPTER_MODULE` にはpackage名だけを指定します。
`file:`, `data:`, `node:`, `http:`, `https:`, 相対パス、絶対パス、package subpathは拒否します。

APIは指定名を、明示allowlistと `pnpm-lock.yaml` に記録されたpackage名へ照合してから動的importします。
allowlistが空の状態では、実providerを含まないため、どのmodule指定も起動を通過しません。
この検証を環境変数だけで上書きする設定は提供しません。

### Redis Lua の実装条件

Redis adapter は次の条件を満たすスクリプトを使用します。

- `KEYS[1]` へ `INCR` を一度だけ実行する。
- 加算結果が1の場合だけ `PEXPIRE` を `windowMs` で設定する。
- 加算値、残数、キーのTTLから `allowed`、`remaining`、`resetAtMs` を返す。
- `limit`、`windowMs`、TTLが不正な場合は成功結果を返さずエラーにする。
- Redis の接続先やスクリプトエラーを握りつぶさない。

同じキーを複数の API instance が同時に消費しても、`allowed` の判定に使う加算値が重複しないことを統合テストで確認します。

## 個人情報の境界

API は tenant ID と user ID の組を SHA-256 でハッシュ化してから外部 adapter へ渡します。

rate-limit の保存キー、Redis のメトリクスラベル、構造化ログ、障害通知へ tenant ID、user ID、氏名、メールアドレス、IPアドレスを記録しません。

ハッシュ化は匿名化の完全な保証ではないため、ハッシュ値を利用者向けレスポンスへ返したり、別用途の識別子として再利用したりしません。

tenant と user の組を一つのハッシュ値へまとめるため、同じ user ID が別 tenant で使われてもカウンターは共有されません。

## 失敗時の挙動

API 起動時に `RATE_LIMIT_STORE`、`RATE_LIMIT_FAIL_CLOSED`、`RATE_LIMIT_ADAPTER_MODULE` の組み合わせが環境条件と一致しない場合、サーバーは起動しません。

起動後に分散ストアが利用できない場合、rate-limit middleware は `503 RATE_LIMIT_UNAVAILABLE` を返し、認証後の業務 handler を呼び出しません。

分散ストアが応答しない場合も、consumeのtimeoutで `503 RATE_LIMIT_UNAVAILABLE` に収束し、業務handlerを呼び出しません。

identity の解決に失敗した場合も `503 RATE_LIMIT_IDENTITY_UNAVAILABLE` を返し、IPアドレスだけへフォールバックしません。

分散ストア障害時に `InMemoryRateLimitStore` へ自動切り替えしたり、レート制限を無効化したりする運用手順は採用しません。

## 配置と分離

staging と production は分散ストア、認証情報、ネットワーク許可、監視を分離します。

production が staging の Redis endpoint または Secret を参照しないことを配置前に確認します。

adapter module の変更は API の成果物と同じレビュー対象にし、Node.js 24 で契約テストを実行してから配置します。

実Redis provider、Redis Luaの原子性、複数API instanceからの同時消費、実ネットワーク障害からの503収束は、このrepositoryでは未検証です。
staging配置時にprovider固有の契約テストと実Redis接続を実施し、成功するまでproductionへ昇格できません。

staging では複数 API instance から同一利用者が同時にリクエストを送り、制限値を超えるリクエストが業務処理へ到達しないことを確認します。

production では health check の成功だけで復旧と判断せず、adapter の接続、原子性、キー形式、`503` の停止条件を確認します。

## 障害対応

1. `APP_ENV`、`RATE_LIMIT_STORE`、`RATE_LIMIT_FAIL_CLOSED`、`RATE_LIMIT_ADAPTER_MODULE` の実行時値を確認します。
2. adapter module の読み込み結果と provider の認証、TLS、ネットワーク許可を確認します。
3. Redis の接続先が対象環境のものであり、staging と production の Secret を共有していないことを確認します。
4. Redis のキー一覧、監視ラベル、ログに生の tenant ID、user ID、IPアドレスがないことを確認します。
5. 一時的な fail-open、in-memory への切り替え、制限 middleware の除去を行わず、利用者へ再試行を案内します。
6. 復旧後に二つ以上の API instance を使った同時消費、窓の更新、制限超過、adapter 障害時の `503` を staging で再検証します。

障害調査で取得したキーやログは、ハッシュ値を含めて通常の運用記録へ転載しません。

## 検証項目

次のテストを変更時の完了条件とします。

- tenant と user の生値が外部 adapter の入力、ストレージキー、ログへ現れない。
- local は in-memory の固定窓を使い、staging と production は分散 adapter なしで構成できない。
- `consumeAtomic` の結果が同一キーの同時リクエストで重複せず、超過分が `429` になる。
- 分散ストアのエラーと不正な応答が `503` に収束し、業務 handler が呼ばれない。
- 分散ストアのtimeoutとAbortSignal中断が `503` に収束し、業務 handler が呼ばれない。
- `APP_ENV` のnamespaceがキーへ含まれ、stagingとproductionのキーを同じstoreで共有しない。
- API 起動時と `pnpm verify:environment` が fail-open、memory、adapter module 欠落を拒否する。
- adapter moduleがURLやfilesystem指定ではなく、allowlistとlockfileの両方にあるpackage名だけである。
