# FS-ANN-001 回覧板・既読管理の敵対的レビュー

レビュー日: 2026-08-22

対象ブランチ: `feature/phase4-bulletin-board`

対象仕様: `docs/functional-specification.md` のFS-ANN-001、および`docs/ implementation-plan.md`のPhase 4、データモデル、認証・RLS、API契約の記載

## 判定

Critical: 0件

High: 0件

Medium: 3件

FS-ANN-001のfeature実装は、CriticalとHighの指摘を解消したため、中央統合前のfeatureとして合格とします。

Mediumは中央統合または外部サービス接続に関する残課題であり、本featureの必須範囲を不合格とはしません。

## 確認項目

### 1. テナント境界

- APIは`tenantId`を本文、query、認証外のURLから受け取りません。
- repositoryはすべての回覧、添付metadata、既読を`tenant_id`条件付きで検索します。
- 回覧と既読の主キー、回覧と添付snapshotの外部キーにtenantを含めています。
- 別テナントの回覧詳細と既読操作は404になります。
- 別テナントの添付IDと未知の添付IDは同じ404になります。
- DB統合テストでtenant Aからtenant Bの回覧を取得できないことを確認しました。

### 2. active membershipと認可

- API認証middlewareはJWTの有効期限とactive membershipを確認します。
- DB repositoryは各transactionで所属のstatusとroleを再確認します。
- 掲載はowner、admin、staffだけに許可します。
- guardianの掲載は403で拒否します。
- 既読はactive membershipなら全roleで実行できます。
- 未読者一覧は掲載者本人以外へ404を返します。
- 未読者一覧の認可はroleではなく`author_user_id`との一致で判定します。

### 3. 個人情報非漏えい

- 公開DTOから`tenantId`と`authorUserId`を除外しています。
- 添付DTOからobject key、署名URL、SHA-256、公開URLを除外しています。
- 未読者一覧は掲載者本人だけへ返し、user IDとrole以外を返しません。
- 未知IDと別テナントIDを同じerror codeへ収束し、存在推測を防止しています。
- 監査metadataへ本文、メールアドレス、添付内部キーを保存していません。

### 4. 入力検証

- titleを1文字以上200文字以下に制限しています。
- bodyを1文字以上20000文字以下に制限しています。
- 添付IDをUUID、最大10件、重複なしに制限しています。
- pageとpageSizeを正規化し、pageSizeの上限を100にしています。
- strict objectでtenantId、authorUserId、readAtなどの未許可項目を拒否しています。
- Webは本文をHTMLとして解釈せず、Reactのテキスト表示で扱います。

### 5. 状態、競合、監査

- DBは`published`と`archived`の状態を持ち、掲載開始はpublishedに限定します。
- DB triggerはtenant、ID、掲載者、掲載時刻の変更を拒否します。
- archivedからの再公開をDB triggerで拒否します。
- 既読の複合主キーと`ON CONFLICT DO NOTHING`で同時既読を一度だけ確定します。
- 初回既読時刻は再送で更新しません。
- 掲載と初回既読を`announcement.published`、`announcement.read`として監査します。
- 掲載者が未読者一覧を取得した事実も`announcement.unread.viewed`として監査します。
- append-onlyの既読処理では、RLS下でvisibilityを失う`FOR SHARE`を使わず、DB制約で競合を制御しています。

### 6. 添付IDの存在推測防止

- 掲載時は同じtransaction clientで添付adapterを呼び出します。
- adapterは同一tenantかつavailableのmetadataだけを返します。
- 要求件数と検証済み件数が一致しない場合は、どのIDが失敗したかを返さず404にします。
- 回覧へ保存するのはmedia typeとbyte sizeのsnapshotだけです。
- attachment本体のdownload認可は添付featureへ分離しています。

## テスト結果

- `pnpm --filter @cocolo/contracts test`: 成功、5件。
- `pnpm --filter @cocolo/domain test:unit`: 成功、2件。
- `pnpm --filter @cocolo/api test:unit`: 成功、27件。
- `pnpm exec vitest run apps/web/src/features/bulletin-board/bulletin-board-api.vitest.ts`: 成功、3件。
- `pnpm verify:migration-sql`: 成功。
- 専用検証DBへの全migration適用: 成功、4件。
- `BULLETIN_BOARD_DB_INTEGRATION=1 pnpm --filter @cocolo/api test:integration`: 11件成功。
- `pnpm --filter @cocolo/web build`: 成功。

## Medium残課題

### M-1 中央登録前

`apps/api/src/app.ts`と`apps/web/src/main.tsx`を変更していないため、PR単体では回覧機能が本番ルートへmountされません。

これは依頼された中央登録点を変更しない制約による残課題であり、統合担当が`docs/integration/phase4-bulletin-board.md`の手順で接続します。

### M-2 R2実接続前

実R2 bucket、署名URL、download adapter、R2 migrationとのstaging E2Eは未実施です。

本featureは同一transactionへ注入できる添付adapterを提供し、R2実接続を含めないことで添付featureとの変更競合を避けています。

### M-3 未読者表示の識別子

未読者一覧はAuthのopaque user IDを返します。

氏名やメールアドレスを返すと個人情報の開示範囲が広がるため、現時点では掲載者だけがopaque IDを確認する仕様にしています。

## レビュー結論

Critical 0件、High 0件を確認しました。

FS-ANN-001のfeature固有実装は、上記Mediumを明示した状態でDraft PRへ提出可能です。

中央統合後は、本レビューを再実施し、mount、実添付download、staging E2E、role表示を追加確認してください。
