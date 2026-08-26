# Phase 5送迎機能の統合契約

作成日: 2026-08-22

対象仕様: FS-RIDE-001

対象ブランチ: `feature/phase5-ride-operations`

## 範囲

このブランチは、乗車可能数、乗車希望、補助マッチング、手動割当、配車表、Google Mapsリンク、監査ログ、運用メトリクスを機能ディレクトリへ実装します。

中央の`apps/api/src/app.ts`、中央の`apps/web/src/main.tsx`、`packages/db/prisma/schema.prisma`、各パッケージの共有`index`は変更していません。

そのため、送迎テーブルのmigrationと本番APIへのroute登録は統合側の作業として残ります。

機能ブランチ単体で完成扱いにするのは、統合側が後述の契約を満たす実装を接続できる状態までです。

## 実装ファイル

| 層 | ファイル | 責務 |
| --- | --- | --- |
| contract | `packages/contracts/src/ride-contract.ts` | JSON入力の型、件数、文字数、URL基本形式を検証する |
| domain | `packages/domain/src/ride-domain.ts` | Maps URLの許可範囲、定員、不変条件、決定的マッチング、メトリクスを検証する |
| DB repository | `packages/db/src/ride-repository.ts` | tenant条件、transaction-local RLS、所属再確認、plan単位ロック、状態変更、監査INSERTを束ねる |
| API | `apps/api/src/features/ride-operations/ride-service.ts` | roleごとの操作権限とレスポンス投影を固定する |
| API | `apps/api/src/features/ride-operations/ride-routes.ts` | 認証済みコンテキストを受け取り、送迎REST routeを登録する |
| Web | `apps/web/src/features/ride-operations/ride-operations-api.ts` | Bearer tokenとAPIエラーを共通化する |
| Web | `apps/web/src/features/ride-operations/ride-operations-panel.tsx` | 車の登録、乗車希望、結果、管理者向け配車表とメトリクスを表示する |
| テスト | `packages/domain/test/ride.vitest.ts` など | 契約、domain、repository、API、Webの境界を検証する |

## API契約

すべてのrouteは、既存の認証middlewareが解決した`tenantId`、`userId`、`role`をserviceへ渡して利用します。

HTTP入力から`tenantId`、`userId`、運転者識別子を受け取りません。

| Method | Path | 許可ロール | 概要 |
| --- | --- | --- | --- |
| POST | `/api/v1/ride-plans` | owner, admin, staff | 送迎予定を受付中で作成する |
| GET | `/api/v1/ride-plans/:planId` | active membership | 自分に許可された希望と割当結果を取得する |
| POST | `/api/v1/ride-plans/:planId/offers` | active membership | 自分の車と乗車可能数を登録する |
| POST | `/api/v1/ride-plans/:planId/requests` | active membership | 自分または担当部員の乗車希望を登録する |
| POST | `/api/v1/ride-plans/:planId/match` | owner, admin, staff | 補助マッチングを実行する |
| POST | `/api/v1/ride-plans/:planId/assignments` | owner, admin, staff | 希望を指定車へ手動割当する |
| GET | `/api/v1/ride-plans/:planId/dispatch` | owner, admin, staff | 配車表を取得する |
| GET | `/api/v1/ride-plans/:planId/metrics` | owner, admin, staff | 個人を含まない運用集計を取得する |

`GET /api/v1/ride-plans/:planId`の利用者向けレスポンスには、他人の`driverUserId`と`requesterUserId`を含めません。

同じレスポンスには、実行者識別子や監査metadataを含めない公開用の変更履歴を含めます。

管理者向け配車表は、認可済みの管理者だけが取得でき、運転者識別子、乗車希望識別子、人数を含みます。

現在の画面は識別子を配車表の値として表示します。

表示名を追加する場合は、権限付きのプロフィール投影をrepository側でjoinし、送迎テーブルや監査metadataへ氏名を複製しません。

確定公開後の利用者向けsnapshotは、同一tenantのmembershipに保存された`display_name`をDB関数内でjoinし、担当部員・希望者本人・運転者本人に許可された行だけへ`memberName`と`driverName`として投影します。運転者名を`ride_offers`や割当へ複製せず、未設定または所属停止の運転者を含む配車表は確定できません。

確定公開中は、対象部員の`members.name`と運転者の`tenant_memberships.display_name`を変更できません。表示名変更は`PATCH /api/v1/ride-profile/display-name`で確定前に実施し、公開後に変更する場合は送迎予定を再編集へ戻してから行います。この制約により、公開中の表示名がプロフィール更新だけで変わることを防ぎます。既存の`closed`予定も同じprofile routeで表示名を設定してから確定できます。

## マッチングと定員

補助マッチングは、作成時刻、同時刻ならIDの昇順で車と希望を並べるfirst-fitです。

一つの希望を複数の車へ分割しません。

`passengerCount`が車の残席を超える希望は、`unassigned`として残します。

手動割当は、対象車の既存割当を除いた残席をtransaction内で再計算し、超過した場合は409で拒否します。

DB repositoryは`tenantId:planId`をadvisory transaction lockへ渡し、残席の読み取りと割当INSERTを同じtransactionへ束ねます。

統合migrationでは、次のDB制約を追加してください。

