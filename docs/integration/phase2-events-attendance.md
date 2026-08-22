# Phase 2の予定と出欠を統合する

この文書は、FS-EVT-001〜003の機能モジュールを既存アプリケーションへ接続するための統合契約です。

機能モジュールは中央登録点から分離しているため、このブランチでは`apps/api/src/app.ts`、`apps/web/src/main.tsx`、`packages/db/prisma/schema.prisma`、共有`index`を変更していません。

## 実装範囲

次のファイル群がPhase 2の実装です。

* `apps/api/src/features/events/event-api.ts`
* `apps/web/src/features/events/events-api.ts`
* `apps/web/src/features/events/events-page.tsx`
* `apps/web/src/features/events/events.css`
* `packages/contracts/src/event-contract.ts`
* `packages/domain/src/event-domain.ts`
* `packages/db/src/event-repository.ts`
* `packages/db/prisma/migrations/20260822130000_phase2_events_attendance/migration.sql`

`EventRepository`はPrismaの生成モデルへ依存せず、追加テーブルへSQLでアクセスします。

そのため、将来`schema.prisma`へイベントモデルを追加する場合も、同じテーブル名、列名、複合外部キー、unique制約、RLS policyを維持してください。

## APIの登録点

`createEventsApp`は`/`を予定一覧、`POST /`を予定登録、`PATCH /:eventId`を予定編集として公開します。

既存APIへ接続するときは、次のように`/api/v1/events`へrouteします。

```ts
import { createEventsApp } from './features/events/event-api.js';
import { createEventRepository } from '@cocolo/db/events';

const eventRepository = createEventRepository(prisma);

app.route(
  '/api/v1/events',
  createEventsApp({
    verifyToken,
    membershipRepository,
    eventRepository,
  }),
);
```

feature app自身がBearer token、有効期限、active membershipを検証します。

既存`createApp`の認証middlewareを二重適用する場合は、feature appの認証結果と所属解決結果が同じrepositoryを参照することを確認してください。

次のAPIはイベントroute配下にあります。

| メソッド | パス | 用途 | 権限 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/events?from=&to=` | 期間内の予定一覧 | 全権限 |
| `POST` | `/api/v1/events` | 予定登録 | `owner`、`admin`、`staff` |
| `PATCH` | `/api/v1/events/:eventId` | 予定編集 | `owner`、`admin`、`staff` |
| `PUT` | `/api/v1/events/:eventId/attendance` | 出欠回答または管理修正 | `guardian`、`owner`、`admin`、`staff` |
| `GET` | `/api/v1/events/:eventId/attendance/summary` | 出欠集計 | `owner`、`admin`、`staff` |

レスポンスDTOへ`tenantId`、回答者の`userId`、監査情報は返しません。

## Webの登録点

`EventsPage`は`role`と担当部員の表示用IDおよび氏名をpropsで受け取ります。

認証済み画面へ接続するときは、`main.tsx`で既存sessionのaccess tokenを`createEventsApi`へ渡し、所属情報から解決したroleを`EventsPage`へ渡してください。

担当部員の一覧は既存の部員APIから取得し、guardianへは担当部員だけを渡します。

画面は月間表示と週間表示の切替、予定種別のラベル、予定登録、出欠回答、管理者向け集計を提供します。

予定種別はラベルと左罫線の両方で示すため、色だけに依存しません。

## DBとRLSの保証

`events`と`attendance_responses`は`tenant_id`を持ち、予定と回答の外部キーは`tenant_id`を含む複合キーです。

この複合キーによって、別チームの予定へ別チームの部員回答を紐付けられません。

repositoryは各transactionの冒頭で`app.tenant_id`、`app.user_id`、`app.role`をtransaction-localへ設定し、active membershipを同じtransactionで再確認します。

connection poolを再利用しても、前の要求のtenant contextが次の要求へ残らない設計です。

RLSは予定の読み取りをtenantへ限定し、予定の作成および編集を`owner`、`admin`、`staff`へ限定します。

出欠回答は、管理権限を持つ利用者、または`guardian_members`で担当関係が確認できるguardianだけが書き込めます。

guardianの担当外部員への回答はrepositoryの確認とRLSの両方で拒否します。

## 日時と締切

APIはISO 8601の日時を受け取り、repositoryは`Date`としてUTCで保存します。

終了時刻は開始時刻より後、出欠締切は開始時刻以前、集合時刻は開始時刻以前でなければなりません。

締切判定は`client`の時計ではなく、DBの`now()`と保存済み`attendance_deadline`を比較します。

guardianの締切後変更は409で拒否します。

`owner`、`admin`、`staff`の締切後修正には理由を必須とし、`attendance_responses.correction_reason`と監査ログへ保存します。

同じイベント、同じ回答者、同じ部員の組み合わせにはunique制約を置き、repositoryは`upsert`で同じ行を更新します。

管理者が回答者を指定しない修正では、既存回答があればその回答者を保持します。

## migrationの適用

`packages/db/prisma/migrations/20260822130000_phase2_events_attendance/migration.sql`はPhase 1 migrationの後に適用してください。

このmigrationはPrisma schemaのモデル定義を変更しないため、現ブランチのrepositoryはSQLを利用します。

stagingへ適用する前に、RLS用の`cocolo_app` roleへ`events`と`attendance_responses`の`SELECT`、`INSERT`、`UPDATE`権限があることを確認してください。

productionへ昇格する際は、migration適用後にtenant A/B、owner/admin/staff/guardian、締切前後、一意回答の統合テストを実行してください。

## 検証

次の専用検証を実行します。

```text
pnpm test:contracts
pnpm --filter @cocolo/domain test
pnpm --filter @cocolo/api test:unit
pnpm exec vitest run apps/web/src/features/events/events-api.vitest.ts
pnpm verify:migration-sql
```

`apps/api/test/integration/events-db.test.ts`は実PostgreSQLとPhase 2 migration、テストseedを使う統合テストです。

Node標準TypeScript実行へ移行した`origin/develop`の`d7e5f16`を取り込み、Phase 2の契約と専用テストも`.ts`へ統一しています。

## 統合時に残る作業

中央APIへrouteを登録し、productionのPrisma migration適用手順へPhase 2 migrationを追加する必要があります。

中央Webへ`EventsPage`を登録し、roleと担当部員を既存の認証経路および部員取得経路から渡す必要があります。

OpenAPI生成元への予定と出欠path追加、実stagingでのcalendar表示とSupabase Auth結合、Playwright E2Eは中央登録後の作業です。

予定の案内画像は将来の非公開添付IDだけを保持し、公開URLの保存と配布は行いません。

この機能はLINE通知、R2実体保存、送迎割当を実装範囲に含めません。
