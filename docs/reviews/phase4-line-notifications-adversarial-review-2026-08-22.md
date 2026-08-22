# Phase 4 LINE 通知の敵対的レビュー

## レビュー対象

レビュー対象は `feature/phase4-line-notifications` の `d0b0f7e` です。

このコミットは、最新の `origin/develop` `d7e5f16` を取り込んだ後の実装、Node 標準 TypeScript 移行への追従、SQL repository の構文修正、専用テストを含みます。

中央の `apps/api/src/app.ts`、`apps/web/src/main.tsx`、Prisma schema、共有 index は変更対象外として確認しました。

## 判定

Critical は 0 件です。

High は 0 件です。

この feature branch の実装範囲について、Critical と High の指摘を解消したため、Draft PR のレビュー対象として進めます。

ただし、中央 app への mount、LINE 専用 migration、実 PostgreSQL の RLS と transaction 検証は統合担当の前提です。

これらが完了するまで、production で LINE 通知を有効化してはいけません。

## 攻撃観点と確認結果

| 観点 | 確認内容 | 結果 |
| --- | --- | --- |
| tenant 越境 | HTTP body の tenant ID を受け付けず、JWT から解決した tenant を repository の全操作へ渡す | 問題なし |
| group 紐付け | connected group ID を tenant 間で一意にし、Webhook と queue の両方で現在の group binding を確認する | 問題なし |
| 古い queue | queue 作成時の group ID と現在の接続 group ID を claim 時に比較する | 問題なし |
| 認可 | owner と admin だけが接続変更と手動再試行を行い、staff は通知登録だけを行う | 問題なし |
| worker 誤起動 | 全 tenant を処理する `deliverOne` を利用者向け route から公開しない | 問題なし |
| Webhook 偽装 | raw body の HMAC-SHA256、本文サイズ、destination、group binding、重複 ID を順に検証する | 問題なし |
| 入力汚染 | strict な Zod 契約、通知元 ID の文字種、同一環境 deep link、LINE 本文長を検証する | 問題なし |
| 個人情報 | Webhook 応答へ tenant ID、user ID、本文を返さず、provider の本文と token を保存しない | 問題なし |
| 状態競合 | `sending` への claim、`sent` と `failed` の更新を状態条件付きで行い、SQL claim は `SKIP LOCKED` を使う | 問題なし |
| DB 分離 | Supabase PostgreSQL 固有の Auth schema と LINE 専用 queue の移行境界を文書化する | 統合前提 |

## レビュー中に検出して修正した指摘

### High 1: 利用者が全 tenant の配信 worker を起動できる経路

初期実装には、owner または admin の HTTP request から全 tenant の queue を処理できる配信 route がありました。

この route は認証済みでも tenant scope を指定していないため、別 tenant の通知を処理する権限昇格経路になります。

利用者向けの配信 route を削除し、`deliverOne` を内部 job から呼び出す service 境界だけに残しました。

### High 2: 接続解除後の古い通知が新しい group へ送られる可能性

初期実装では queue の tenant だけを確認していたため、同じ tenant が接続解除後に別 group へ再接続すると、古い通知が新 group へ送られる可能性がありました。

queue に作成時の `group_id` を保存し、in-memory と SQL の claim で現在の connected group と一致する場合だけ送信対象にしました。

### Medium: 同一 origin 内の任意画面への deep link

同一 origin だけを確認すると、通知元と関係のない管理画面へ利用者を誘導できます。

通知元の種別と ID から生成した期待値との完全一致へ変更し、`events`、`bulletins`、許可済み LIFF state だけを受け付けるようにしました。

### Medium: Webhook 本文サイズと destination の未検証

署名が正しくても過大な本文や別 channel の payload を処理できる余地がありました。

raw body の 1 MiB 上限と設定済み destination の完全一致を署名検証後に追加しました。

### Medium: PostgreSQL の `FOR UPDATE` 句の位置

SQL repository の claim query が `FOR UPDATE` の後に `LIMIT` を置いており、PostgreSQL の構文順序に適合しませんでした。

`LIMIT 1 FOR UPDATE OF q SKIP LOCKED` へ修正し、専用テストで同じ順序を検証します。

## テスト証跡

次の検証を Node `v24.18.0` で実行し、すべて成功しました。

- `pnpm lint:biome` は 100 ファイルを検査しました。
- `pnpm typecheck`、`pnpm lint`、`pnpm build` は成功しました。
- `pnpm test` は contract 6 件、domain 4 件、DB repository 1 件の計 11 件が成功しました。
- `pnpm test:unit` は Vitest 10 件、contract 6 件、domain 4 件、API 32 件が成功しました。

契約テストは tenant ID 混入、通知元 ID、Webhook の group ID と重複排除 ID を確認します。

domain テストは deep link、LIFF state、UUID v7 を確認します。

DB repository テストは tenant と group の SQL 条件、queue claim の `SKIP LOCKED` 構文を確認します。

API テストは未接続、group 競合、古い queue、署名、destination、重複 Webhook、失敗再試行、権限を確認します。

Web テストは token の扱いと未接続状態の表示境界を確認します。

## 残る統合前提

中央 app と Web の起動点へ mount するまで、HTTP endpoint と画面は本番の起動経路から分離されています。

Prisma schema を変更していないため、`line_connections`、`line_notification_queue`、`line_webhook_receipts` の migration と RLS は未適用です。

SQL repository の接続競合、queue claim、Webhook receipt の重複排除は、実 PostgreSQL の transaction と制約を staging で検証する必要があります。

実 LINE channel を使った署名、Push API、LIFF 起動、再送の E2E は local fake adapter では代替できません。

上記は本レビューの Critical または High には分類しませんが、統合チェックリストを完了するまで production 有効化の承認条件を満たしません。
