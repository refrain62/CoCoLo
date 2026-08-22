# ステージング・本番デプロイ運用手順

この文書は、CoCoLo の staging / production へのデプロイ手順と、デプロイ前後に確認すべき環境・成果物・データベースの条件をまとめた運用手順です。

Workflow の正本は次のファイルです。

- [staging-deploy.yml](../.github/workflows/staging-deploy.yml): `main` への push を起点に staging へ配置する。
- [production-promote.yml](../.github/workflows/production-promote.yml): staging で検証済みの artifact SHA を手動で production へ昇格する。
- [deployment-adapter.md](deployment-adapter.md): provider 固有の配置 adapter と配置記録の契約。

## 1. デプロイの基本方針

デプロイは、レビュー済みの変更を `main` へ反映した後、staging で検証した同一 commit SHA の成果物だけを production へ昇格させます。

```text
feature/*
   │  PRレビュー・品質ゲート
   ▼
develop
   │  リリース候補を承認済みの手順でmainへ反映
   ▼
main ── push ──▶ staging deploy
                    │ migration / smoke / E2E / artifact証跡
                    ▼
              production promote
              （同一SHA・再ビルドなし）
```

- `main` や `develop` へ直接 commit / push しない。通常の変更は専用ブランチから PR で反映する。
- staging Workflow は `main` への push で自動起動する。`develop` への push では起動しない。
- production Workflow は `workflow_dispatch` による手動起動だけとし、入力された 40 桁 SHA に対応する staging 成功記録を先に検証する。
- production ではアプリや migration を再ビルドしない。staging で作成した `release.tar.gz`、manifest、migration を検証してそのまま使用する。
- production のデータベースへ staging fixture や test-only Auth を持ち込まない。`db:seed:test` と Playwright E2E は staging / local 専用である。

## 2. GitHub Environment の設定

`staging` と `production` の GitHub Environment を作成し、protected environment の承認者・branch 制限・secret を設定します。secret の値はログへ出力せず、Workflow の `secrets` と `vars` の用途を混在させません。

### staging

| 種別 | 名前 | 設定内容 |
| --- | --- | --- |
| Secret | `DATABASE_URL` | RLS を回避しない `cocolo_app` のアプリ接続URL。通常のAPI接続に使う。 |
| Secret | `DIRECT_URL` | migration owner 接続URL。role準備とmigration管理に使う。 |
| Secret | `SUPABASE_ANON_KEY` | staging Supabase の anon key。ブラウザへ公開され得る値だが、GitHub上ではsecretとして管理する。 |
| Secret | `STAGING_DEPLOY_ADAPTER` | staging providerへ配置する実行可能なadapter。引数は[adapter契約](deployment-adapter.md)に従う。 |
| Secret | `STAGING_E2E_TEST_EMAIL` | staging専用E2Eユーザーのメールアドレス。通常ユーザーやproductionユーザーを指定しない。 |
| Secret | `STAGING_E2E_TEST_PASSWORD` | staging専用E2Eユーザーのパスワード。 |
| Variable | `SUPABASE_URL` | staging Supabase projectのURL。HTTPSを使う。 |
| Variable | `SUPABASE_JWKS_URL` | staging SupabaseのJWKS URL。`SUPABASE_URL`のprojectと一致させる。 |
| Variable | `PUBLIC_APP_URL` | staging Webアプリの公開HTTPS URL。 |
| Variable | `PUBLIC_APP_URL_ALLOWLIST` | コード側のstaging固定allowlistに含まれるURLだけを指定する。任意のURL追加は拒否する。 |
| Variable | `RATE_LIMIT_ADAPTER_MODULE` | providerをlockfileとallowlistへ追加した場合だけ設定する。現時点は実provider未同梱のため未設定。 |

Workflow内で次の値は固定されており、Environment variableとして別値を設定しません。

- `APP_ENV=staging`
- `R2_BUCKET=cocolo-staging-private`
- `SUPABASE_ALLOWED_URL=SUPABASE_URL`
- `SUPABASE_ALLOWED_JWKS_URL=SUPABASE_JWKS_URL`
- `SUPABASE_URL`、`SUPABASE_JWKS_URL`、`PUBLIC_APP_URL` はコード側のstaging固定allowlistにも一致させる。
- `RATE_LIMIT_STORE=distributed`
- `RATE_LIMIT_FAIL_CLOSED=true`

現時点では実Redis providerをrepositoryへ同梱していないため、stagingの `RATE_LIMIT_ADAPTER_MODULE` は未設定です。
値を設定しても、provider packageがlockfileとadapter allowlistの両方にない限り、`pnpm verify:environment` は停止します。

