# デプロイ運用ドキュメント敵対的レビュー

レビュー日: 2026-08-22
対象: `docs/deployment-guide.md`、`docs/deployment-adapter.md`

## 判定

Critical 0件、High 0件。デプロイ運用ドキュメントを合格とします。

## 確認項目

- staging は `main` push、production は `workflow_dispatch` とし、productionへ任意の未検証SHAを渡せないことを確認した。
- production checkout前に staging evidence、artifact SHA、SHA-256、GitHub attestationを検証する順序を記録した。
- stagingだけでmigration、test fixture、smoke、E2Eを実行し、productionへfixtureやtest-only Authを持ち込まない境界を記録した。
- `DATABASE_URL`（RLSを回避しないアプリrole）と`DIRECT_URL`（migration owner）の用途を分離した。
- Service Role Keyをproduction APIだけへ限定し、Web bundle・ブラウザ・ログへ渡さない条件を記録した。
- deploy adapterのSHA・環境・HTTPS URL・配置時刻の証跡契約と、配置済みだが証跡がない場合の再実行禁止を記録した。
- migrationは前進適用であり、DB非互換時に無条件のアプリrollbackや手動逆戻しをしない制約を記録した。
- 現行Workflowにproduction自動smoke / rollbackがないことを明記し、配置後の手動確認へ誘導した。
- staging buildの`VITE_SUPABASE_*`をproductionで再ビルドしない設計上、環境別Supabase projectが異なる場合は昇格を禁止する前提を記録した。

## 検証

- Node.js 24で`pnpm test`、`pnpm build`、`pnpm lint`が成功。
- `pnpm lint:workflows`、`pnpm verify:migration-sql`、`pnpm lint:openapi`が成功。
- `git diff --check`が成功し、追跡対象のCRLFは0件。
