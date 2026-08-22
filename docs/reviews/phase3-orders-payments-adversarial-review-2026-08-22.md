# Phase 3共同購買、集金、CSVの敵対的レビュー

## 対象

対象SHAは `1335e2c` です。

対象ブランチには `origin/develop` のNode標準TypeScript移行コミット `d7e5f16` を取り込んでいます。

対象機能はFS-ORD-001〜004です。

レビュー対象はdomain、contract、DB repository、API、Web、専用テスト、統合契約です。

## 確認項目

| 確認項目 | 判定 | 根拠 |
| --- | --- | --- |
| テナント越境 | 合格 | 募集案件、商品、注文、対象部員、注文明細をtenantで照合し、越境時は404に収束 |
| 認可 | 合格 | staffの閲覧を拒否し、登録と集金、集計、CSVをowner/adminへ限定 |
| 個人情報 | 合格 | CSV列を注文者名と部員名に限定し、監査metadataへ氏名を複製しない |
| 入力検証 | 合格 | 金額、数量、商品ID、選択肢、背番号、背ネーム、締切をAPIとdomainで検証 |
| 資源ID形式 | 合格 | 注文URLの `orderId` と `entryId` をUUIDv7 parserで検証し、不正値をrepository処理前に400へ収束 |
| 状態遷移 | 合格 | 募集案件の順序遷移と集金状態の往復を検証 |
| CSVインジェクション | 合格 | UTF-8 BOMと式文字列の文字列化をdomain、repository、APIで検証 |
| 冪等性 | 合格 | `Idempotency-Key` の異なる内容を409で拒否し、同一内容を再利用 |
| テスト不足 | 合格 | domain 4件、DB 4件、Web 2件、API 5件を実行 |

## 指摘と対応

### P1-001 staffによる募集案件の閲覧

重大度はHighです。

初回実装ではstaffが募集案件一覧と詳細を閲覧でき、機能仕様の「購買・支払い確認・CSV」の権限表と不一致でした。

repositoryへstaff閲覧拒否を追加し、APIテストで403を確認しました。

修正コミットは `5d41e50` です。

### CI-002テスト実行順序への依存

初回のGitHub品質ゲートでは、VitestがDB packageのbuild前にrepositoryテストを読み込み、domainのサブパスdistを解決できませんでした。

DB専用テストをbuild後にNode testで実行するpackage scriptへ移し、CIとローカルで同じ実行順序に揃えました。

修正コミットは `c66ed43` です。

再実行した `pnpm test:unit` ではDB専用テスト4件を含めて成功しています。

### FS-COM-005 資源IDのUUIDv7検証

追加レビューでは、注文APIのpath paramが文字列のままrepositoryへ渡る点を指摘しました。

既存repositoryのUUIDv7生成器と同じversion 7、variant 8〜bの形式を契約層へparserとして追加しました。

注文詳細、商品追加、状態変更、注文一覧、注文登録、支払状態変更、集計、未払い一覧、CSV出力の各URLで、repository呼び出し前に検証します。

不正な `orderId` 8系統と不正な `entryId` 1系統をAPI専用テストで確認し、すべて400を返すことを確認しました。

修正は `fb02543` に含まれます。

## 判定

Criticalは0件です。

Highは0件です。

今回のfeature branchは、中央appへのmount、Prisma schema、永続DB adapter、OpenAPI生成への接続を意図的に行っていません。

これは担当範囲で指定されたファイル境界による残作業であり、統合時に別レビューを行います。

現在のrepositoryは分離adapterとして機能するため、実PostgreSQLへ保存できることを示すレビュー結果ではありません。