### production

| 種別 | 名前 | 設定内容 |
| --- | --- | --- |
| Secret | `DATABASE_URL` | RLS を回避しない `cocolo_app` の本番アプリ接続URL。 |
| Secret | `DIRECT_URL` | 本番migration owner接続URL。 |
| Secret | `SUPABASE_ANON_KEY` | production Supabase の anon key。 |
| Secret | `SUPABASE_SERVICE_ROLE_KEY` | APIサーバー専用のService Role Key。Webのビルド変数やブラウザへ絶対に渡さない。 |
| Secret | `PRODUCTION_DEPLOY_ADAPTER` | production providerへ配置する実行可能なadapter。 |
| Variable | `SUPABASE_URL` | production Supabase projectのURL。stagingと異なる場合は後述の昇格前提を満たすこと。 |
| Variable | `SUPABASE_JWKS_URL` | production SupabaseのJWKS URL。 |
| Variable | `PUBLIC_APP_URL` | production Webアプリの公開HTTPS URL。 |
| Variable | `PUBLIC_APP_URL_ALLOWLIST` | コード側のproduction固定allowlistに含まれるURLだけを指定する。任意のURL追加は拒否する。 |
| Variable | `RETIRED_DATA_RETENTION_DAYS` | 退部データを保持する日数。運用上の保存期間を整数で設定する。 |
| Variable | `AUDIT_LOG_RETENTION_DAYS` | 監査ログを保持する日数。運用上の保存期間を整数で設定する。 |
| Variable | `RATE_LIMIT_ADAPTER_MODULE` | providerをlockfileとallowlistへ追加した場合だけ設定する。stagingと同じmoduleを無条件に共有しない。現時点は未設定。 |

Workflow内で次の値は固定されており、Environment variableとして別値を設定しません。

- `APP_ENV=production`
- `R2_BUCKET=cocolo-production-private`
- `SUPABASE_ALLOWED_URL=SUPABASE_URL`
- `SUPABASE_ALLOWED_JWKS_URL=SUPABASE_JWKS_URL`
- `SUPABASE_URL`、`SUPABASE_JWKS_URL`、`PUBLIC_APP_URL` はコード側のproduction固定allowlistにも一致させる。
- `RATE_LIMIT_STORE=distributed`
- `RATE_LIMIT_FAIL_CLOSED=true`

productionも実provider未同梱のため、`RATE_LIMIT_ADAPTER_MODULE` 未設定では起動と昇格を継続しません。
providerを追加する場合は、stagingとproductionのRedis endpoint、Secret、監視、namespaceを分離し、実Redis検証の記録をstaging evidenceへ残します。

### Webのビルド設定に関する重要な前提

staging Workflow は `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` に staging Environment の値を渡して Web をビルドします。production promote は再ビルドしないため、productionへ昇格するartifact内のWebは staging build 時の Supabase client 設定を保持します。

したがって、次のいずれかを満たさない限り production promote を実行しません。

1. staging と production が同じ Supabase project / client endpoint を使う。
2. provider側の公開URL・環境設定が、stagingでビルドされたWebのSupabase client設定と互換であることを事前に確認済みである。

staging と production でSupabase projectが分離され、Webも別のSupabase URLへ接続する必要がある場合、現行の「staging artifactを再ビルドなしで昇格する」Workflowはそのまま使用できません。環境別の実行時設定注入またはartifact生成方式を変更し、Workflow・検証・レビューを更新してから運用します。

## 3. deploy adapter の準備

adapterはリポジトリにprovider実装を含めず、GitHub Environmentのsecretから実行します。`spawnSync` は `shell: false` でadapterを起動するため、secretにはシェルパイプラインではなく実行可能ファイルのパスまたは実行コマンドを設定します。

adapterには次の引数が渡されます。

```text
--artifact-sha <40桁の小文字commit SHA>
--release-dir <release directory>
--environment staging|production
```

配置完了後、adapterは `--release-dir/deployment-record.json` を作成します。

```json
{
  "status": "success",
  "artifactSha": "配置したcommit SHA",
  "environment": "stagingまたはproduction",
  "deployedUrl": "httpsの公開URL",
  "deployedAt": "ISO 8601の配置時刻"
}
```

次の場合は配置成功として扱いません。

- adapterが未設定、起動失敗、または終了ステータスが0以外。
- 配置記録がない、JSONとして読めない、`status` が `success` でない。
- 記録のartifact SHAまたは環境名がWorkflowの期待値と異なる。
- `deployedUrl` がHTTPSでない、または `deployedAt` がない。

