# 部活・クラブチーム管理アプリ「CoCoLo」完全統合版・開発実装計画書

本ドキュメントは、アプリ「CoCoLo」のコンセプト、命名由来、追加機能開発、ORM移行（DrizzleからPrismaへ）、Flyway風差分マイグレーション運用、およびCI/CDパイプライン構築における**すべての検討・決定事項（ボツ案・命名根拠・試行錯誤の全経緯・詳細設計）**を記録した完全仕様書です。

実装としてはテスト駆動（TDD）で開発を行ってください。

---

## 1. アプリコンセプト & 命名の由来

* **アプリケーション名:** CoCoLo（ココロ）
* **名前の由来:** 
  * **「心（こころ）」:** 選手、保護者、役員、指導者が「心をひとつに」してチームを運営・応援できるようにという想い。
  * **「Co-（共に） + Co-（協力する） + Local / Team（地域・チーム）」:** 保護者の負担を減らし、チームに関わる全員が対等に**Co-operation（協力）** **Co-ordination（調整）**できるプラットフォームを目指す意図が込められています。
* **ターゲット:** 部活、スポーツ少年団、保護者会、クラブチーム（小・中・高・大・一般）
* **基本技術スタック:**
  * フロントエンド: Vite + React (TypeScript) + Tailwind CSS
  * UIコンポーネント: Shadcn UI (Radix UI / Lucide React)
  * バックエンド: Hono (Node.js / Cloudflare Workers 想定)
  * データベース: Supabase (PostgreSQL)
  * ORM・マイグレーション: Prisma ORM (`prisma migrate`)
  * 認証 (Auth)：Supabase Auth
  * ストレージ: Cloudflare R2 (画像・添付ファイル管理)
  * ユニットテスト：Vitest（PlaywrightによるE2Eテストも含む）
  * CI/CD: GitHub Actions

Supabase CLI ＋ Service Role Key（推奨・最も安全）


主要機能の設計案
マルチテナント構造（例: cocolo.app/team-a やテナントID管理）を前提とし、各チームが独立して利用できる基本機能の構成案です。

- スケジュール・練習予定
  - 月間/週間カレンダー表示（練習、試合、イベント）
  - グラウンドや体育館など、場所のマップ連携（Google Maps）
  - 出欠回答の締切設定とリマインド通知
  - 月間のスケジュールは表形式が良い。当番がだれかなど見やすいほうが良い
  - スマホで見やすいようにリキッドデザインにして
- 試合・遠征のお知らせ & 出欠管理
  - 対戦相手、集合時間、持ち物、配車（送迎）可否のチェック項目
  - リアルタイム出欠集計（選手・指導者・保護者別のステータス確認）
- 送迎（配車）調整
  - 「車を出せる人数（乗車可能数）」と「乗車希望者」のマッチング機能
  - 配車表の自動/手動作成と割り当て一覧の共有
- 回覧板・お知らせ
  - クラブからの連絡事項、PDF資料（部費・総会資料など）の添付
  - 既読・未読トラッキング（誰が確認したか一覧で表示）
- LINE連携（通知エンジン）
  - LINE Messaging API + LIFF を活用し、Webアプリで予定を作成・更新した際に指定のLINEグループや公式アカウントへ通知を発信
  - LINE内でWebアプリを直接開く（LIFF）ことで、ログインの手間を軽減。
  - LINEへの更新通知（Webhook）
  - 通知内のリンク（Deep Link）からワンタップでWebアプリの該当ページへ遷移し、ログイン保持された状態で回答完了

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
Tシャツやパーカーは「S, M, L, XL」、ジュニア用は「130, 140, 150」、団扇やバッグは「サイズなし（フリー）」など、商品に応じたバリエーション（サイズ選択肢）を管理者が柔軟に定義できる

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

---

## 8. 実装着手前の補充計画（不足要件の確定）

### 8.1 リリース範囲と優先順位

本計画は一度に全機能を実装するのではなく、利用可能な縦切り（画面・API・DB・テストを含む単位）で段階的にリリースします。各フェーズは、前フェーズの受け入れ条件と自動テストが通過してから着手します。

* **Phase 0（開発基盤）:** pnpm、Node.js 20、TypeScript strict、Vite、Hono、Prisma、Vitest、Playwright、ESLint、Prettier、環境変数、CI の最小構成を整備します。
* **Phase 1（認証・テナント・部員）:** Supabase Auth の JWT 検証、チーム境界、役割認可、部員 CRUD、学年表示、年度末繰り上がりを実装します。
* **Phase 2（予定・出欠）:** 月間/週間の予定一覧、イベント CRUD、締切、出欠登録・集計、持ち物・集合情報を実装します。
* **Phase 3（役員・共同購買・集金）:** 役員名簿、年度引き継ぎ、商品・注文・集金確認、未払い一覧、CSV 出力を実装します。
* **Phase 4（添付・通知）:** R2 アップロード、回覧板、既読管理、LINE 通知を実装します。外部サービス未接続でも画面と通知キューの状態を確認できる開発用アダプターを用意します。
* **Phase 5（送迎・運用強化）:** 乗車可能数と乗車希望のマッチング、配車表、Google Maps リンク、監査ログ、運用メトリクスを追加します。

