# schema drift 検査

## 目的

`packages/db/prisma/schema.prisma`、migration SQL、実DBの `_prisma_migrations` 履歴を同じ正本として検査する。
検査に必要なDBへ接続できない場合も、成功扱いにはせず失敗する。

## 検査内容

`pnpm verify:schema-drift` は次をすべて満たす場合だけ成功する。

1. `migration_lock.toml`、schema、全migration SQLが存在し、PostgreSQL用の形式である。
2. `packages/db/prisma/migrations.sha256` と、現在のmigration SQLのパス・SHA-256が完全一致する。編集・追加・削除は失敗する。
3. `DIRECT_URL`で参照した `_prisma_migrations` の件数、適用順、migration名、checksum、`finished_at`、`rolled_back_at` が正本と完全一致する。未適用、余分な履歴、改変、未完了、rollback済みは失敗する。
4. Prismaのmigrationからshadow DBへ再構築した結果とschema datamodelに構造差分がない。
5. `SHADOW_DATABASE_URL` が `DATABASE_URL` / `DIRECT_URL` と同じ host・port・database を指さず、専用role・host・databaseの許可リストに一致する。`staging` / `production` ではアプリDB・migration DBと別hostも必須とする。

Prisma CLIへ渡すShadow DB URLにはパスワードを含めず、認証情報をargvへ出さない。
local CIはPostgreSQL serviceのtrust認証を使い、staging / productionはmTLSなどの外部認証を使う。
ログに接続URLや認証情報を出力してはいけない。

## CI接続

`.github/workflows/schema-drift.yml` はPRごとに、固定したPostgreSQL serviceで専用roleとshadow DBを作成し、空のテストDBへmigrationを適用してから検査する。
`BASE_SHA`を取得できない、migration checksumを読めない、Prisma ClientまたはDBへ接続できない場合はfail-closedでジョブを失敗させる。

CIの接続先は次の分離を守る。

| 用途 | database | role |
| --- | --- | --- |
| アプリ検査対象 | `cocolo_test` | `cocolo_app` |
| migration履歴照合 | `cocolo_test` | `postgres` |
| Prisma shadow | `cocolo_shadow` | `cocolo_shadow` |

本番相当の検査では `DATABASE_URL` / `DIRECT_URL` 自体が本番接続先になるため、`SHADOW_DATABASE_ALLOWED_HOSTS` と `SHADOW_DATABASE_ALLOWED_DATABASES` を専用shadow環境の値だけに制限し、shadow hostも本番DBと別にする。

## ローカル実行

PostgreSQLを起動し、`DATABASE_URL`、`DIRECT_URL`、専用DBの `SHADOW_DATABASE_URL`、`SHADOW_DATABASE_ROLE`、許可リストを設定する。

```text
pnpm test:schema-drift
pnpm test:migration-integrity
pnpm verify:schema-drift
```

実DBを利用できない環境で最後のコマンドが失敗するのは仕様である。接続失敗を無視したり、`--skip`相当のフラグで品質ゲートを通過させたりしてはいけない。