- `ride_offers.capacity`は1以上20以下とする。
- `ride_requests.passenger_count`は1以上8以下とする。
- 一つのtenantにおけるplan、offer、request、assignmentの参照はtenant付き複合外部キーで固定する。
- 一つの乗車希望には有効なassignmentを一つだけ許可する。
- assignmentの人数はrequestの人数と一致させる。
- 退部済みmemberへの新規希望を拒否する。
- 割当人数の合計がofferのcapacityを超えないよう、repositoryと同じplanロックを使うtriggerまたは遅延検査を追加する。

DB制約がrepositoryのロックを置き換えるわけではありません。

外部writerやmigration前の直接SQLが不変条件を破らないために、両方を導入します。

## DB migrationの論理契約

Prisma schemaは共有ファイル境界のためこのブランチでは変更していません。

統合側は次の論理テーブルをmigrationへ追加し、既存の`tenants`、`members`、`audit_logs`とtenant付きで関連付けます。

| テーブル | 必須列 | 状態 |
| --- | --- | --- |
| `ride_plans` | `id`, `tenant_id`, `title`, `departure_at`, `pickup_maps_url`, `destination_maps_url`, `status`, `created_at` | `draft`, `open`, `closed`, `finalized` |
| `ride_offers` | `id`, `tenant_id`, `plan_id`, `driver_user_id`, `capacity`, `status`, `created_at` | `open`, `cancelled` |
| `ride_requests` | `id`, `tenant_id`, `plan_id`, `member_id`, `requester_user_id`, `passenger_count`, `status`, `created_at` | `pending`, `assigned`, `unassigned`, `cancelled` |
| `ride_assignments` | `id`, `tenant_id`, `plan_id`, `request_id`, `offer_id`, `passenger_count`, `created_at` | assignmentの存在で表す |

Maps URL列は最大2048文字のnullable文字列とします。

URLの最終的な安全性はDBのURL型で保証せず、contractとdomainで保証します。

`audit_logs.resource_type`は`ride_plan`、actionは次の値を初期値とします。

- `ride.plan.create`
- `ride.offer.create`
- `ride.request.create`
- `ride.match.execute`
- `ride.assignment.update`

監査metadataには対象ID、人数、状態、割当件数だけを保存します。

氏名、住所、電話番号、Maps URL、検索語、自由記述は保存しません。

## RLSと認可

既存のtransaction-local設定`app.tenant_id`、`app.user_id`、`app.role`を送迎テーブルにも適用します。

RLSだけに依存せず、repositoryの全SQLへtenant条件を含めます。

guardianが乗車希望を登録できるmemberは、`guardian_members`で同じtenantかつ同じuserへ関連付いたmemberだけです。

owner、admin、staffの管理操作は、書き込みtransaction内で`tenant_memberships`のactive状態とroleを再確認します。

認証middlewareと送迎route登録を統合する例は次の形です。

```ts
const rideRepository = createRideRepository(prisma);
registerRideRoutes(app, {
  service: createRideService(rideRepository),
  getAuth: (context) => {
    const auth = context.get('auth');
    return auth
      ? {
          tenantId: auth.membership.tenantId,
          userId: auth.userId,
          role: auth.membership.role,
        }
      : null;
  },
});
```

この接続は、既存のJWT検証とactive membership解決の後ろへ置きます。

`getAuth`をHTTP body、query、pathの値から作る実装は許可しません。

## Google Mapsリンク

受け付けるのはHTTPSの`www.google.com/maps`または`maps.google.com`だけです。

username、password、port、fragmentを含むURLは拒否します。

Webは同じdomain検証を通過したURLだけを`target="_blank"`、`rel="noreferrer"`付きで表示します。

Google Maps APIキーや住所検索APIは使用しません。

リンク先の地図情報はGoogle側の外部状態であり、CoCoLoは到着先の正しさを保証しません。

## メトリクス

`GET /metrics`は次の集計だけを返します。

- 車の台数
- 乗車可能数
- 希望人数
- 割当済み人数
- 未割当人数
- 割当率

希望人数が0の場合の割当率は1とします。

個人識別子をメトリクス、監査metadata、エラー内容へ含めません。

## 統合前チェックリスト

- [ ] ride用migrationを追加し、PostgreSQLへ適用した。
- [ ] ride用RLS policyとtenant付き複合外部キーを追加した。
- [ ] assignmentの一意性と定員不変条件をDB側でも検査した。
- [ ] `app.ts`へ認証middleware後のroute登録を追加した。
- [ ] `main.tsx`から権限済みのmember optionsを渡してpanelを表示した。
- [ ] 実PostgreSQLでtenant越境、guardian担当外、定員競合、監査原子性を検証した。
- [ ] stagingで管理者とguardianの表示差分、Maps拒否、配車表のPII範囲を確認した。

## 検証済み範囲

次の専用テストを実行しています。

```text
packages/domain/test/ride.vitest.ts       5 tests passed
packages/db/test/ride-repository.vitest.ts 2 tests passed
apps/api/test/ride-operations.test.mjs    26 tests passed（API全体のunit実行結果）
apps/web/src/features/ride-operations/ride-operations-api.vitest.ts 3 tests passed
```

実DBのride migrationはこのブランチに含まれないため、実PostgreSQLでのride CRUD検証は統合migration完了後に実施します。
