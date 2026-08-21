# 部活・クラブチーム管理アプリ「CoCoLo」完全統合版・開発実装計画書

本ドキュメントは、アプリ「CoCoLo」のコンセプト、命名由来、追加機能開発、ORM移行（DrizzleからPrismaへ）、Flyway風差分マイグレーション運用、およびCI/CDパイプライン構築における**すべての検討・決定事項（ボツ案・命名根拠・試行錯誤の全経緯・詳細設計）**を記録した完全仕様書です。

実装としてはテスト駆動（TDD）で開発を行ってください。

利用者向けの機能・業務仕様は `docs/functional-specification.md` に分離しています。機能改修は同仕様書の ID を先に変更し、その後に本書の実装タスク・テスト・migration を更新します。

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
  * バックエンド: Hono（Phase 0〜3 は Node.js 20 に固定。Cloudflare Workers 版は Prisma 接続方式を検証した後に別フェーズで対応）
  * データベース: Supabase (PostgreSQL)
  * ORM・マイグレーション: Prisma ORM (`prisma migrate`)
  * 認証 (Auth)：Supabase Auth
  * ストレージ: Cloudflare R2 (画像・添付ファイル管理)
  * ユニットテスト：Vitest（PlaywrightによるE2Eテストも含む）
  * CI/CD: GitHub Actions

Supabase CLI はローカルの migration / seed / テスト環境操作に使用します。Supabase Service Role Key は Hono のサーバー専用環境変数としてのみ使用し、ブラウザへ渡しません。


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
│       ├── quality.yml            # PR の lint / typecheck / test / build
│       ├── staging-deploy.yml     # staging migration / deploy / smoke / E2E
│       └── production-promote.yml # 承認済み staging artifact の本番昇格
├── docs/
│   ├── implementation-plan.md   # 技術実装計画
│   └── functional-specification.md # 機能・業務仕様の正本
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

* **開発時（ローカル）:** `prisma db push` は使用せず、**`pnpm exec prisma migrate dev`** で差分 SQL (`migration.sql`) を生成・適用します。
* **履歴管理:** DB 内の `_prisma_migrations` テーブルにて適用済みマイグレーションのハッシュと順序を管理します。
* **本番/CI:** **`pnpm exec prisma migrate deploy`** を使用し、未適用の差分 SQL のみを順次適用します。

### 3.2 開発ワークフロー & コマンド

1. **通常のモデル追加・変更時:**
   `prisma/schema.prisma` を編集後、以下を実行。
   ```bash
   pnpm exec prisma migrate dev --name <マイグレーション識別名>
   ```

手動 SQL 調整（インデックス追加、既存データ変換、ALTER TABLE の手修正）が必要な場合:
一度 SQL ファイルのみを出力させてエディタで編集後に適用します。

Bash
```bash
# 1. SQLファイルのみを生成（DBにはまだ適用しない）
pnpm exec prisma migrate dev --create-only --name <マイグレーション名>

# 2. 生成された prisma/migrations/XXXX_name/migration.sql を手動編集

# 3. 編集後、適用を実行
pnpm exec prisma migrate dev
```

### 3.3 migration SQL の命名・コメント・文字コード

* 物理名は英語の `snake_case` とします。テーブル名・カラム名・制約名・インデックス名・enum 値に日本語を使いません。
* migration SQL には、作成・変更したすべてのテーブルとカラムへ `COMMENT ON TABLE` / `COMMENT ON COLUMN` を記載します。コメントは日本語の表示名と用途を含め、例として `COMMENT ON COLUMN members.id IS '部員を一意に識別するUUIDv7';` のように意味が分かる内容にします。
* SQL、Prisma schema、seed、コメントを含むドキュメントは UTF-8（BOMなし）、改行は LF で保存します。CI で migration SQL の UTF-8 decode と日本語コメントの存在を検査し、文字化けしたコメントや日本語識別子を不合格にします。
* `prisma migrate dev` が生成した SQL はレビュー対象とし、コメント、RLS、権限、複合外部キーを手動確認してから commit します。コメントを省略した自動生成 SQL をそのまま本番へ適用しません。

## 4. データベース設計 & 命名規則（Prisma Schema）

### 4.1 テーブル・カラム命名規則の詳細

* **Prisma Model 名 (PascalCase / 単数形):** Member, BoardMember, Order, OrderItem, UserOrderItem, Event

* **DB テーブル名 (snake_case / 複数形):** @@map("members"), @@map("board_members") 等で明示的にスネークケースの複数形にマッピングします。

* **DB カラム名 (snake_case):** @map("tenant_id"), @map("grade_level") 等で明示的にスネークケース化します。

* **ID・主キー:** Phase 1 以降の資源 ID・主キーは、Prisma の `uuid(7)` で生成する UUIDv7（PostgreSQL の `uuid` 型）を採用します。API と URL に連番を出さず、一覧の既定順は `created_at`、同値時は `id` で安定化します。UUIDv7 の時刻順性は補助であり、認証・テナント境界・RLS の代わりにはしません。
* **連番の扱い:** 画面表示用の受付番号・注文番号が必要な場合だけ、tenant 単位の別カラムとして作成します。表示用番号を API の資源識別子や認可判定に使いません。
* **UUIDv7 の生成境界:** 現行の Supabase / PostgreSQL 17 を前提に、DB の `uuidv7()` 関数や追加 extension には依存せず、Prisma の `@default(uuid(7))` または共通生成関数で INSERT 前に生成します。PostgreSQL 18 の `uuidv7()` を使う場合は、全環境の DB バージョンを固定してから別 migration として採用します。

### 4.2 見送った命名・設計案（ボツ案・検討経緯）

* **User テーブルの単体作成（見送り）:**

  * 今回は認証基盤（Clerk / Supabase Auth / LINE Auth 等）の外部 userId や guardianUserId（文字列）を保持する設計とし、内部での冗長な User テーブル構築は見送りました。

