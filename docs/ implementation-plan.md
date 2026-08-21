# 部活・クラブチーム管理アプリ「CoCoLo」完全統合版・開発実装計画書

本ドキュメントは、アプリ「CoCoLo」のコンセプト、命名由来、追加機能開発、ORM移行（DrizzleからPrismaへ）、Flyway風差分マイグレーション運用、およびCI/CDパイプライン構築における**すべての検討・決定事項（ボツ案・命名根拠・試行錯誤の全経緯・詳細設計）**を記録した完全仕様書です。

---

## 1. アプリコンセプト & 命名の由来

* **アプリケーション名:** CoCoLo（ココロ）
* **名前の由来:** 
  * **「心（こころ）」:** 選手、保護者、役員、指導者が「心をひとつに」してチームを運営・応援できるようにという想い。
  * **「Co-（共に） + Co-（協力する） + Local / Team（地域・チーム）」:** 保護者の負担を減らし、チームに関わる全員が対等に**Co-operation（協力）**できるプラットフォームを目指す意図が込められています。
* **ターゲット:** 部活、スポーツ少年団、保護者会、クラブチーム（小・中・高・大・一般）
* **基本技術スタック:**
  * フロントエンド: Vite + React (TypeScript) + Tailwind CSS
  * UIコンポーネント: Shadcn UI (Radix UI / Lucide React)
  * バックエンド: Hono (Node.js / Cloudflare Workers 想定)
  * データベース: Supabase (PostgreSQL)
  * ORM・マイグレーション: Prisma ORM (`prisma migrate`)
  * ストレージ: Cloudflare R2 (画像・添付ファイル管理)
  * CI/CD: GitHub Actions

## 1.2. システム構成・ディレクトリ構造
```
cocolo/
├── .github/
│   └── workflows/
│       └── db-migrate.yml        # GitHub Actions マイグレーション定義 (prisma migrate deploy)
├── docs/
│   └── implementation-plan.md   # 本指示書
├── prisma/
│   ├── schema.prisma            # Prisma スキーマ定義
│   └── migrations/              # Flyway風にバージョン管理されるSQL差分ファイル群
├── src/
│   ├── client/                  # フロントエンド (React + Shadcn UI)
│   │   ├── components/
│   │   │   ├── ui/              # Shadcn コンポーネント群
│   │   │   ├── members/         # 部員一覧・詳細・登録フォーム
│   │   │   ├── orders/          # 共同購買・集金・背番号指定フォーム
│   │   │   ├── events/          # スケジュール・懇親会・出欠フォーム
│   │   │   └── board/           # 役員管理・連絡先表示コンポーネント
│   │   └── lib/                 # ユーティリティ (formatGrade, R2 Client等)
│   ├── db/                      # Prisma Client 初期化インスタンス
│   │   └── client.ts
│   └── server/                  # バックエンド (Hono API Routes)
│       ├── routes/
│       │   ├── members.ts
│       │   ├── orders.ts
│       │   ├── events.ts
│       │   ├── board.ts
│       │   └── upload.ts        # R2 画像アップロード API
│       └── index.ts
├── package.json
└── tsconfig.json
```
---

## 2. ORM選定・技術移行の全経緯（Drizzle vs Prisma）

### 2.1 決定事項
当初検討していた **Drizzle ORM から Prisma ORM へ全面変更** します。

### 2.2 Prisma を採用した理由（メリット）
1. **AI Agent の実装精度・成功率が圧倒的最高水準:**
   * Cursor Agent、Claude Code、Windsurf 等の AI ツールを活用する際、世界的にコードベースや事例が圧倒的多数を占める Prisma の方が、自動生成コードのエラー（型エラーや構文エラー）が劇的に少なくなります。
2. **Flyway 風の差分 SQL マイグレーション運用との親和性:**
   * `prisma migrate dev` により、スキーマ変更から安全な SQL ファイルが自動生成され、手動修正やGit管理が極めて容易に行えます。

### 2.3 比較検討（ボツ案・不採用理由）
* **Drizzle ORM（不採用）:**
  * スキーマを TypeScript (`schema.ts`) で直接書ける軽量さや Cloudflare Workers との素の相性は魅力的でした。しかし、AI Agent による複雑なリレーションクエリ自動生成時にマイナーな型エラーが発生しやすく、修復コストがかかるため不採用としました。

