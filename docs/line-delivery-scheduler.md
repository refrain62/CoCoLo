# LINE配信schedulerの運用

## 適用範囲

この文書は、外部schedulerからLINE配信workerを起動する運用契約を定めます。

対象は実行可能worker module、release成果物、業務transactionからのenqueue、outbox claim、lease付き状態遷移、最大処理件数、失敗時の再実行です。

GitHubの定期E2E Workflowも変更せず、LINE配信schedulerを起動する経路へ使用しません。

## 実行経路

外部schedulerは、次のコマンドを一定間隔で起動します。

```text
pnpm line:schedule
```

コマンドは、次の順に処理します。

1. `APP_ENV`、workerのmodule、worker専用DB接続先、LINE送信設定、件数、再実行設定を検証する。
2. outboxを短時間transaction内で一件claimし、`attempt_token`とlease期限を保存する。
3. transactionを終了してから通知単位のprovider冪等キー付きで外部LINE APIへ送信し、同じtokenを条件に送信済みまたは再試行へ確定する。
4. workerの結果を秘密情報・通知本文を含まないJSONで標準出力へ出し、終了コードを返す。

claimは`FOR UPDATE SKIP LOCKED`で一件だけ取得し、外部送信中にDB transactionを保持しません。
lease切れのclaimは再取得できますが、古いworkerの状態更新は`attempt_token`不一致で`stale`として無視します。

## 必須環境値

外部schedulerは、次の環境値を毎回設定します。

| 環境値 | 契約 |
| --- | --- |
| `APP_ENV` | `staging`または`production`。`local`は実行拒否 |
| `LINE_DELIVERY_WORKER_DATABASE_URL` | `line_delivery_worker`専用のclaim transaction接続URL。APIの`DATABASE_URL`は注入しない |
| `LINE_DELIVERY_DB_ALLOWLIST` | staging/productionごとのDB host・DB名・`line_delivery_worker` roleを含むJSON。環境間のhost+DB名重複は拒否 |
| `LINE_CHANNEL_ACCESS_TOKEN` | stagingまたはproduction専用のLINE channel access token |
| `LINE_DELIVERY_TRANSPORT` | `real`だけを許可 |
| `LINE_DELIVERY_WORKER_MODULE` | `./line-delivery-worker.js`など、`dist`配下の相対`.js` module |
| `LINE_DELIVERY_BATCH_SIZE` | `1`から`100`までの整数 |
| `LINE_DELIVERY_SCHEDULER_MAX_ATTEMPTS` | scheduler自身の最大試行回数。`1`から`5`まで |
| `LINE_DELIVERY_SCHEDULER_ATTEMPT` | 現在の試行番号。`1`から最大試行回数まで |
| `LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS` | 再実行間隔の基準秒数。`1`から`3600`まで |
| `LINE_DELIVERY_NOTIFICATION_MAX_ATTEMPTS` | 通知単位の最大試行回数。`1`から`5`まで |
| `LINE_DELIVERY_SEND_TIMEOUT_MS` | LINE送信timeout。`1`から`120000`まで |
| `LINE_DELIVERY_LEASE_MS` | claim lease。送信timeoutの2倍以上、600000以下 |

必須値が一つでも欠ける場合、schedulerはworkerとDB接続を起動せず、終了コード`2`を返します。

エラー出力へDB URL、channel access token、workerの例外本文を含めません。

`LINE_DELIVERY_DB_ALLOWLIST`は選択した`APP_ENV`のhost・DB名・roleと完全一致しなければ実行を拒否します。
stagingとproductionのhost+DB名が重複するallowlistも拒否し、同一DB競合を設定段階で防ぎます。

## localの扱い

`APP_ENV=local`のscheduler起動は常に拒否します。

この拒否は、channel access tokenの有無やworker moduleの内容を確認する前に実行されます。

したがって、localから実LINEへ送信する経路はscheduler adapterに存在しません。

localの単体テストでは、schedulerのworker依存へfake実装を注入します。

localの環境ファイルへ実LINEのtokenを配置せず、stagingやproductionのsecretを共有しません。

## 最大処理件数

`LINE_DELIVERY_BATCH_SIZE`を一回のworker実行へ渡す最大件数として扱います。

release成果物のworkerは同じ環境値を受け取り、outboxのclaim・送信・確定を一件ずつ限定件数で処理します。

schedulerはこの値を実行中に書き換えず、設定値を検証してからworkerへ渡します。

同じDBを使う複数のworkerが起動しても、claim transactionを完了できた一つだけが通知を処理します。

## 失敗と再実行

providerから明確な失敗応答を得た通知は、`failed`、試行回数、DB時刻基準の再試行時刻、失敗コードを保存します。

timeout、scheduler Abort、または2xx応答なのにprovider IDが欠落した場合は外部副作用を取り消せないため、`unknown`（照合待ち）へ遷移します。`unknown`は自動claimせず、providerへ通知単位の冪等キーで照合してから運用者が確定します。

この場合、schedulerの実行自体は`completed`として扱い、同じ起動内で即時再送しません。

workerまたはDB lockが例外を返した場合、schedulerは実行失敗として終了コード`1`を返します。

外部schedulerは同じ環境設定で`LINE_DELIVERY_SCHEDULER_ATTEMPT`だけを増やして再実行します。

再実行間隔は次の式で決まり、最大1時間で打ち切ります。

```text
min(LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS * 2 ^ (attempt - 1), 3600秒)
```

最大試行回数に達した失敗は`retryable=false`となるため、自動再実行を止めて運用者がDB状態とLINE providerの障害状況を確認します。

送信timeoutまたはabort時はAbortSignalを実際にabortし、`unknown`へ遷移させて再claimを止めます。
送信済み確定と失敗・unknown確定はtenant・通知ID・attempt token・lease期限を条件に行い、古いworkerは状態を変更できません。

この配信経路はat-least-once契約であり、schedulerの再実行だけで重複送信を解消できるとは扱いません。

## 終了コード

| 終了コード | 結果 | 運用判断 |
| --- | --- | --- |
| `0` | `completed` | 通常の次回周期を待つ |
| `1` | worker、DB claim、外部送信の実行失敗 | attemptを増やして契約回数まで再実行する |
| `2` | 環境値、module、設定の検証失敗 | 設定を修正してから新しい実行として起動する |

## 配置時の確認

- `APP_ENV`が対象環境と一致している。
- `LINE_DELIVERY_WORKER_DATABASE_URL`のhost・DB名・roleが`APP_ENV`のallowlistと一致し、環境間allowlistが重複していない。
- `LINE_DELIVERY_TRANSPORT`が`real`である。
- worker接続の`current_user`が`line_delivery_worker`で、`BYPASSRLS=false`である。`cocolo_app`にはclaim/markとoutbox直接操作のGRANTを与えない。
- `LINE_DELIVERY_BATCH_SIZE`が想定する処理量に収まっている。
- `LINE_DELIVERY_SEND_TIMEOUT_MS`とleaseが有限で、leaseがtimeoutの2倍以上である。
- 実行ログへtoken、DB URL、LINE本文、providerのレスポンス本文を出していない。
- schedulerの標準出力に出るJSONと終了コードだけを監視へ渡している。

業務transactionは`@cocolo/db`の`enqueueLineDelivery`を同一transaction clientから呼び、membership行を`FOR UPDATE`でロックしてactive確認とoutbox登録を原子化します。release成果物は`apps/api/dist/line-delivery-worker.js`の存在を梱包前に検証します。

変更対象はscheduler adapter、実行可能worker、outbox enqueue/claim/状態遷移、専用DB role、実PostgreSQL統合テスト、release成果物、運用文書です。