* **学年（grade）の文字列保持（不採用）:**

  * 「小1」「中2」という文字列で保持すると毎年4月の繰り上がり処理で複雑な文字列操作が必要になるため、数値 (gradeLevel: 1~16) で保持し、UI 表示時にロジックでフォーマットする設計としました。

### 4.3 付録A：原案6モデルの参考資料（非権威・実装でコピー禁止）

以下は原案の業務モデルと検討経緯を保存するための参考資料です。Phase 1 の実装、migration、DTO、テストはこのブロックをコピーせず、8.13 と 8.14 の確定契約だけを参照します。旧ID型、旧 `guardianUserId`、公開URL設計は採用しません。

```
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
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

* アップロード仕様（Phase 4）: Hono バックエンドに `POST /api/v1/uploads` エンドポイントを準備。private R2 に保存し、DB の Attachment にテナント・所有者・object key・MIME・サイズを記録します。公開 URL は返却せず、認可済みユーザーへ短期署名 URL を発行します。

## 6. CI/CD パイプライン仕様（GitHub Actions）

GitHub にコードが Push された際は、まず staging 環境へ immutable artifact を配置し、staging DB migration・smoke test・E2E が成功した場合だけ、本番承認で同一 artifact を production へ昇格します。production DBへ main push から直接 migration を適用しません。

PR の `quality.yml`、staging 用の `staging-deploy.yml`、production 用の `production-promote.yml` は分離します。production migration は GitHub Environment の protected secret、手動承認、`concurrency: production-migration`、staging 成功 SHA の一致を必須とし、branch protection で `quality` チェックを必須化します。

```
# .github/workflows/staging-deploy.yml
name: ステージングへデプロイ

# uses はタグ・ブランチを禁止し、検証済みリリースの40桁 commit SHAへ固定する。
# SHA はリリースタグと署名を確認したうえで Dependabot / Renovate から更新する。
permissions:
  contents: read

on:
  push:
    branches:
      - main
    paths:
      - 'prisma/**'
      - 'src/**'
      - 'package.json'
      - 'pnpm-lock.yaml'
      - '.github/workflows/staging-deploy.yml'

jobs:
  deploy-staging:
    runs-on: ubuntu-latest
    environment: staging
    concurrency: staging-deploy
    steps:
      - name: リポジトリを取得
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2

      - name: pnpmを準備
        run: corepack enable && corepack prepare pnpm@10.24.0 --activate

      - name: Node.js環境を準備
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 20
          cache: 'pnpm'

      - name: 依存関係を固定インストール
        run: pnpm install --frozen-lockfile

      - name: Prisma Clientを生成
        run: pnpm exec prisma generate

      - name: アプリとmigrationのimmutable artifactを作成
        run: pnpm build && pnpm package:release --artifact-sha "${{ github.sha }}" --include prisma/migrations --output .release

      - name: release artifactのchecksumを確認
        run: pnpm verify:release --release-dir .release --artifact-sha "${{ github.sha }}"

      - name: 検証済みreleaseのstaging migrationを適用
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
        run: pnpm migrate:release --release-dir .release

      - name: 検証済みartifactをステージングへ配置
        run: pnpm deploy:staging --artifact-sha "${{ github.sha }}"

      - name: ステージングのsmoke testを実行
        run: pnpm smoke:staging --base-url "${{ vars.STAGING_APP_URL }}"

      - name: ステージングの認証ユーザーでE2Eを実行
        run: pnpm test:e2e:staging --base-url "${{ vars.STAGING_APP_URL }}"

      - name: ステージング検証証跡を保存
        run: pnpm publish:staging-evidence --artifact-sha "${{ github.sha }}"
```

`production-promote.yml` は `workflow_dispatch` と protected `production` Environment からのみ起動し、入力された artifact SHA が staging evidence の成功 SHA と一致することを確認します。確認後に同じ artifact を production へ配置し、production migration、health check、smoke test を実行します。migration は expand → application deploy → contract cleanup の後方互換順序を守り、失敗時は直前の application artifact へ戻します。既に適用済みの migration を逆向きに戻す rollback は行わず、修正 migration とデータ復旧手順を別途レビューします。

```yaml
# .github/workflows/production-promote.yml
name: 本番へ昇格
on:
  workflow_dispatch:
    inputs:
      artifact_sha:
        required: true
        type: string
      staging_run_id:
        required: true
        type: string
jobs:
  promote:
    runs-on: ubuntu-latest
    environment: production
    concurrency: production-migration
    permissions:
      contents: read
    steps:
      - name: リポジトリを取得
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: pnpmを準備
        run: corepack enable && corepack prepare pnpm@10.24.0 --activate
      - name: Node.js環境を準備
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 20
          cache: pnpm
      - name: 依存関係を固定インストール
        run: pnpm install --frozen-lockfile
      - name: ステージング検証証跡を確認
        run: pnpm verify:staging-evidence --run-id "${{ inputs.staging_run_id }}" --artifact-sha "${{ inputs.artifact_sha }}"
      - name: 検証済みrelease artifactを取得
        run: pnpm download:release --artifact-sha "${{ inputs.artifact_sha }}" --output .release
      - name: release artifactのchecksumを確認
        run: pnpm verify:release --release-dir .release --artifact-sha "${{ inputs.artifact_sha }}"
      - name: 検証済みreleaseのmigrationを適用
        run: pnpm migrate:release --release-dir .release
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DIRECT_URL: ${{ secrets.DIRECT_URL }}
      - name: immutable artifactをproductionへ配置
        run: pnpm deploy:production --artifact-sha "${{ inputs.artifact_sha }}"
      - name: 本番のsmoke testを実行
        run: pnpm smoke:production --base-url "${{ vars.PRODUCTION_APP_URL }}"