---

## 3. マイグレーション運用設計（Flyway風 差分管理）

### 3.1 決定された運用方針
本プロジェクトでは、Supabase / PostgreSQL に対して **Flyway と同等の「バージョン管理された差分 SQL ファイル順次適用」** を行います。

* **開発時（ローカル）:** `prisma db push` は使用せず、**`npx prisma migrate dev`** で差分 SQL (`migration.sql`) を生成・適用します。
* **履歴管理:** DB 内の `_prisma_migrations` テーブルにて適用済みマイグレーションのハッシュと順序を管理します。
* **本番/CI:** **`npx prisma migrate deploy`** を使用し、未適用の差分 SQL のみを順次適用します。

### 3.2 開発ワークフロー & コマンド

1. **通常のモデル追加・変更時:**
   `prisma/schema.prisma` を編集後、以下を実行。
   ```bash
   npx prisma migrate dev --name <マイグレーション識別名>
   ```

手動 SQL 調整（インデックス追加、既存データ変換、ALTER TABLE の手修正）が必要な場合:
一度 SQL ファイルのみを出力させてエディタで編集後に適用します。

Bash
```bash
# 1. SQLファイルのみを生成（DBにはまだ適用しない）
npx prisma migrate dev --create-only --name <マイグレーション名>

# 2. 生成された prisma/migrations/XXXX_name/migration.sql を手動編集

# 3. 編集後、適用を実行
npx prisma migrate dev
```

## 4. データベース設計 & 命名規則（Prisma Schema）

### 4.1 テーブル・カラム命名規則の詳細

* **Prisma Model 名 (PascalCase / 単数形):** Member, BoardMember, Order, OrderItem, UserOrderItem, Event

* **DB テーブル名 (snake_case / 複数形):** @@map("members"), @@map("board_members") 等で明示的にスネークケースの複数形にマッピングします。

* **DB カラム名 (snake_case):** @map("tenant_id"), @map("grade_level") 等で明示的にスネークケース化します。

* **ID・主キー:** 全テーブルにおいて自動インクリメント整数型 Int @id @default(autoincrement()) を統一採用します。

### 4.2 見送った命名・設計案（ボツ案・検討経緯）

* **User テーブルの単体作成（見送り）:**

  * 今回は認証基盤（Clerk / Supabase Auth / LINE Auth 等）の外部 userId や guardianUserId（文字列）を保持する設計とし、内部での冗長な User テーブル構築は見送りました。

* **学年（grade）の文字列保持（不採用）:**

  * 「小1」「中2」という文字列で保持すると毎年4月の繰り上がり処理で複雑な文字列操作が必要になるため、数値 (gradeLevel: 1~16) で保持し、UI 表示時にロジックでフォーマットする設計としました。

### 4.3 完全な Schema 定義 (prisma/schema.prisma)

