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