```

`package:release` はアプリ成果物、`prisma/schema.prisma`、`prisma/migrations`、migration checksum manifest を同一の immutable release artifact に含めます。`verify:staging-evidence` と `verify:release` は staging run の成功、commit SHA・migration checksum・artifact SHA の一致を検証します。production の `migrate:release` は checkout したリポジトリの migration を参照せず、検証済み `.release` 内の migration だけを `prisma migrate deploy` へ渡します。production Environment の承認前に secret を読み出す step、任意の SHA を checkout する step、staging 未成功の promote は許可しません。

### 6.1 サプライチェーン攻撃対策

次の対策を必須とします。例外は理由、対象パッケージまたは action、期限、承認者を記録した一時的な変更として扱い、自動マージしません。

* **依存パッケージの公開直後待機:** pnpm 10.16 以降を使用し、リポジトリ直下の `pnpm-workspace.yaml` に `minimumReleaseAge: 2880`（48時間）、`minimumReleaseAgeStrict: true`、`minimumReleaseAgeExclude: []` を設定します。CI は `pnpm install --frozen-lockfile` を使い、ロックファイルの変更を同じPRでレビューします。
* **依存関係の実行制限:** `blockExoticSubdeps: true` で git・http tarball 等の依存を禁止し、`strictDepBuilds: true` と `onlyBuiltDependencies` の allowlist で install script を明示許可します。allowlist 外の postinstall はインストールを失敗させます。
* **信頼情報の低下防止:** pnpm 10.21 以降では `trustPolicy: no-downgrade` を有効にし、公開者の provenance / trust 情報が以前より弱くなる更新を自動採用しません。pnpm の実バージョンは `packageManager` に完全固定します。
* **GitHub Actions の SHA 固定:** `uses` は GitHub 公式 action を含めて40桁の commit SHA に固定し、タグ・ブランチ参照を禁止します。リリースタグ、署名、リポジトリ所有者を確認した更新PRだけを取り込みます。GitHub リポジトリ設定でも SHA pinning required と許可 action の allowlist を有効にします。
* **権限の最小化:** workflow と job ごとに `permissions` を明示し、通常は `contents: read` のみとします。`id-token: write`、artifact 書き込み、production secret は必要な job と protected Environment に限定します。fork のPRでは秘密情報を渡さず、`pull_request_target` と untrusted な式を使いません。
* **artifact の完全性:** staging で一度だけ build した artifact に SHA-256 manifest、commit SHA、migration checksum、SBOM を含め、production では再ビルドせず同一 artifact を検証して昇格します。可能なら GitHub artifact attestation を追加し、provenance を保存します。
* **脆弱性検査と更新運用:** Dependabot または Renovate で npm と Actions を更新PR化し、`pnpm audit --prod --audit-level high`、依存レビュー、workflow の静的検査（zizmor または同等）を quality gate に追加します。自動更新はテストと人手レビューを通過するまで本番へ反映しません。
* **ログ・秘密情報保護:** install、build、deploy のログへ token、接続文字列、Service Role Key を出力しません。PR由来のコードを実行する job と staging / production secret を扱う job を分離します。

実装時の設定例は次のとおりです。`onlyBuiltDependencies` は実際の lockfile を確認して最小限のパッケージだけを列挙し、理由をレビュー記録に残します。

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 2880
minimumReleaseAgeStrict: true
minimumReleaseAgeExclude: []
blockExoticSubdeps: true
strictDepBuilds: true
trustPolicy: no-downgrade
onlyBuiltDependencies:
  - '@prisma/engines'
  - esbuild
```

`package.json` の `packageManager` は `pnpm@10.24.0` のように完全固定し、上記設定を無視する古い pnpm での install を CI とローカルの開始時チェックで拒否します。`minimumReleaseAge` の緊急例外は `minimumReleaseAgeExclude` に常設せず、期限付きの承認済み変更として一時的に扱います。

## 7. フェーズ別 AI Agent 実行用指示

一括実装は禁止し、必ず「実装タスク一覧」の1タスクだけを対象にします。各タスクでは、先に失敗するテストを追加して実行し、その後に最小実装、リファクタリング、全体テストの順に進めます。サブエージェントのレビュー指摘が未解消の場合は実装を開始しません。

**【Phase 1 最初の縦切り用プロンプト】**

`docs/ implementation-plan.md` の Phase 1 仕様に従い、Supabase Auth で認証された owner または admin が、自分の所属チームの部員一覧を閲覧し、部員を1件登録できる縦切りを実装してください。

対象範囲は `Tenant`、`TenantMembership`、`Member`、`GuardianMember`、`AuditLog`、JWT 検証、同一 transaction 内のテナント解決、`owner/admin` 権限チェック、入力検証、`GET/POST /api/v1/members`、React の一覧・登録画面です。別テナントへの読み書き拒否を API 統合テストで検証してください。

