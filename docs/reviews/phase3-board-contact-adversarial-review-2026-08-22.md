# Phase 3 役員・連絡先の敵対的レビュー

## 対象

対象仕様は `docs/functional-specification.md` の FS-BRD-001 と FS-BRD-002 である。

対象コードは役員連絡先の contract、domain、API、Web、DB repository、専用テストである。

レビューでは tenant 越境、認可、個人情報、入力検証、状態遷移、テスト不足、仕様不整合を確認した。

## 判定

| 重要度 | 件数 | 判定 |
| --- | ---: | --- |
| Critical | 0 | 該当なし |
| High | 0 | 指摘を解消済み |
| Medium | 2 | 統合時の前提として記録 |
| Low | 0 | 該当なし |

Critical と High の未解決事項はない。

## 確認項目

### tenant 越境

API は token の user ID から所属を解決し、本文と query に `tenantId` を受け付けない。

DB repository は各 transaction の tenant 条件、所属再確認、RLS context を設定する。

役員 ID の更新と削除にも `tenant_id` 条件を付け、別テナントの同一 ID を参照しない。

専用 API テストで別テナントの owner が別テナントの役員を取得できないことを確認した。

### 認可

一覧は所属利用者へ許可し、登録、更新、削除、年度引き継ぎは owner または admin に限定した。

API の認可に加えて DB repository でも manager role を再確認し、adapter の直接呼び出しで staff が書き込めないようにした。

期限切れ token、未認証、staff の書き込みを専用テストで確認した。

### 個人情報

staff と guardian へは役職枠だけを返し、担当者 ID、LINE連絡先、電話番号を返さない。

owner と admin へも `contactPreference` に含まれる値だけを返す。

年度引き継ぎでは担当者、LINE連絡先、電話番号、表示設定を初期化する。

監査 metadata には連絡先の値を保存せず、値の有無だけを保存する。

### 入力検証

年度の範囲、役職名の長さ、役職種別、表示設定、電話番号の文字種を検証する。

未知のキー、空の PATCH、同一年度の引き継ぎ、本文内の `tenantId` を拒否する。

Web API client は token がない場合に fetch を実行せず、ID を URL encode する。

### 状態遷移と競合

同一テナントの役職名重複を transaction 内で確認する。

年度引き継ぎはテナント単位の advisory lock と `NOT EXISTS` で再実行時の重複を避ける。

役職名の競合は 409 として API から返せる契約にした。

### テスト不足

契約と domain、認証と認可、tenant 境界、個人情報投影、年度引き継ぎ、DB repository、Web API client を専用テストで確認した。

実データベースの RLS と rollback は、`board_contacts` migration を統合する担当が migration 適用後に integration test へ追加する。

このブランチでは Prisma schema と共有 index を変更しないため、現行 Phase 1 DB だけでは実テーブルを作成できない。

### 仕様整合性

FS-BRD-001 の役職枠管理、担当者、年度引き継ぎを API と Web へ実装した。

FS-BRD-002 の `line`、`phone`、`both` 投影と権限別表示を API と domain へ実装した。

実装範囲と統合前提は `docs/integration/phase3-board-contact.md` に記録した。

## 指摘と対応

### H-01 manager 認可が API に偏る可能性

初期レビューでは API の role 判定だけでは DB repository の直接呼び出しを防げないと判断した。

DB repository に manager role の再確認と 403 error を追加し、API の status error 変換も対応した。

専用 DB テストで staff の repository 書き込みが DB query 前に拒否されることを確認した。

状態は解消済みである。

### H-02 連絡先値の監査ログ保存

初期レビューでは電話番号と LINE 連絡先が監査 metadata へ混入しないかを確認した。

監査 metadata を値の有無だけに固定し、電話番号の値を保存しない専用テストを追加した。

状態は解消済みである。

## 統合時の Medium 前提

### M-01 `board_contacts` migration

repository は Prisma の生成モデルを増やさず raw SQL を使うため、統合側は統合メモに記載した列、制約、RLS、grant を migration で用意する必要がある。

これは Prisma schema と migration を担当する別機能との境界を守るため、このブランチでは実施していない。

### M-02 DB integration test

実 DB の RLS、担当者所属確認、年度引き継ぎの rollback は `board_contacts` migration 適用後に検証できる。

統合手順と確認項目を `docs/integration/phase3-board-contact.md` に残した。

## 検証結果

以下の検証を分離 worktree で実行し、成功した。

```text
pnpm test
pnpm exec vitest run
pnpm build
pnpm lint
pnpm typecheck
```

API テストは 33件、DB repository テストは 3件、Vitest は 13件が成功した。

## 追加レビュー

最新の `develop` 取り込み後に、DB repository の一覧認可を再確認した。

初回実装では一覧処理にも manager role 判定があり、staff と guardian の役職枠閲覧を拒否する仕様不整合があった。

一覧は全ての有効な所属へ許可し、連絡先の投影は API 層へ委譲した。

登録、更新、削除、年度引き継ぎの manager role 判定は維持している。

staff の一覧取得を DB repository テストへ追加し、Critical 0件、High 0件を再確認した。