```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 1. 部員（選手）テーブル
model Member {
  id             Int             @id @default(autoincrement())
  tenantId       String          @map("tenant_id")       // マルチテナント用ID
  name           String                                  // 氏名（漢字等）
  kana           String?                                 // ふりがな（表示用）
  category       String          @default("student")     // 'student'(児童・生徒) | 'adult'(一般・大人)
  gradeLevel     Int?            @map("grade_level")     // 1~6:小1~6, 7~9:中1~3, 10~12:高1~3, 13~16:大1~4
  ageGroup       String?         @map("age_group")       // 大人用区分 ('20代', '30代', '一般' 等)
  status         String          @default("active")      // 'active' | 'retired' | 'suspended'
  guardianUserId String?         @map("guardian_user_id")// 紐づく保護者の外部ユーザーID
  note           String?                                 // 備考・アレルギー・特記事項
  createdAt      DateTime        @default(now()) @map("created_at")

  userOrderItems UserOrderItem[]

  @@map("members")
}

// 2. 役員・担当名簿テーブル
model BoardMember {
  id                Int      @id @default(autoincrement())
  tenantId          String   @map("tenant_id")
  userId            String   @map("user_id")            // 役員の外部ユーザーID
  fiscalYear        Int      @map("fiscal_year")        // 対象年度 (例: 2026)
  roleName          String   @map("role_name")          // 役職名 (例: '会長', '会計', '配車担当')
  roleType          String   @map("role_type")          // 'admin' | 'staff' | 'member'
  phone             String?                             // 電話番号（任意）
  contactPreference String   @default("line") @map("contact_preference") // 'line' | 'phone' | 'both'
  note              String?
  createdAt         DateTime @default(now()) @map("created_at")

  @@map("board_members")
}

// 3. 共同購買（募集案件）テーブル
model Order {
  id          Int             @id @default(autoincrement())
  tenantId    String          @map("tenant_id")
  title       String                                  // 募集タイトル (例: '2026年度 夏合宿Tシャツ購入')
  description String?                                 // 詳細説明・振込先等
  deadline    DateTime                                // 締め切り日時
  status      String          @default("open")        // 'open' | 'closed' | 'completed'
  createdAt   DateTime        @default(now()) @map("created_at")

  items       OrderItem[]
  userItems   UserOrderItem[]

  @@map("orders")
}

// 4. 共同購買（商品マスター）テーブル
model OrderItem {
  id             Int             @id @default(autoincrement())
  orderId        Int             @map("order_id")
  name           String                                  // 商品名 (例: '公式練習用ジャージ上')
  price          Int                                     // 金額
  options        String?                                 // サイズ・カラー選択肢 (JSON文字列: '["130","140","S","M"]')
  imageUrl       String?         @map("image_url")       // カタログ画像 (Cloudflare R2 URL)
  createdAt      DateTime        @default(now()) @map("created_at")

  order          Order           @relation(fields: [orderId], references: [id], onDelete: Cascade)
  userOrderItems UserOrderItem[]

  @@map("order_items")
}

// 5. 保護者注文明細 & 集金管理テーブル
model UserOrderItem {
  id             Int       @id @default(autoincrement())
  orderId        Int       @map("order_id")
  userId         String    @map("user_id")              // 注文者(保護者)ユーザーID
  memberId       Int?      @map("member_id")            // 対象部員ID (誰の分か)
  itemId         Int       @map("item_id")
  selectedOption String?   @map("selected_option")      // 選択したサイズ等
  backNumber     String?   @map("back_number")          // プリント背番号 (例: '10')
  backName       String?   @map("back_name")            // プリント背ネーム (例: 'TARO')
  quantity       Int       @default(1)                  // 数量
  isPaid         Boolean   @default(false) @map("is_paid") // 手渡し・手動確認の集金完了フラグ
  paidAt         DateTime? @map("paid_at")              // 集金確認日時
  createdAt      DateTime  @default(now()) @map("created_at")

  order          Order     @relation(fields: [orderId], references: [id], onDelete: Cascade)
  member         Member?   @relation(fields: [memberId], references: [id])
  item           OrderItem @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@map("user_order_items")
}

// 6. 予定・イベント（懇親会）テーブル
model Event {
  id          Int      @id @default(autoincrement())
  tenantId    String   @map("tenant_id")
  title       String                                  // イベント名
  eventType   String   @default("practice") @map("event_type") // 'practice' | 'match' | 'event'
  startAt     DateTime @map("start_at")
  endAt       DateTime @map("end_at")
  location    String?                                 // 開催場所
  fee         Int      @default(0)                    // 参加費・会費
  belongings  String?                                 // 持ち物リスト
  imageUrl    String?  @map("image_url")              // 案内チラシ画像URL
  createdAt   DateTime @default(now()) @map("created_at")

  @@map("events")
}
```

## 5. 各機能要件 & ロジック仕様（詳細検討結果）

### 5.1 部員一覧機能（学年・年代・読み仮名・保護者連携）

学年自動変換ロジック (formatGrade):

* 1〜6 -> 「小1」〜「小6」

* 7〜9 -> 「中1」〜「中3」

* 10〜12 -> 「高1」〜「高3」

* 13〜16 -> 「大1」〜「大4」

* 17+ -> 「OB / 院生」

* category === 'adult' の場合は ageGroup（「30代」「一般」等）を適用。

表示上の配慮:

* 氏名の上に小さく kana（ふりがな）をルビのように表示し、難読文字に対応。