最初に API の認証・テナント境界・入力不正の失敗テストを追加し、失敗を確認してから実装してください。完了時は `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、`pnpm build` を実行し、変更内容を日本語のコミットメッセージとレビューコメントで説明してください。対象外の出欠、購買、LINE、Maps、R2、送迎機能は実装しないでください。

**【レビュー指示】**

実装後は、別サブエージェントに対してテナント越境、認可抜け、個人情報露出、入力検証欠落、テスト不足、既存要件との不整合を敵対的にレビューさせます。Critical / High の指摘が残る場合は修正してから次タスクへ進みます。

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
* `POST /api/v1/uploads`（Phase 4、multipart、magic bytes・実体サイズ・許可 MIME を検証し、Attachment の resource ID を返却）
* `GET /api/v1/attachments/:id/download`（Phase 4、テナント認可後に短期署名 URL を発行）

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
* **CI ゲート:** `pnpm exec prisma validate`、`pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:e2e:local`、`pnpm build` を必須にします。staging は `pnpm test:e2e:staging` を追加し、失敗時はマージ・本番マイグレーションを許可しません。

### 8.7 環境・運用・監視

`.env.example` に変数名だけを記載し、実値はコミットしません。最低限 `DATABASE_URL`、`DIRECT_URL`、Supabase の URL / anon key / server-only service role key、R2 の binding または S3 互換接続情報、アプリの公開 URL を環境別に管理します。

本番は GitHub Actions の `migrate:release`（検証済み immutable release artifact 内の `pnpm exec prisma migrate deploy`）のみでマイグレーションを適用します。Production の DB URL は GitHub Environment の protected secret とし、main への push だけで無条件に破壊的 SQL が実行されないよう、migration review と手動承認を設けます。Supabase のバックアップ、復旧手順、失敗 migration の検知と停止条件を README に記載します。

各リクエストに requestId を付与し、認証失敗、権限拒否、migration 失敗、外部通知失敗を構造化ログへ記録します。個人情報、JWT、秘密鍵、アップロード内容はログへ出しません。

### 8.8 環境分離（ローカル・ステージング・本番）

ローカル開発環境、ステージング（テスト）環境、本番環境を別の DB・認証プロジェクト・R2 bucket・秘密情報・公開 URL として構成します。データ、Service Role Key、JWT issuer、R2 object key を環境間で共有しません。

| 環境 | 用途 | DB / Auth | R2 | デプロイ・保護 |
| --- | --- | --- | --- | --- |
| **local** | 開発・TDD・手動確認 | Docker 上の PostgreSQL と Supabase CLI のローカル Auth。`cocolo_app` / migration owner を再現 | Phase 4 以降は MinIO または local adapter | `pnpm dev`、test-only Auth は local のみ。実データ持込禁止 |
| **staging** | 結合・E2E・受け入れ確認 | 本番と分離した Supabase project / PostgreSQL。テスト専用ユーザーと seed のみ | staging専用 private bucket | `main` から承認付き deploy。migration、smoke、E2E 成功後に本番候補とする |
| **production** | 利用者向け本番 | production専用 Supabase project / PostgreSQL。実ユーザー・実データ | production専用 private bucket | protected Environment、手動承認、バックアップ、監査、concurrency lock。test-only Auth 禁止 |

共通の `APP_ENV` は `local` / `staging` / `production` のいずれかを必須とし、環境ごとに `DATABASE_URL`、`DIRECT_URL`、`SUPABASE_URL`、`SUPABASE_JWKS_URL`、`R2_BUCKET`、公開 URL を設定します。production では退部後データと AuditLog の保持期間、staging ではテスト用保持期間を必須設定にし、未設定なら起動を拒否します。

環境ごとの secret 名は次で固定します。local は `.env.local`、staging は GitHub `staging` Environment、production は GitHub `production` Environment の同名 secret / variable を使用します。

* **共通必須:** `APP_ENV`、`DATABASE_URL`（`cocolo_app`）、`DIRECT_URL`（migration owner）、`SUPABASE_URL`、`SUPABASE_JWKS_URL`、`SUPABASE_ANON_KEY`、`R2_BUCKET`、`PUBLIC_APP_URL`。
* **サーバー専用:** `SUPABASE_SERVICE_ROLE_KEY`、`R2_ENDPOINT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`。Service Role Key は Supabase Auth の管理 API 等に限定し、Prisma の `DATABASE_URL` / `DIRECT_URL`、ブラウザ、ログ、bundle には使用しません。
* **環境固定値:** local は `cocolo-local`、staging は `cocolo-staging-private`、production は `cocolo-production-private` の R2 bucket だけを許可します。Supabase URL、R2 endpoint、`PUBLIC_APP_URL` は `APP_ENV` ごとの allowlist と完全一致しなければ起動を拒否します。

各 DB の migration は `environment_guard(id=1, environment)` を owner 接続で作成し、app role は変更不可とします。起動時に `APP_ENV` と `environment_guard.environment` が一致すること、`current_user = cocolo_app`、`rolbypassrls = false`、test-only Auth が production で無効であることを検証します。local / staging から production の Supabase URL、DB、R2 bucket が設定されていた場合は health check 前に fail-fast します。

環境昇格は **local → PR quality gate → staging deploy → staging migration / smoke / E2E → 本番承認 → production migration / deploy** の順に固定します。staging への実データコピーは禁止し、必要な再現データは匿名化 seed で作成します。staging の E2E は staging Supabase のテスト専用ユーザーを使い、local の test-only Auth adapter は使いません。staging と production の migration は同じ migration artifact を使い、staging で適用・検証済みであることを本番承認条件にします。

### 8.9 実装単位・レビュー・コミット規約

レビューしやすさを優先し、1コミットで複数の機能境界を跨がないようにします。各コミットは日本語の命令形で、変更対象を明示します。

1. `docs: 実装計画に認証・テナント・TDD要件を追加`
2. `chore: Vite/Hono/Prisma/Vitestの開発基盤を追加`
3. `test: 部員ドメインと認可境界の失敗テストを追加`
4. `feat: 部員APIと一覧画面を実装`
5. `test: イベント出欠のAPI・UIテストを追加`
6. `feat: イベントと出欠管理を実装`

各単位の完了条件は、対象テストが先に存在すること、全チェックが通ること、変更意図を日本語コメントまたはコミットメッセージで説明できることです。サブエージェントによる敵対的レビューは、プラン確定後と実装完了後の2回実施し、重大・高優先度の指摘が残っている間は次フェーズへ進みません。

### 8.10 受け入れ条件

次の条件をすべて満たした時点を、初回リリース可能とします。

* 未認証ユーザーが保護された画面・APIへ到達できない。
* ユーザーが所属していないテナントのデータを、ID 推測や改変リクエストを使って読み書きできない。
* 管理者が部員を登録・検索・編集でき、年度繰り上げの対象と非対象が仕様どおりである。
* ユーザーがイベントの出欠を締切前に登録・変更でき、管理者がテナント内の集計を確認できる。
* 役割ごとに、部員・役員・購買・添付の操作可否と個人情報表示が制御される。
* 不正な入力、CSV、ファイル、外部通知失敗が安全に扱われ、利用者へ復旧可能なメッセージが表示される。
* CI の lint、型、単体、API、UI、E2E、build が再現可能なコマンドで成功する。

### 8.11 未解決事項の扱い

LINE の通知先（グループか公式アカウントか）、Google Maps の契約・API キー、Supabase の本番プロジェクトは外部条件です。R2 は private bucket + 短期署名 URL を確定仕様とし、チームの正式な権限運用は認可マトリクスを初期値として導入前に責任者が承認します。未確定の外部条件は環境変数・アダプター・設定画面に分離します。

### 8.12 敵対的レビュー指摘への決定事項

実装前レビューで指摘された事項を、次の方針で解消してから実装を開始します。

* **実行環境:** Phase 0〜3 は Node.js 20 + `@hono/node-server` に固定します。Prisma の通常クライアントを使用し、Cloudflare Workers 対応は別タスクで接続方式を検証してから行います。
* **JWT検証:** issuer は `${SUPABASE_URL}/auth/v1`、audience は `authenticated`、署名アルゴリズムは Supabase の JWKS に従う RS256 とし、`exp`・`nbf`・issuer・audience を必ず検証します。JWKS は短時間キャッシュし、鍵ローテーション時に再取得します。失効・期限切れ・署名不正は 401、test-only Auth adapter は本番ビルドで有効化しません。
* **DBレベルのテナント境界:** `Tenant`、`TenantMembership`、すべてのテナント所属モデルに `tenantId` を持たせ、親子参照には `tenantId + id` の複合外部キーを使います。Production のアプリ接続は `BYPASSRLS` 属性を持たない `cocolo_app` ロールとし、migration は別の owner / `DIRECT_URL` 接続で実行します。
* **RLSの実行契約:** API は Prisma の interactive `$transaction` を先に開始し、同一の transaction client で JWT subject と許可されたテナント識別子に対する membership を `FOR UPDATE` 付きで取得します。そこで `status=active` を確認し、DBから取得した role / status を使って `SELECT set_config('app.tenant_id', $1, true)`、`SELECT set_config('app.user_id', $2, true)`、`SELECT set_config('app.role', $3, true)` を同じ transaction 内で実行してから全業務クエリを行います。transaction client 外の Prisma query を禁止する repository API を用意し、context 未設定時は RLS が 0 件 / 拒否となるようにします。membership の停止・role変更と同時に実行された transaction の扱いを統合テストで固定します。
* **RLS policy:** 各表で `ENABLE ROW LEVEL SECURITY` と `FORCE ROW LEVEL SECURITY` を有効化し、次の table / role 別 policy を migration SQL に固定します。`app_is_active_member(tenant_id, user_id)` と `app_is_manager(tenant_id, user_id)` は `cocolo_security` owner が作る `SECURITY DEFINER` の boolean-only 関数とし、`SET search_path = pg_catalog, public`、`REVOKE ALL FROM PUBLIC`、`GRANT EXECUTE TO cocolo_app` を明記します。関数は行データを返さず、固定SQLで membership の存在と role だけを判定して RLS 再帰を避けます。
  * `Tenant`: active membership が存在する user だけが対象 tenant を `SELECT` できます。
  * `TenantMembership`: `owner/admin` は同一 tenant の招待・停止・role変更を管理でき、本人は自分の active / invited membership だけを `SELECT` できます。最後の active owner の削除・降格は policy だけでなく transaction 内の `FOR UPDATE` 検査で拒否します。
  * `Member`: `owner/admin/staff` は同一 tenant の全件を `SELECT` でき、`owner/admin` だけが `INSERT/UPDATE` できます。`guardian` は `GuardianMember(tenant_id, member_id, user_id)` が存在する担当部員だけを `SELECT` できます。
  * `GuardianMember`: `owner/admin` は同一 tenant の管理、guardian は自分の `user_id` に一致する紐付けの `SELECT` だけを許可します。staff と guardian の登録・削除は拒否します。
  * `AuditLog`: 全 role に tenant内の append-only `INSERT` だけを許可し、`SELECT` は `owner` のみ、`UPDATE/DELETE` は table grant と policy の両方で拒否します。
  * すべての policy の `USING/WITH CHECK` は tenant、user、role、担当部員条件を明示し、`app.tenant_id`、`app.user_id`、`app.role` のいずれかが未設定なら false になる fail-closed 条件にします。`cocolo_app` に policy を迂回する権限を与えません。
* **RLSの検証:** tenant A / tenant B の owner・admin・guardian を用いた実 PostgreSQL 統合テストで、一覧・登録・更新・親子参照・context 未設定・guardian 担当外の越境ができないことを確認します。アプリ側の `tenantId` 条件だけを安全性の根拠にしません。
* **Phase 1 確定モデル:** `Tenant`、`TenantMembership`、`Member`、`GuardianMember`、`AuditLog` を初回 migration の対象にします。出欠は `Event` に `attendanceDeadline`、`meetingAt`、`opponent`、`transportRequired` を追加し、`EventAttendance` を次の migration で追加します。これらを「完全な Schema」と「予定」に混在させません。
* **保護者と部員の関係:** 単一の `guardianUserId` を認可に使わず、`GuardianMember(tenantId, userId, memberId, relationship, consentedAt)` の所属を根拠にします。guardian は自分が担当する部員の必要最小限の情報を閲覧し、出欠と担当部員の注文確認だけを行えます。Member 自身のログイン・直接回答用の `MemberUser` は Phase 1〜5 に追加しません。
* **認可マトリクス:** `owner/admin` はチーム設定・全機能の管理、`staff` は部員・予定・出欠の運用と締切後の管理修正、`guardian` は担当部員の閲覧・出欠登録・注文確認に限定します。電話番号、特記事項、CSV、支払い確認、削除は owner/admin のみとし、staff / guardian の可否を API テストで固定します。

| 操作 | owner / admin | staff | guardian |
| --- | --- | --- | --- |
| テナント設定・所属管理 | owner は招待・役割変更・削除、admin は参照・運用 | 不可 | 不可 |
| `GET /api/v1/members` | `id,name,kana,category,gradeLevel,ageGroup,status,createdAt` の全件 | `id,name,kana,category,gradeLevel,ageGroup,status` | `GuardianMember` で担当する部員の `id,name,kana,category,gradeLevel,status` のみ |
| `POST /api/v1/members` | 可（`note` は入力不可） | Phase 1 は不可 | 不可 |
| 部員の編集・削除 | 可 | Phase 1 は不可 | 不可 |
| 予定・出欠の運用 | 可 | 可 | 担当部員の出欠登録のみ |
| 購買・注文確認 | 可 | 不可 | 自分が担当する部員の注文確認のみ |
| 支払い確認・電話番号・特記事項・CSV | 可 | 不可 | 不可 |
| 締切後の出欠修正 | 可（理由と監査必須） | 可（理由と監査必須） | 不可 |

Phase 1 の部員 API の入出力・監査契約は次で固定します。

| API | 許可ロール | 入力フィールド | 出力フィールド | 監査 action / 拒否 |
| --- | --- | --- | --- | --- |
| `GET /api/v1/members` | owner/admin/staff、guardian は担当分 | `q,status,category,page,pageSize` のみ | owner/admin: `id,name,kana,category,gradeLevel,ageGroup,status,createdAt`、staff: `id,name,kana,category,gradeLevel,ageGroup,status`、guardian: `id,name,kana,category,gradeLevel,status` | `member.list` / tenant外・担当外は404相当 |
| `POST /api/v1/members` | owner/admin | `name,kana,category,gradeLevel,ageGroup,status`。`tenantId,id,note` は不可 | 作成した基本項目。`note` は返却不可 | `member.create` / staff・guardianは403 |
| `PATCH /api/v1/members/:id` | owner/admin | `name,kana,category,gradeLevel,ageGroup` と `status`（`active` ↔ `suspended` のみ）。`tenantId,id,createdAt,note` は不可 | `id,name,kana,category,gradeLevel,ageGroup,status,createdAt` | `member.update` / tenant外は404相当 |
| `DELETE /api/v1/members/:id` | owner/admin | URLの UUIDv7 のみ。`status=retired` への状態遷移 | `204`。既に retired でも同じ結果 | `member.retire` と `previousStatus,nextStatus,requestId` / staff・guardianは403 |
| `GET /api/v1/members/:id/private-note` | Phase 1 は未提供 | なし | なし | Phase 2でowner/admin専用として再設計 |

API DTO は role ごとに別 schema を持ち、staff / guardian のレスポンスに電話番号、note、保護者識別子、監査 metadata を混入させません。別テナント・担当外資源は存在判定を推測できない外部結果に統一します。

* **個人情報:** Phase 1 の `Member` 登録 DTO では `note` を受け付けず、一覧 DTO にも含めません。管理者専用の明示的な操作だけが特記事項を扱い、閲覧・変更・CSV 出力を `AuditLog` に記録します。本番の退部後保持期間と AuditLog 保持期間は必須の環境別設定（未設定なら本番起動を拒否）とし、法務責任者の承認記録なしに自動削除を有効化しません。AuditLog は owner のみ閲覧でき、アプリ API から変更・削除できない append-only とします。
* **アップロード:** R2 は private bucket を初期値とし、DB にテナント・所有者・MIME・サイズ・object key・`status`（`uploaded` / `available` / `deleted` / `rejected`）を記録します。短期署名 URL でのみ配信し、SVG は拒否、magic bytes と実体サイズを検証し、ファイル名を object key に使用しません。`deletedAt` は `deleted` のときだけ設定します。
* **年度繰り上げ:** `promotion_runs(tenantId, fiscalYear)` 相当の実行記録を保存し、同一年度の再実行は no-op とします。実行前件数プレビュー、対象条件、17以上の扱い、実行者監査ログを仕様化します。
* **注文整合性:** `OrderItem` の `tenantId + orderId` と `UserOrderItem` の `tenantId + orderId + itemId` を複合参照で整合させます。選択肢は JSON 文字列のまま信頼せず、Zod で許可値を検証し、`isPaid` と `paidAt` を状態遷移として更新します。
* **CIとテストDB:** PR 用の `quality.yml`、staging 用の `staging-deploy.yml`、production 用の `production-promote.yml` を分離します。PRでは PostgreSQL を起動して migration、RLS用テストロール、seed を実行し、`pnpm exec prisma validate`、`pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:e2e:local`、`pnpm build` を必須にします。staging では staging Auth ユーザーによる `test:e2e:staging` を実行し、production は承認済み staging evidence と同一 artifact SHA だけを promote します。

### 8.13 Phase 1 スキーマ契約

Phase 1 の実装開始前に、次の契約を選択肢なしで `prisma/schema.prisma` と migration に一致させます。ここにないモデルを Phase 1 の API から参照しません。

* **共通:** すべての内部 ID は `String @db.Uuid`、主キーは `@id @default(uuid(7))` で生成する UUIDv7、`tenantId` は `String @db.Uuid`、外部 Supabase `userId` だけは `String @db.VarChar(128)`、日時は `DateTime @default(now())` とします。`Tenant` 以外のテナント所属モデルには `@@unique([tenantId, id])` を必ず定義し、複合外部キーの参照先にします。DB側の `uuidv7()` は全環境の PostgreSQL 18 固定が別途承認されるまで使用しません。
* **Tenant:** `id String @db.Uuid`、`name`（必須、1〜100文字）、`createdAt`。削除は物理削除せず、所属モデルを先に停止します。TenantMembership から `onDelete: Restrict` で参照します。
* **TenantMembership:** `id String @db.Uuid`、`tenantId String @db.Uuid`（Tenantへ `onDelete: Restrict`）、外部 `userId String @db.VarChar(128)`（Supabase JWT subject）、`role Role`（`owner` / `admin` / `staff` / `guardian`）、`status MembershipStatus`（`invited` / `active` / `suspended`）、`createdAt`、`updatedAt`、`@@unique([tenantId, userId])`、`@@index([userId, status])`。最後の active owner は transaction 内の `SELECT ... FOR UPDATE` で削除・降格できません。
* **Member:** `id String @db.Uuid`、`tenantId String @db.Uuid`（Tenantへ `onDelete: Restrict`）、`name`（必須）、`kana`、`category MemberCategory`（`student` / `adult`）、`gradeLevel`、`ageGroup`、`status MemberStatus`（`active` / `retired` / `suspended`）、`note`、`createdAt`。Phase 1 の POST DTO は `note` を受け付けず、管理者専用の別操作でのみ扱います。
* **GuardianMember:** `id String @db.Uuid`、`tenantId String @db.Uuid`（Tenantへ `onDelete: Restrict`）、外部 `userId String @db.VarChar(128)`、`memberId String @db.Uuid`、`relationship`、`consentedAt`、`@@unique([tenantId, userId, memberId])`、Member への複合 relation は `onDelete: Restrict`。`FOREIGN KEY(tenantId, memberId) REFERENCES members(tenantId, id)` とし、テナントの異なる部員を参照できないようにします。Phase 1 は Member を物理削除せず retired 化し、将来の消去処理では GuardianMember を先に削除してから Member を削除します。
* **AuditLog:** `id String @db.Uuid`（UUIDv7）、`tenantId String @db.Uuid`（Tenantへ `onDelete: Restrict`）、actor の外部 `userId String @db.VarChar(128)`、`action`、`resourceType`、nullable の `resourceId String @db.Uuid`、`metadata Json`（許可キーと最大8KBを入力スキーマで制限）、`createdAt`、`@@index([tenantId, createdAt])`。アプリの更新 API から delete を公開せず append-only とします。

`Role`、`MembershipStatus`、`MemberCategory`、`MemberStatus` は Prisma enum として上記の値だけを定義します。Phase 1 の Prisma relation、`onDelete`、nullability、default、index、unique、CHECK はこの契約から省略しません。

`Member` の `tenantId + id`、`GuardianMember` の `tenantId + memberId`、`AuditLog` の resource ID 型は上記の定義から変更しません。各 enum は API 入力の Zod スキーマと PostgreSQL の CHECK または Prisma enum の両方で制限します。RLS policy、複合制約、tenant A/B と role 別の test fixture を同じ Phase 1 の完了条件に含めます。

Phase 4 の `Attachment` は `id UUID`（UUIDv7）、`tenantId`、`ownerUserId`、`objectKey`、`mediaType`、`byteSize`、`sha256`、`status`（`uploaded` / `available` / `deleted` / `rejected`）、`deletedAt`、`createdAt` を持ち、`tenantId + objectKey` を一意にします。`deletedAt` は `deleted` のときだけ設定し、`rejected` は配信・署名URL発行の対象にしません。R2 の公開 URL は保存せず、download API が毎回認可して短期署名 URL を発行します。

### 8.14 CI・TDD・レビュー成果物の実行契約

PR 用 `quality.yml` は次の順序とコマンドを固定します。Workflow が未作成の段階では、同じコマンドをローカルで実行した結果をタスク完了の証拠にします。

```yaml
name: 品質ゲート
on: pull_request
permissions:
  contents: read
