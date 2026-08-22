# T-006 部員APIの敵対的レビュー（2026-08-22）

## 対象

- ブランチ: `feature/t006-member-api-red-tests`
- 対象コミット: `c709852..047b28b`
- 観点: 未認証、tenant越境、role昇格、PII、入力、production接続、RLS境界

## 指摘

### High

1. `apps/api/src/server.ts` はSupabase JWT verifier、Prisma membership repository、Member repositoryを構成していない。現状の部員APIはテスト用依存性を注入した場合だけ動作し、production起動では実データへ到達できない。
2. APIのmembership解決と部員操作は別のrepository契約で、同一transaction内のRLS context設定、membership再確認、監査ログを強制していない。アプリ側のtenantId条件だけではDB境界の完了条件を満たさない。
3. 初回migrationの`members_select`はguardianを担当部員に限定せず、tenant context内の全memberを許可する。APIのDTO投影だけに依存すると、別経路のDB queryからPII越境が起きる。

### Medium

1. repository未設定時の停止はfail-closedだが、DB repository実装がないためlocal/stagingの実DB統合テストを実行できない。
2. member操作の監査ログ、検索条件、ページングはAPIのin-memory test double上だけで、Prisma schemaへの実装証跡がない。

## 判定

不合格。High 3件を解消し、JWT・Prisma transaction・RLS guardian policy・監査ログを実装してからT-008へ進む。

## T-007 Green再レビュー（2026-08-22）

### 対象

- ブランチ: `feature/t007-member-api-green`
- 対象コミット: `9f336ff..ed163b5`
- 観点: JWT署名、production依存性構成、transaction内RLS、membership再確認、tenant境界、guardian PII境界、監査ログ、実PostgreSQL

### 指摘の解消確認

- Critical: 0件
- High: 0件
- 初回High 1は、`apps/api/src/server.ts` でSupabase JWKS verifier、Prisma client、membership/member repositoryをproduction起動時に構成し、必須環境変数不足もfail-closedにしたことで解消。
- 初回High 2は、`packages/db/src/index.ts` でmembership解決、`set_config`によるRLS context、操作直前のmembership/role再確認、member操作、監査INSERTを同一transactionにまとめたことで解消。
- 初回High 3は、追加migrationでguardianの`members_select`を`guardian_members`の担当部員に限定し、repositoryと実PostgreSQL統合テストで確認したことで解消。
- Medium 1/2は、PostgreSQL 17上のmigration、owner tenant境界、guardian担当部員限定、owner登録・監査の3統合テストを実行して解消。JWTは署名付きトークンのVitestで検証した。

### 検証証跡

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:unit`
- `pnpm test:integration`（PostgreSQL 17、3件成功）
- `pnpm build`
- `pnpm test:e2e:local`
- `pnpm verify:migration-sql`
- `pnpm verify:database-version --expected-major 17`
- `pnpm lint:workflows`

### 判定

Critical / High 0件で合格。T-008 Red/Greenへ移行可とする。Mediumとして、実Supabase staging接続、staging専用テストユーザー、実deploy adapterの確認はT-009〜T-011の環境固有作業に残す。複数tenantのactive membershipを持つユーザーを一意に解決できない場合はfail-closedとする実装方針を維持する。