* 保護者欄には保護者名と LINE 連携ステータス（連携済み / 未招待）を表示。

年度末一括繰り上がり API:

* POST /api/members/promote を叩くことで、status === 'active' かつ category === 'student' の部員の gradeLevel を一括で +1 昇格。

### 5.2 役員名簿管理機能（連絡先プライバシー配慮）

プライバシー制御:

保護者役員の中には「電話番号を全体に公開したくない」要望が強いため、contactPreference を設置。

* 'line'（電話非表示、LINEリンクのみ表示）、'phone'（電話番号表示）、'both' から選択可能。

引き継ぎ機能:

新年度開始時に、前年度の役職定義（会長、会計、配車担当など）の枠組みだけをワンタップで新年度へ複製コピーする API を提供。

### 5.3 共同購買・プリント文字指定・集金チェック機能

可変サイズ設定:

商品登録時、JSON 文字列として ["130", "140", "150", "S", "M", "L"] を保存。

* 入力補助プリセットボタン（「キッズサイズ一括」「大人サイズ一括」）を Shadcn UI で提供。

プリント指定 (背番号・背ネーム):

ユニフォーム発注用に、注文ごとに backNumber（数字）と backName（アルファベット大文字）を指定可能。

集金管理（Stripe非採用の理由）:

Stripe等のオンライン決済（見送り）: 決済手数料（3.6%等）の負担を避けるため、部活・集金運用で一般的な「現金手渡し / 銀行振込」のトグル確認（isPaid スイッチ）を採用。

* 未払い者リマインド: 未払い者のみをフィルタリングし、一括で LINE リマインドテキストを生成・送信するアクションを配置。

* 発注サマリー / CSV出力: 集計画面で「サイズ別集計表（例: Sサイズ 12枚、Mサイズ 5枚）」の自動サマリー表示と CSV ダウンロードを可能にする。

### 5.4 予定・イベント管理機能（懇親会対応）

* バッジ分け: 練習（青）、試合（赤）、懇親会・イベント（紫）で識別。

* イベント詳細: 懇親会や合宿用に 会費（fee）、持ち物（belongings）、案内画像を表示。

### 5.5 画像添付機能（Cloudflare R2）

* アップロード仕様: Hono バックエンドに POST /api/upload エンドポイントを準備。受け取ったファイルを Cloudflare R2 に保存し、公開 URL を返却して DB の imageUrl に格納。

## 6. CI/CD パイプライン仕様（GitHub Actions）

GitHub にコードが Push された際、prisma/migrations/ 配下に新しい SQL ファイルが存在する場合のみ、Flyway 同様の手順で本番 DB に差分を自動適用します。

```
# .github/workflows/db-migrate.yml
name: Run Prisma Migrations (Flyway Style)

on:
  push:
    branches:
      - main
    paths:
      - 'prisma/migrations/**'

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js Environment
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install

      - name: Generate Prisma Client
        run: npx prisma generate

      - name: Execute Migration Deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npx prisma migrate deploy
```

## 7. AI Agent 実行用 指示プロンプト

以下をコピーして Cursor Agent や Claude Code 等に投入することで、上記の全設計を踏まえた実装が一括で開始されます。

**【AI Agent 実行プロンプト】**

本プロジェクトの完全版設計書（Googleドキュメント / implementation-plan.md）に従い、アプリ「CoCoLo」の機能実装を行ってください。

**【手順】**
1. `prisma/schema.prisma` に記載されている 6 つのモデル（Member, BoardMember, Order, OrderItem, UserOrderItem, Event）を定義してください。
2. `npx prisma migrate dev --name init_cocolo_schema` を実行し、Flyway風の差分SQLマイグレーションファイルを生成・ローカルDBへ適用してください。
3. `npx prisma generate` を実行して Prisma Client を最新化してください。
4. Hono バックエンド (`src/server/routes/`) に、各モデルの CRUD API、学年繰り上がり API、集金トグル更新 API、CSV出力 API、および Cloudflare R2 用の `/api/upload` エンドポイントを実装してください。
5. Shadcn UI コンポーネントを用い、レスポンシブ（モバイル最適化）に対応したフロントエンド画面（部員名簿、役員管理、共同購買・集金チェック、イベント一覧）を作成してください。