jobs:
  quality:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_test
      DIRECT_URL: postgresql://cocolo_app:cocolo_app@localhost:5432/cocolo_test
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: cocolo_test
          POSTGRES_PASSWORD: cocolo_test
          POSTGRES_DB: cocolo_test
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U cocolo_test -d cocolo_test"
          --health-interval 10s --health-timeout 5s --health-retries 5
    steps:
      - name: リポジトリを取得
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2
      - name: pnpmを準備
        run: corepack enable && corepack prepare pnpm@10.24.0 --activate
      - name: Node.js環境を準備
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
        with:
          node-version: 20
          cache: pnpm
      - name: 依存関係を固定インストール
        run: pnpm install --frozen-lockfile
      - name: 依存関係の脆弱性を検査
        run: pnpm audit --prod --audit-level high
      - name: Prisma schemaを検証
        run: pnpm exec prisma validate
      - name: テストDBへmigrationを適用
        run: pnpm exec prisma migrate deploy
        env:
          DATABASE_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
          DIRECT_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
      - name: RLS用のテストroleを準備
        run: pnpm db:prepare:test
        env:
          DATABASE_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
          DIRECT_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
      - name: テストdataを投入
        run: pnpm db:seed:test
        env:
          DATABASE_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
          DIRECT_URL: postgresql://cocolo_test:cocolo_test@localhost:5432/cocolo_test
      - name: lintを実行
        run: pnpm lint
      - name: 型検査を実行
        run: pnpm typecheck
      - name: 単体テストを実行
        run: pnpm test:unit
      - name: 統合テストを実行
        run: pnpm test:integration
      - name: Playwrightを準備
        run: pnpm exec playwright install --with-deps chromium
      - name: ローカルE2Eを実行
        run: pnpm test:e2e:local
      - name: 本番bundleをビルド
        run: pnpm build
      - name: 本番bundleの混入を検査
        run: pnpm verify:production-bundle