adapterがprovider上では配置済みなのに配置記録の生成だけ失敗した場合、同じadapterを無条件で再実行しません。provider側の実状態、対象SHA、配置URLを確認してから再試行します。

## 4. staging デプロイ手順

### 4.1 事前確認

1. 変更PRのレビュー、品質ゲート、敵対的レビューを完了する。
2. リリース対象のcommit SHAを確定する。Workflowは `main` のpush SHAをartifact SHAとして使う。
3. `staging` Environmentのsecret / variable、Supabase専用E2Eユーザー、deploy adapterが設定済みであることを確認する。
4. productionへ昇格する可能性がある場合、WebのSupabase client設定に関する前提も確認する。

ローカルではNode.js 24を使用し、最低限次を実行します。

```powershell
node --version
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm verify:production-bundle
```

### 4.2 起動と処理順序

承認済みのリリース候補を `main` へ反映すると、`.github/workflows/staging-deploy.yml` が起動します。Workflowは次の順序で処理します。

1. pnpm 10.26.0 と Node.js 24 を準備し、`pnpm install --frozen-lockfile` を実行する。
2. `verify:environment --expected staging` で環境名、DB URL、Supabase URL/JWKS、R2 bucket、公開URL、allowlist、分散rate-limit adapter設定を検証する。
3. `db:prepare:test` をmigration owner接続で実行し、RLSを回避しない `cocolo_app` roleとtable grantを準備する。
4. stagingへ Prisma migrationを適用する。
5. PostgreSQL major version 17を検証する。
6. `db:seed:test` でstaging専用のtenant / role / guardian fixtureを冪等投入する。
7. API/Web/DB schema/migrationをビルドして `release.tar.gz`、manifest、SHA-256 checksumを作成する。
8. artifact SHAとSHA-256を検証し、GitHub build provenance attestationを付与する。
9. staging deploy adapterでartifactを配置し、配置記録を検証する。
10. staging URLへPlaywright E2E smokeを実行する。ログイン、部員登録、Bearer token送信を確認する。
11. 複数API instanceからの同時リクエストで分散rate-limitの原子性と障害時の `503` を確認する。
12. migration、smoke、E2E、配置URL、artifact SHAを `.evidence/evidence.json` へ束ねる。
13. release artifactとstaging evidenceをGitHub Actions artifactとして保存する。保存期間は14日である。

配置後は、Workflowの全stepが成功し、次の値を記録します。

- `main` のcommit SHA
- staging Workflowのrun ID
- `release-<SHA>` artifactの存在
- `staging-evidence-<SHA>` artifactの存在
- 配置記録のURLと配置時刻

### 4.3 staging失敗時

- 環境検証失敗: Environmentの値を修正し、同じcommitを無理に再実行せず、修正後のcommitで再度検証する。
- migration失敗: DBのmigration状態とproviderログを確認する。SQLを手編集して再実行しない。
- fixture失敗: staging専用fixtureの既存データ、DB接続role、migration適用状態を確認する。productionには同じseedを実行しない。
- adapter / E2E失敗: 配置先の実状態、公開URL、Supabase E2Eユーザー、APIログを確認する。evidenceが作成されていないSHAはproductionへ昇格できない。

## 5. production promote 手順

### 5.1 昇格前の必須条件

次の条件をすべて満たしたartifact SHAだけを昇格対象にします。

- `main` のcommit SHAである。
- 対応するstaging Workflowが成功している。
- stagingでmigration、smoke、E2Eがすべて成功している。
- `release-<SHA>` と `staging-evidence-<SHA>` が取得できる。保存期間14日を超えたartifactは現行Workflowから昇格できない。
- release.tar.gzのSHA-256が `artifact.sha256` と一致する。
- staging Workflow由来のGitHub build provenance attestationを検証できる。
- production Environmentのprotected approvalが完了している。
- productionのSupabase URLと、stagingでビルドしたWebのclient設定が昇格前提を満たしている。

### 5.2 手動起動

GitHub UIの `production-promote.yml` から `artifact_sha` に40桁の小文字SHAを入力して実行します。CLIを使う場合は次のようにします。

```powershell
$ARTIFACT_SHA = '<mainの40桁commit SHA>'
gh workflow run production-promote.yml --ref main --field artifact_sha=$ARTIFACT_SHA
gh run list --workflow production-promote.yml --limit 5
gh run watch <production-run-id>
```

### 5.3 Workflowの検証・配置順序