Google Maps、LINE Messaging API / LIFF、リアルタイム通知は外部認証情報が必要なため、Phase 1〜3 の必須経路から分離します。未接続状態を「成功」として扱わず、未設定・送信失敗を画面で識別できるようにします。

### 8.2 認証・マルチテナント・権限

Supabase Auth を唯一の認証基盤とし、Supabase の Service Role Key は Hono のサーバー環境だけに配置します。ブラウザには anon key のみを渡し、Service Role Key をクライアントバンドル、ログ、エラーメッセージへ出力しません。

既存の「内部 User テーブルを作成しない」方針は維持します。ただし、チームと所属を安全に管理するため、次のテーブルを追加します。

* **Tenant:** `id`、`name`、`createdAt` を持つチーム本体。
* **TenantMembership:** `tenantId`、Supabase の `userId`、`role`、`createdAt` を持ち、`tenantId + userId` を一意にします。
* **Role:** `owner`、`admin`、`staff`、`guardian` の固定値を初期採用し、API ごとに許可ロールを明示します。

すべてのテナント所属モデルに `tenantId` を持たせ、API は JWT の subject と所属テーブルから対象テナントを解決します。リクエストボディや URL パラメータの `tenantId` を認可根拠として使用しません。Prisma の全検索・更新・削除条件にテナント条件を必須化し、別チームの ID を指定しても `404` と同等に扱います。

開発環境の認証バイパスは、`NODE_ENV=development` かつ明示的な設定がある場合だけ許可し、本番ビルドではコードパス自体を有効化しません。

### 8.3 データモデルの補充と整合性

現在の 6 モデルに加え、出欠と所属を実装上の必須モデルとして追加します。

* **EventAttendance:** `eventId`、`tenantId`、外部 `userId`、任意の `memberId`、`status`（`attending` / `absent` / `pending`）、`note`、`respondedAt` を持ち、同一イベント・ユーザー・部員の組み合わせを一意にします。
* **Announcement / AnnouncementRead:** 回覧板本文・添付メタデータと、ユーザーごとの既読時刻を管理します。既読情報はテナントを跨いで共有しません。
* **RideOffer / RideAssignment:** Phase 5 で追加し、運転者の乗車可能数、希望者、割当状態を別々に管理します。最初から自由形式の配車文字列だけで実装しません。

既存モデルには必要な複合インデックスと制約を追加します。最低限、`tenantId`、検索対象の status / fiscalYear / deadline / startAt、外部 userId に対する検索インデックスを作成し、同一テナント内で重複してはいけない組み合わせは `@@unique` で表現します。

* 金額は日本円の整数（最小単位は 1 円）で保持し、浮動小数点を使用しません。
* 日時は DB では UTC、API では ISO 8601、表示時のみ `Asia/Tokyo` に変換します。
* `quantity`、`price`、`fee` は 0 未満を拒否し、背番号・背ネーム・学年・ステータスは入力スキーマで検証します。
* 注文・明細・集金更新、年度繰り上げは Prisma transaction で処理し、途中成功を許しません。
* 既存データを壊す変更では、`prisma migrate dev --create-only` で SQL を確認してから適用します。`prisma db push` は引き続き使用しません。

### 8.4 API 契約とエラー処理

API の公開パスは `/api/v1` に統一し、Hono のルートごとに認証、テナント解決、権限、入力検証を順番に実行します。Prisma の型をそのまま外部レスポンスに公開せず、API 用 DTO を定義します。

* 一覧 API は `page`、`pageSize`、`q`、status 等の許可済みクエリだけを受け付け、`pageSize` は最大 100 とします。
* 成功レスポンスは JSON、CSV は `text/csv; charset=utf-8` とし、CSV のセル先頭に `=`, `+`, `-`, `@` が来る場合は式インジェクションを防止します。
* エラー形式は `{ "error": { "code": "...", "message": "...", "details": {}, "requestId": "..." } }` に統一します。
* 入力不正は `400`、未認証は `401`、権限不足は `403`、存在しない同一テナント資源は `404`、競合は `409`、想定外エラーは `500` とします。
* 内部エラーの stack trace、SQL、Service Role Key、JWT 全文はクライアントへ返しません。サーバーログにも個人情報を必要以上に出力しません。

主要 API の初期契約は次のとおりです。

* `GET/POST/PATCH/DELETE /api/v1/members`、`POST /api/v1/members/promote`
* `GET/POST/PATCH/DELETE /api/v1/board-members`、`POST /api/v1/board-members/copy-year`
* `GET/POST/PATCH/DELETE /api/v1/orders`、`/orders/:id/items`、`/orders/:id/user-items`
* `PATCH /api/v1/user-order-items/:id/payment`、`GET /api/v1/orders/:id/summary.csv`
* `GET/POST/PATCH/DELETE /api/v1/events`、`PUT /api/v1/events/:id/attendance`
* `POST /api/v1/uploads`（multipart、許可 MIME・サイズ・拡張子を検証）

### 8.5 画面・操作仕様

