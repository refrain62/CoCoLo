# LINE配信schedulerの運用

## 適用範囲

この文書は、外部schedulerからLINE配信workerを起動する運用契約を定めます。

対象はscheduler adapter、実行環境の検証、実行ロック、最大処理件数、失敗時の再実行です。

既存のoutbox、queue、workerのDB実装はこの契約の対象外です。

GitHubの定期E2E Workflowも変更せず、LINE配信schedulerを起動する経路へ使用しません。

## 実行経路

外部schedulerは、次のコマンドを一定間隔で起動します。

```text
pnpm line:schedule
```

コマンドは、次の順に処理します。

1. `APP_ENV`、workerのmodule、DB接続先、LINE送信設定、件数、再実行設定を検証する。
2. `pg_try_advisory_xact_lock`で環境ごとのscheduler lockを取得する。
3. lockを保持したtransactionが終了するまで、既存workerを一度だけ実行する。
4. workerの結果を秘密情報を含まないJSONで標準出力へ出し、終了コードを返す。

lockはtransactionに結び付くため、プロセスが異常終了するとDBが接続を閉じた時点で解放されます。

別プロセスが同じlockを保持している場合、workerを起動せずに`locked`として正常終了します。

## 必須環境値

外部schedulerは、次の環境値を毎回設定します。

| 環境値 | 契約 |
| --- | --- |
| `APP_ENV` | `staging`または`production`。`local`は実行拒否 |
| `DATABASE_URL` | scheduler lockとworkerが接続する環境専用DB URL |
| `LINE_CHANNEL_ACCESS_TOKEN` | stagingまたはproduction専用のLINE channel access token |
| `LINE_DELIVERY_TRANSPORT` | `real`だけを許可 |
| `LINE_DELIVERY_WORKER_MODULE` | `./line-delivery-worker.js`など、`dist`配下の相対`.js` module |
| `LINE_DELIVERY_BATCH_SIZE` | `1`から`100`までの整数 |
| `LINE_DELIVERY_LOCK_KEY` | 英数字、`.`, `_`, `:`, `-`による1文字以上128文字以下の識別子 |
| `LINE_DELIVERY_SCHEDULER_MAX_ATTEMPTS` | scheduler自身の最大試行回数。`1`から`5`まで |
| `LINE_DELIVERY_SCHEDULER_ATTEMPT` | 現在の試行番号。`1`から最大試行回数まで |
| `LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS` | 再実行間隔の基準秒数。`1`から`3600`まで |

必須値が一つでも欠ける場合、schedulerはworkerとDB lockを起動せず、終了コード`2`を返します。

エラー出力へDB URL、channel access token、workerの例外本文を含めません。

`LINE_DELIVERY_LOCK_KEY`には環境名を自動的に付加するため、同じ値を使ってもschedulerのlockは環境ごとに分離されます。

## localの扱い

`APP_ENV=local`のscheduler起動は常に拒否します。

この拒否は、channel access tokenの有無やworker moduleの内容を確認する前に実行されます。

したがって、localから実LINEへ送信する経路はscheduler adapterに存在しません。

localの単体テストでは、schedulerのworker依存へfake実装を注入します。

localの環境ファイルへ実LINEのtokenを配置せず、stagingやproductionのsecretを共有しません。

## 最大処理件数

`LINE_DELIVERY_BATCH_SIZE`を一回のworker実行へ渡す最大件数として扱います。

既存workerは同じ環境値を読み、outboxからqueueへの移送とqueueの配信をそれぞれ限定件数で処理します。

schedulerはこの値を実行中に書き換えず、設定値を検証してからworkerへ渡します。

同じDBを使う複数のschedulerが起動しても、lockを取得できた一つだけがこの上限で処理します。

## 失敗と再実行

通知一件のLINE送信失敗は、既存workerがqueueの`failed`、試行回数、`nextRetryAt`へ保存します。

この場合、schedulerの実行自体は`completed`として扱い、同じ起動内で即時再送しません。

workerまたはDB lockが例外を返した場合、schedulerは実行失敗として終了コード`1`を返します。

外部schedulerは、同じ`LINE_DELIVERY_LOCK_KEY`を使い、`LINE_DELIVERY_SCHEDULER_ATTEMPT`だけを増やして再実行します。

再実行間隔は次の式で決まり、最大1時間で打ち切ります。

```text
min(LINE_DELIVERY_RETRY_BASE_DELAY_SECONDS * 2 ^ (attempt - 1), 3600秒)
```

最大試行回数に達した失敗は`retryable=false`となるため、自動再実行を止めて運用者がDB状態とLINE providerの障害状況を確認します。

workerは外部送信とDBの送信済み確定を別処理で行うため、送信後にプロセスが停止すると再実行時に重複送信される可能性があります。

この配信経路はat-least-once契約であり、schedulerの再実行だけで重複送信を解消できるとは扱いません。

## 終了コード

| 終了コード | 結果 | 運用判断 |
| --- | --- | --- |
| `0` | `completed`または`locked` | 通常の次回周期を待つ |
| `1` | workerまたはDB lockの実行失敗 | attemptを増やして契約回数まで再実行する |
| `2` | 環境値、module、設定の検証失敗 | 設定を修正してから新しい実行として起動する |

`locked`を失敗として再実行すると、既に処理中のworkerと不要な起動競合を作るため、外部schedulerは終了コード`0`として扱います。

## 配置時の確認

- `APP_ENV`が対象環境と一致している。
- `DATABASE_URL`とLINE secretが別環境の値ではない。
- `LINE_DELIVERY_TRANSPORT`が`real`である。
- `LINE_DELIVERY_BATCH_SIZE`が想定する処理量に収まっている。
- 外部schedulerのタイムアウトがworkerの通常処理時間より長く、無期限ではない。
- 実行ログへtoken、DB URL、LINE本文、providerのレスポンス本文を出していない。
- schedulerの標準出力に出るJSONと終了コードだけを監視へ渡している。

変更対象はscheduler adapter、schedulerのテスト、運用文書に限定します。

outbox、workerのDB実装、GitHub定期E2E Workflowを変更した場合は、この機能の変更として扱わず、別のレビューを要求します。
