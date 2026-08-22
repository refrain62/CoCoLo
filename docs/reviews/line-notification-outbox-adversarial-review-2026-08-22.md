# LINE自動通知outboxの敵対的レビュー

## レビュー対象

対象は`feature/line-notification-outbox`のLINE自動通知outbox、中央repository接続、配信worker、Prisma schema、PostgreSQL migrationです。

予定の作成・更新、回覧の掲載、outboxからqueueへの移送、LINE外部API送信を、業務transactionと外部送信の責務境界として確認しました。

## 判定

Criticalは0件です。

Highは0件です。

実PostgreSQLへ接続していないため、migration適用後のRLS、grant、trigger、`SECURITY DEFINER`関数の実行結果は未確定です。
stagingまたはDocker PostgreSQLでの確認が完了するまで、productionで自動LINE通知を有効化してはいけません。

## 攻撃観点と確認結果

| 観点 | 確認内容 | 結果 |
| --- | --- | --- |
| tenant越境 | outboxへtenant IDを認証入力として委ねず、業務repositoryのtenantとtransaction-local RLS contextを使う | 問題なし |
| 実行者なりすまし | outbox登録関数がactive membership、event manager権限、`app.user_id`とactorの一致を再確認する | 問題なし |
| 直接表アクセス | API repositoryはoutbox表へ直接upsertせず、限定された登録関数だけを呼ぶ | 問題なし |
| 通知重複 | `tenant_id + source_type + source_id`を一意にし、pendingだけ更新する | 問題なし |
| 並列worker | outboxの移送関数とqueueのclaim関数が`FOR UPDATE SKIP LOCKED`を使い、同じ行を同時処理しない | 問題なし |
| group競合 | workerが現在のconnected groupを再解決し、queueには移送時点のgroup IDを固定する | 問題なし |
| 接続解除 | queueの外部キーと既存のgroup一致条件により、古い通知を再接続後のgroupへ転送しない | 問題なし |
| 外部障害 | 業務保存とoutbox記録を同じtransactionで確定し、LINE API送信とqueue再試行を別責務にする | 問題なし |
| 個人情報 | 通知タイトル・本文は固定文とし、provider本文、token、Webhook raw bodyをoutboxへ保存しない | 問題なし |
| 入力検証 | 公開URLはruntimeで検証済みの値を使い、deep linkのDB形式制約と生成元IDの組み立てを通す | 問題なし |
| 状態遷移 | outboxは`pending → delivered/ignored`、LINE送信の成否はqueueの`pending → sending → sent/failed`で管理する | 問題なし |
| DB分離 | Auth schema・外部secretを移行対象から分離し、outbox一意キー・通知時刻・状態・queue対応IDを移行契約へ記録する | 問題なし |

## 修正した指摘

### High: outbox upsertによるRLS SELECT権限の拡大

初期案では、API transactionから`ON CONFLICT DO UPDATE ... WHERE status = pending`を直接実行するため、既存行のstatusを読むSELECT権限が必要になる可能性がありました。

この権限を表へ追加すると、worker専用にしたいoutboxの参照境界が広がります。

APIは`app_enqueue_line_notification_outbox`だけを呼び出す方式へ変更しました。
関数内で所属、role、実行者を再確認し、表のupsertは`SECURITY DEFINER`のDB境界内で実行します。

### Medium: 締切通知時刻の暗黙的な時計

締切通知の24時間前計算が直接`new Date()`を呼ぶと、テストと業務transactionの境界で時刻を固定できません。

repositoryへ`now`関数を注入できるようにし、締切まで24時間未満の場合は保存時刻を通知時刻にする意図を日本語コメントへ残しました。

## 残る検証条件

- [ ] fresh PostgreSQLへmigrationを順番に適用し、`app_enqueue_line_notification_outbox`をactive membership、staff、別tenantで確認する。
- [ ] outboxの重複登録、pending更新、delivered後の不変性を確認する。
- [ ] 2 worker同時起動でoutboxとqueueが二重作成されないことを確認する。
- [ ] 接続前の保存、接続後の保存、接続解除後の古いqueue、LINE送信失敗をstaging専用channelで確認する。
- [ ] Supabase、Cloudflare R2、LINE Messaging API、配置先の実資格情報を使ったE2Eを実施する。

ローカルではDB接続情報とDockerが利用できないため、上記の実DB検証は未実施です。