1. 入力SHAの形式を確認する。
2. `main` の同一SHAに対応するstaging成功runを検索し、Workflow path、branch、head SHAを確認する。
3. staging evidenceとrelease artifactをダウンロードする。
4. evidenceのmigration / smoke / E2Eがsuccessであることを確認する。
5. release.tar.gzのSHA-256とGitHub attestationを、production secretを読み込む前に検証する。
6. 検証済みSHAをcheckoutし、artifactを展開する。ここで再ビルドしない。
7. production環境、DB URL、Supabase URL/JWKS、R2 bucket、公開URL、保持期間、Service Role Key、分散rate-limit adapter設定を検証する。
8. artifactに同梱されたschema / migrationだけを使って `prisma migrate deploy` を実行する。
9. production deploy adapterでartifactを配置し、production配置記録を検証する。

production Workflowには `concurrency: production-migration` が設定されているため、production migrationの同時実行は許可しません。既に別のproduction promoteが実行中の場合は、完了または停止理由を確認してから次を実行します。

### 5.4 配置後の手動確認

現行Workflowにはproduction向けの自動E2E smokeと自動rollbackはありません。配置成功後、productionのtest fixtureやtest-only Authを使わず、運用で次を確認します。

- 配置記録のURLがproductionのHTTPS URLである。
- Webのログイン画面、APIのhealth endpoint、主要な認証済み画面が応答する。
- APIログにstaging URL、staging Supabase project、local test tokenが現れていない。
- R2が`cocolo-production-private`を使い、公開バケットやstaging bucketへ接続していない。
- Service Role Keyがブラウザのbundle、レスポンス、ログへ出ていない。
- 監査ログ、エラー率、DB接続、migration状態、providerのデプロイ状態を確認する。

問題があれば、利用者への影響と個人情報の露出有無を確認し、production promoteを追加実行せずにインシデント対応へ切り替えます。

## 6. ロールバックと障害対応

### アプリケーションだけを戻す場合

過去にstaging検証済みで、artifactとevidenceが保存期間内に存在し、現在のDB schemaと後方互換であるSHAを選びます。そのSHAを同じproduction promote Workflowへ入力します。

```powershell
$ROLLBACK_SHA = '<以前のstaging検証済み40桁SHA>'
gh workflow run production-promote.yml --ref main --field artifact_sha=$ROLLBACK_SHA
```

### migrationが関係する場合

本番migrationは前進適用であり、`prisma migrate down` や手動SQLによる逆戻しはこの手順に含めません。過去artifactへ戻す前に、次を確認します。

- 現在のDB schemaが過去アプリと互換である。
- 直前migrationがデータ削除や不可逆変換を含まない。
- 互換性がない場合は、アプリrollbackを実行せず、DBバックアップ・復旧手順を含むインシデント対応を開始する。

adapterが途中まで配置した可能性がある場合は、providerの実状態を確認してから再試行します。`git push --force`、production DBの直接書き換え、migration履歴の削除は行いません。

## 7. 運用コマンド一覧

| 目的 | コマンド |
| --- | --- |
| Workflow定義を検証 | `pnpm lint:workflows` |
| 環境値を検証 | `pnpm verify:environment --expected staging` または `production` |
| migration SQLを検証 | `pnpm verify:migration-sql` |
| artifactを作成 | `pnpm build && pnpm package:release --artifact-sha <SHA> --output .release` |
| artifactを検証 | `pnpm verify:release --release-dir .release --artifact-sha <SHA>` |
| stagingへ配置 | `pnpm deploy:staging --artifact-sha <SHA> --release-dir .release` |
| productionへ配置 | `pnpm deploy:production --artifact-sha <SHA> --release-dir .release` |
| staging E2E | `pnpm test:e2e:staging` |
| production bundleの混入検査 | `pnpm verify:production-bundle` |

手動で `deploy:production` を実行する場合も、production Workflowと同じく、staging evidence・artifact SHA・SHA-256・attestation・production環境検証を先に完了させます。これらを省略してadapterだけを直接実行してはいけません。

## 8. デプロイ完了記録

各環境のデプロイ完了時は、次をPRまたは運用記録へ残します。secret、access token、DB接続URL、個人情報は記録しません。

```text
環境: staging / production
artifact SHA:
Workflow run ID:
staging run ID（productionのみ）:
配置URL:
配置時刻:
migration結果: success / failure
smoke・E2E結果: success / failure / production未実行
SHA-256・attestation検証: success / failure
手動確認者:
備考・障害対応ID:
```
