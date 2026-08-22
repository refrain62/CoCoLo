# 共同購買、集金、CSVの統合契約

この文書は、FS-ORD-001〜004に対応する注文機能を既存アプリへ接続するための契約を記録します。

注文機能は、募集案件、商品、商品ごとの選択肢、注文、注文明細、集金状態を扱います。

金額は日本円の整数で保持し、単価と数量の乗算および注文合計で安全整数の上限を超えた値を受け付けません。

## 実装範囲

今回のブランチは、中央の `app.ts`、`main.tsx`、Prisma schema、共有indexを変更せず、後から接続できるfeature単位の境界を追加しています。

| 層 | 実装 | 接続方法 |
| --- | --- | --- |
| domain | 金額計算、商品選択肢、背番号、背ネーム、状態遷移、集計、CSV生成 | `@cocolo/domain/orders` |
| contract | 募集案件、商品、注文、集金状態、一覧条件のZod契約 | `@cocolo/contracts/orders` |
| DB repository | テナント境界、部員所属、注文保存、支払状態、監査を閉じ込める分離adapter | `@cocolo/db/orders` |
| API | 認証、所属、権限、注文、集金、集計、CSVを提供する独立Hono app | `createOrdersPaymentsApp` |
| Web | 保護者の注文入力と管理者の集金確認、集計、CSV出力 | `OrdersPaymentsPage` |

現在のPrisma schemaには注文系テーブルがないため、repositoryは分離adapterとしてメモリ実装を提供します。

この実装はAPIの認可と業務ルールを先に検証するためのものであり、本番DBへの永続化が完了したことを意味しません。

DBを接続する統合担当は、repositoryのメソッド契約をSQLまたはPrismaの永続adapterへ移し、注文系テーブルとRLSを同じ変更単位で追加します。

## API接続

既存のHono appへ次のようにmountします。

```ts
import { createOrdersPaymentsApp } from './features/orders-payments/orders-payments-app.js';

const ordersApp = createOrdersPaymentsApp({
  verifyToken,
  membershipRepository,
  ordersRepository,
});

app.route('/', ordersApp);
```

`verifyToken`は既存のSupabase JWT検証器を渡します。

`membershipRepository`は、認証された利用者についてactiveな所属を1件だけ返します。

`ordersRepository`は、要求から受け取った `tenantId` を信用せず、認証middlewareが解決した所属だけを受け取る実装にします。

### エンドポイント

| メソッド | パス | 権限 | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/orders` | owner、admin、guardian | 募集案件一覧 |
| POST | `/api/v1/orders` | owner、admin | 募集案件と商品を登録 |
| GET | `/api/v1/orders/:orderId` | owner、admin、guardian | 募集案件詳細 |
| POST | `/api/v1/orders/:orderId/products` | owner、admin | 商品を追加 |
| PATCH | `/api/v1/orders/:orderId/status` | owner、admin | `open → closed → completed` を遷移 |
| GET | `/api/v1/orders/:orderId/entries` | owner、admin、guardian | 注文一覧。guardianは自分の注文だけ |
| POST | `/api/v1/orders/:orderId/entries` | guardian | 担当部員の注文を登録 |
| PATCH | `/api/v1/orders/:orderId/entries/:entryId/payment` | owner、admin | `unpaid ↔ paid` を変更 |
| GET | `/api/v1/orders/:orderId/summary` | owner、admin | 商品、選択肢、支払状態別の集計 |
| GET | `/api/v1/orders/:orderId/unpaid` | owner、admin | 未払い一覧 |
| GET | `/api/v1/orders/:orderId/export.csv` | owner、admin | UTF-8 BOM付きCSV |

staffには共同購買情報を返しません。

注文と集金の更新では、通信再送による二重登録を防ぐため `Idempotency-Key` を受け付けます。

同じキーに異なる内容を送ると409を返します。

## 業務ルール

### 金額

単価は0円以上の整数、数量は1以上10000以下の整数に限定します。

明細金額は単価と数量の積で計算し、注文合計は明細金額の合計で計算します。

クライアントが送る金額は保存せず、API側で商品に登録された単価から再計算します。

### 選択肢

商品に登録された選択肢名と値を注文時に再照合します。

登録されていない商品ID、選択肢名、選択肢の値は拒否します。

選択肢を登録した商品では、各選択肢の値をすべて指定する必要があります。

背番号と背ネームは商品側の入力条件に従い、条件がない商品への入力も拒否します。

### テナントと注文者

募集案件、商品、対象部員、注文明細、集計、CSVは同じtenantに属するものだけを処理します。

guardianは `guardian_members` に登録された担当部員だけを注文対象にできます。

別tenantの部員IDを指定した場合は、存在を推測できない404として拒否します。

guardianの注文一覧は注文者ユーザーIDで絞り、別のguardianの注文を返しません。

### 支払状態

ownerまたはadminだけが支払状態を変更できます。

`paid` へ変更すると確認日時と確認者を記録し、`unpaid` へ戻すと確認日時と確認者を消去します。

どちらの変更も変更前後の状態を監査します。

オンライン決済はこの機能に含めません。

## 個人情報とCSV

画面とCSVに含める個人情報は、注文者名と対象部員名に限定します。

電話番号、認証情報、Service Role Key、別tenantの識別子は注文CSVへ出力しません。

支払状態とCSV出力はownerまたはadminだけが実行できます。

CSVはUTF-8 BOM付きで出力します。

セルの先頭が `=`, `+`, `-`, `@` の場合は、先頭に単一引用符を付けて表計算ソフトの式解釈を防ぎます。

CSV出力の監査には行数と列名だけを保存し、注文者名や部員名を監査metadataへ複製しません。

## DB接続時の不変条件

注文系テーブルを追加するときは、次の条件を保ちます。

* **テナント複合参照**：商品、注文、注文明細、部員の参照にtenant境界を含めます。
* **RLS**：既存の `app.tenant_id`、`app.user_id`、`app.role` をtransaction-localに設定してからSQLを実行します。
* **状態制約**：募集案件は `open → closed → completed`、集金は `unpaid ↔ paid` だけを許可します。
* **監査**：注文登録、支払状態変更、集計、CSV出力をappend-only監査へ記録します。
* **金額の再計算**：注文明細へ登録する金額は商品単価と数量からサーバー側で再計算します。
* **UUIDv7**：資源IDは既存仕様のUUIDv7を使い、連番やクライアント入力IDを採用しません。

Prisma schemaへモデルを追加する場合は、migration、RLS policy、grant、tenant A/Bの統合テスト、seedの順に同時更新します。

## テストと統合時の残作業

feature単位では次のテストを実行します。

```text
pnpm exec vitest run packages/domain/test/orders-domain.vitest.ts packages/db/test/orders-repository.vitest.ts apps/web/src/features/orders-payments/orders-payments-api.vitest.ts
pnpm --filter @cocolo/api build
node apps/api/test/orders-payments.test.mjs
pnpm --filter @cocolo/web typecheck
pnpm --filter @cocolo/web build
```

統合担当は次の作業を別コミットで行います。

* 既存 `app.ts` へfeature appをmountする。
* 既存 `main.tsx` から画面を表示するルートを追加する。
* Prisma schema、migration、RLS、seedへ注文系モデルを追加する。
* `packages/contracts/openapi.yaml` を契約生成手順へ追加する。
* 実PostgreSQLでtenant A/B、owner、admin、staff、guardianを使った統合テストを追加する。
* local、staging、productionのDB migration適用と切り戻し手順を確認する。