認証後の共通レイアウトに、現在のチーム名、現在ユーザーの役割、ナビゲーション、エラー通知を表示します。スマートフォン幅を基準にリキッドレイアウトを作り、表は横スクロールまたはカード表示へ切り替えます。

* 部員画面: 検索、status / category フィルタ、kana 表示、保護者連携状態、登録・編集・退部、管理者だけが実行できる年度繰り上げ。
* 予定画面: 月間・週間切り替え、練習 / 試合 / イベントの色分け、締切、集合時刻、場所、持ち物、出欠入力と集計。
* 役員画面: 年度フィルタ、連絡先表示制御、前年度からの役職枠コピー。電話番号は `contactPreference` に従い、権限があっても不要な画面へ表示しません。
* 購買画面: 商品ごとの任意サイズ選択肢、背番号・背ネーム、注文確認、支払い状態、サイズ別集計、CSV ダウンロード。
* 共通状態: loading、empty、validation error、network error、権限不足、保存成功をそれぞれ区別して表示します。

フォームはラベル、必須表示、キーボード操作、フォーカス可視化、エラーの読み上げを備え、色だけで status を伝えません。主要操作には確認ダイアログと取り消し可能性を設けます。

### 8.6 TDD と品質ゲート

実装は Red → Green → Refactor の順で行います。テストを先に追加し、失敗を確認してから最小実装を行い、リファクタリング後に全テストを再実行します。

* **ドメイン単体テスト:** `formatGrade`、入力スキーマ、年度繰り上げ対象、支払い状態、CSV 式インジェクション対策。
* **API テスト:** 認証なし、別テナント、role 別、正常系、入力不正、競合、transaction 失敗を Hono の `app.request` で検証。
* **UI テスト:** 部員検索・登録、出欠入力、支払いトグル、権限による表示差分、loading / error / empty 状態を Vitest + Testing Library で検証。
* **E2E テスト:** Playwright でログイン後の主要導線を検証します。外部 LINE / Maps / R2 は実サービスではなくテスト用アダプターを使用します。
* **CI ゲート:** `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、対象 E2E、Prisma schema 検証を必須にします。失敗時はマージ・本番マイグレーションを許可しません。

### 8.7 環境・運用・監視

`.env.example` に変数名だけを記載し、実値はコミットしません。最低限 `DATABASE_URL`、`DIRECT_URL`、Supabase の URL / anon key / server-only service role key、R2 の binding または S3 互換接続情報、アプリの公開 URL を環境別に管理します。

本番は GitHub Actions の `prisma migrate deploy` のみでマイグレーションを適用します。Production の DB URL は GitHub Environment の protected secret とし、main への push だけで無条件に破壊的 SQL が実行されないよう、migration review と手動承認を設けます。Supabase のバックアップ、復旧手順、失敗 migration の検知と停止条件を README に記載します。

各リクエストに requestId を付与し、認証失敗、権限拒否、migration 失敗、外部通知失敗を構造化ログへ記録します。個人情報、JWT、秘密鍵、アップロード内容はログへ出しません。

### 8.8 実装単位・レビュー・コミット規約

レビューしやすさを優先し、1コミットで複数の機能境界を跨がないようにします。各コミットは日本語の命令形で、変更対象を明示します。

1. `docs: 実装計画に認証・テナント・TDD要件を追加`
2. `chore: Vite/Hono/Prisma/Vitestの開発基盤を追加`
3. `test: 部員ドメインと認可境界の失敗テストを追加`
4. `feat: 部員APIと一覧画面を実装`
5. `test: イベント出欠のAPI・UIテストを追加`
6. `feat: イベントと出欠管理を実装`

各単位の完了条件は、対象テストが先に存在すること、全チェックが通ること、変更意図を日本語コメントまたはコミットメッセージで説明できることです。サブエージェントによる敵対的レビューは、プラン確定後と実装完了後の2回実施し、重大・高優先度の指摘が残っている間は次フェーズへ進みません。

### 8.9 受け入れ条件

次の条件をすべて満たした時点を、初回リリース可能とします。

* 未認証ユーザーが保護された画面・APIへ到達できない。
* ユーザーが所属していないテナントのデータを、ID 推測や改変リクエストを使って読み書きできない。
* 管理者が部員を登録・検索・編集でき、年度繰り上げの対象と非対象が仕様どおりである。
* ユーザーがイベントの出欠を締切前に登録・変更でき、管理者がテナント内の集計を確認できる。
* 役割ごとに、部員・役員・購買・添付の操作可否と個人情報表示が制御される。
* 不正な入力、CSV、ファイル、外部通知失敗が安全に扱われ、利用者へ復旧可能なメッセージが表示される。
* CI の lint、型、単体、API、UI、E2E、build が再現可能なコマンドで成功する。

### 8.10 未解決事項の扱い

LINE の通知先（グループか公式アカウントか）、Google Maps の契約・API キー、Supabase の本番プロジェクト、R2 の公開方式、チームの正式な権限運用は外部条件です。これらは仮定で本番仕様を固定せず、環境変数・アダプター・設定画面に分離し、導入前に決定事項として記録します。