```

`db:prepare:test` は migration owner 接続で `cocolo_app` ロール（`BYPASSRLS` なし）と必要な table grant を作成します。`package.json` の scripts と上記コマンドを一致させ、migration / seed だけを owner 接続、`test:integration` は `cocolo_app` 接続で実行します。`test:integration` は実 PostgreSQL の RLS policy・transaction context・tenant A/B・owner/admin/guardian fixture を検証します。`test:e2e:local` は test-only Auth adapter、`test:e2e:staging` は staging Supabase のテスト専用ユーザーでログインし、外部 Supabase の実アカウントを local へ持ち込みません。

Playwright は `playwright.config.ts` の `webServer` に `command: "pnpm dev:test"`、`url: "http://127.0.0.1:4173/health"`、`reuseExistingServer: false`、起動 timeout 120 秒を固定します。`dev:test` は test-only Auth adapter を有効化した Node/Hono + Vite preview を起動し、production build では adapter import が含まれないことを `pnpm build` 後の静的検査で確認します。

`db:prepare:test` と integration test の開始時には `SELECT current_user`、`SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user`、`has_table_privilege` を検証します。`current_user != 'cocolo_app'`、`rolbypassrls = true`、owner 接続へのフォールバック、RLS未設定、context未設定時の全件取得があればテストを失敗させます。`test:e2e:local` は local test-only Auth + `dev:test`、`test:e2e:staging` は staging Supabase のテスト専用ユーザー + staging URL として scripts を分離し、production からはどちらも起動できないようにします。`verify:production-bundle` は production build の成果物に test-only Auth adapter と Service Role Key の文字列が含まれないことを検査します。レビュー成果物は `docs/reviews/` に日付付き Markdown で保存し、対象 SHA、指摘、重大度、修正コミット、再レビュー判定を必須項目にします。

## 9. 実装タスク一覧と中断後の再開手順

### 9.1 タスク一覧

状態は `[ ]` 未着手、`[~]` 作業中、`[x]` 完了、`[!]` ブロック中を表します。各タスクを完了したら、コミット SHA、テスト結果、レビュー結果をこの表の直下へ追記します。

* [x] **T-001 プラン補充:** 認証、テナント、API、TDD、CI、受け入れ条件を文書化する。コミット: `e0ed27f`
* [x] **T-002 実装前敵対的レビュー:** Critical / High / Medium の指摘を取得する。レビュー結果を T-003 の修正対象にする。
* [~] **T-003 レビュー指摘の解消:** Node.js 固定、Phase 1 Schema 契約、RLS 方針、権限表、private upload、PR CI、local / staging / production 環境、機能仕様書、UUIDv7、migration SQL の命名・文字コード、依存パッケージ待機、Actions SHA 固定を確定する。再レビューで未解消が判明したため継続中。
* [~] **T-003a 機能仕様書の分離:** `docs/functional-specification.md` に機能ID、業務ルール、権限、状態遷移、資源ID、受け入れ条件、変更依頼テンプレートを定義する。計画と仕様の整合レビュー待ち。
* [!] **T-004 実装前敵対的レビュー再実施:** 第3レビューは Critical 1件 / High 5件、第4レビュー（`46023fc`）は Critical 0件 / High 3件、第5レビュー（`9f49cb4`）は Critical 0件 / High 2件、第6レビュー（`30ebace`）は Critical 0件 / High 5件が残り、いずれも不合格。機能仕様書とサプライチェーン対策を含む現行文書で再レビューする。
* [ ] **T-005 開発基盤:** package.json、pnpm lockfile、TypeScript、Vite、Hono、Prisma、Vitest、Playwright、lint、typecheck、build、`dev:test`、`db:prepare:test`、`db:seed:test`、`test:unit`、`test:integration`、`test:e2e:local`、`test:e2e:staging`、`verify:production-bundle`、staging smoke / deploy / evidence scripts を追加する。local / staging / production の `.env` 契約、起動時環境ガード、`playwright.config.ts` の `webServer`、quality / staging / production promote Workflow の実行結果を完了条件に含める。
* [ ] **T-006 Red:** 部員 API の未認証、別テナント、権限不足、入力不正、一覧・登録の失敗テストを先に追加する。
* [ ] **T-007 Green:** Tenant / TenantMembership / Member / GuardianMember / AuditLog の migration、JWT検証、RLS policy、transaction context、テナント解決、部員 API を最小実装する。
* [ ] **T-008 Red/Green:** 部員一覧・登録 UI のテストを先に追加して画面を実装する。
* [ ] **T-009 E2E:** local は test-only Auth、staging は staging Supabase のテスト専用ユーザーを使い、管理者のログインから部員登録までを Playwright で検証する。
* [ ] **T-010 実装後敵対的レビュー:** T-005〜T-009 の成果物に対して越境、PII、認可、入力、環境混同、test-only Auth混入、テスト不足をレビューする。
* [ ] **T-011 指摘修正とリリース判定:** Critical / High をゼロにし、受け入れ条件と CI 全件を再確認する。
* [ ] **T-012 Phase 1追加機能:** 年度繰り上げを別の Red → Green → Refactor 縦切りとして実装し、冪等性・プレビュー・監査ログを検証する。

### 9.2 タスク完了記録

* **T-002レビュー記録（2026-08-22）:** 実装開始不可。Critical 2件、High 9件、Medium 4件。主な指摘は DB レベルの tenant 境界、実行環境の未確定、Phase 1 モデル不足、認可マトリクス不足、公開 R2 URL、CI と TDD 手順の不一致。T-003 で解消方針を追加した。
* **T-004再レビュー記録（2026-08-22）:** 実装開始不可。方針だけでは RLS policy・transaction context・確定スキーマ・CI 定義の証拠として不十分だったため、T-003 に具体的な契約と実行手順を追加する。レビュー成果物は `docs/reviews/plan-adversarial-review-2026-08-22.md` に保存する。
* **T-004第4レビュー記録（2026-08-22、`46023fc`）:** Critical 0件、High 3件。membership 検証から RLS context 設定までの原子性、GuardianMember の Tenant relation、PATCH / DELETE / owner-admin DTO の完全定義が不足しているため不合格。次の再開先は T-003。
* **T-004第5レビュー記録（2026-08-22、`9f49cb4`）:** Critical 0件、High 2件。staging 検証を必須化した production promote Workflow と、環境誤接続・Service Role Key・R2・E2E 認証の fail-closed 検証が不足しているため不合格。次の再開先は T-003。
* **T-004第6レビュー記録（2026-08-22、`30ebace`）:** Critical 0件、High 5件。production migration artifact、フェーズ対応、Member本人の出欠主体、guardian/staff 権限、Attachment状態が不一致のため不合格。次の再開先は T-003。

### 9.3 中断後の再開手順

1. `git status --short --branch` と `git log --oneline -10` で作業ツリーと直近コミットを確認します。
2. この章の最初の未完了タスクと、直下の完了記録にある「次に必要な証拠」を確認します。
3. 変更中のファイル、テスト結果、未コミット差分を破棄せず、同じタスクの続きから作業します。
4. TDD タスクでは、まず対象テストを単独実行して Red / Green の状態を確認してからコードを変更します。
5. 1タスク完了ごとに日本語コミット、テストコマンド、レビュー要否を記録し、次タスクへ移る前に `git status` を確認します。

再開時の最優先は T-003 の残作業です。T-003 が完了し、T-004 の再レビューで Critical / High がゼロになるまでアプリ実装（T-005以降）を開始しません。
