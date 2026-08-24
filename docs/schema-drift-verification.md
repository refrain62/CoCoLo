# schema drift 検査

## 目的

`packages/db/prisma/schema.prisma`、migration SQL、実DBの `_prisma_migrations` 履歴を同じ正本として検査する。
検査に必要なDBへ接続できない場合も、成功扱いにはせず失敗する。

## 検査内容

`pnpm verify:schema-drift` は次をすべて満たす場合だけ成功する。

1. `migration_lock.toml`、schema、全migration SQLが存在し、PostgreSQL用の形式である。
2. `packages/db/prisma/migrations.sha256` と、現在のmigration SQLのパス・SHA-256が完全一致する。編集・追加・削除は失敗する。
3. `DIRECT_URL`で参照した `_prisma_migrations` の件数、適用順、migration名、checksum、`finished_at`、`rolled_back_at` が正本と完全一致する。未適用、余分な履歴、改変、未完了、rollback済みは失敗する。
4. CIで全migrationを適用したShadow DBとschema datamodelに構造差分がなく、`DIRECT_URL`の実DBからschema datamodelへの差分もない。手動ALTER等の実DB driftは失敗する。
5. `SHADOW_DATABASE_URL` が `DATABASE_URL` / `DIRECT_URL` と同じ host・port・database を指さず、専用role・host・database・host/port/databaseペアの許可リストに一致する。`staging` / `production` ではアプリDB・migration DBと別host、TLSを必須とする。
6. Shadow roleのSCRAM password、DB/object owner、ACL、default privileges、`pg_auth_members`、RLSを実DBから許可集合と両方向で照合する。PUBLIC grant、RLS無効化、危険DDLは失敗する。

Prisma 6.10のRust engineは`PGPASSFILE`を認証情報として解決しないため、Prisma CLIのSCRAM URLはpasswordを含めた環境変数として注入し、argvには渡さない。`psql`と接続ライブラリは共通の0600 pgpassを使う。Shadow DBはPrisma `migrate deploy`で空DBへ再構築し、passwordfulな`DATABASE_URL`・`DIRECT_URL`環境変数をShadowへ差し替えた`--from-schema-datasource`でmigration適用後の実体とschemaを比較する。`DIRECT_URL`もargvへ渡さず、schema datasourceの環境変数で実DBとschemaを比較する。staging / productionはTLSを有効にした外部認証方式を別途構成する。
ログに接続URLや認証情報を出力してはいけない。

## CI接続

`.github/workflows/schema-drift.yml` はPRごとに、アプリ検査用とShadow専用の分離PostgreSQL service（いずれもSCRAM password認証、Shadowはhost側5433番ポート）を起動する。0600 pgpassを先に作成し、Shadow roleのpassword・URL・credential fileがPrisma CLIで実際に使えることを`migrate deploy`と`migrate diff`で検証する。Shadow roleは管理者権限なしで作成し、属性・owner・ACL・membership・RLSを実DBで検査してからPrisma CLIを実行する。
Shadow serviceには、既存migrationの`GRANT ... TO cocolo_app`を成立させるためだけに`NOLOGIN`の互換roleも作成する。検査プロセスが使う接続roleは常にSCRAM password付きの`cocolo_shadow`であり、互換roleを共有認証情報として使わない。
`BASE_SHA`を取得できない、migration checksumを読めない、Prisma ClientまたはDBへ接続できない場合はfail-closedでジョブを失敗させる。

CIの接続先は次の分離を守る。

| 用途 | host:port/database | role |
| --- | --- | --- |
| アプリ検査対象 | `localhost:5432/cocolo_test` | `cocolo_app` |
| migration履歴照合 | `localhost:5432/cocolo_test` | `postgres` |
| Prisma shadow（専用service） | `localhost:5433/cocolo_shadow` | `cocolo_shadow` |

本番相当の検査では `DATABASE_URL` / `DIRECT_URL` 自体が本番接続先になるため、`SHADOW_DATABASE_ALLOWED_HOSTS`、`SHADOW_DATABASE_ALLOWED_DATABASES`、`SHADOW_DATABASE_ALLOWED_TARGETS`を専用shadow環境の値だけに制限し、shadow hostも本番DBと別にする。

## ローカル実行

PostgreSQLを起動し、`DATABASE_URL`、`DIRECT_URL`、専用DBのpasswordful`SHADOW_DATABASE_URL`、`SHADOW_DATABASE_ROLE`、host/dbペアを含む許可リストを設定する。`APP_ENV`は必須で、localは`sslmode=disable`、staging / productionはTLS用の`sslmode`を明示する。

```text
pnpm test:schema-drift
pnpm test:database-integrity
pnpm verify:schema-drift
```

実DBを利用できない環境で最後のコマンドが失敗するのは仕様である。接続失敗を無視したり、`--skip`相当のフラグで品質ゲートを通過させたりしてはいけない。
