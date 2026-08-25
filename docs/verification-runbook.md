# 検証手順書

更新日：2026-08-25

## 目的

この文書は、PR、local実DB、staging、production昇格で共通に守る検証順と停止条件を定めます。

機能の受け入れ条件は[機能仕様書](functional-specification.md)、未完了の対象は[中断再開タスクリスト](resume-task-list.md)を参照します。

## 前提

- Node.jsは`24.12.0`以上`25`未満、pnpmは`10.26.0`を使う。
- 検証は同時実行しない。依存関係の再構成中にbuildやtestを開始しない。
- local、staging、productionのAuth、DB、R2、LINE、rate limit providerを混在させない。
- productionの資格情報、個人情報、Webhook raw bodyをlocalログやレポートへ出さない。
- 実DBや外部サービスを実行できない場合は「未実施」と記録し、成功扱いにしない。

## 固定順

1. `pnpm --version`、Node.js、`packageManager`、対象SHAを確認する。
2. migration SQL、trust root、workflow、OpenAPI、改行、workspace境界を静的検査する。
3. `pnpm install --frozen-lockfile`を一度だけ実行する。
4. build、test、typecheck、lintを順に実行する。
5. local PostgreSQL/Supabaseのrole、major version、migration、RLS、seedを確認する。
6. integration、local E2E、production bundle検査を実行する。
7. stagingではmigration、配置、smoke、E2Eを同一artifactで実行する。
8. 失敗、未実施、外部停止条件を再開台帳へ記録する。

## 実行入口

| コマンド | 対象 | 成功条件 |
| --- | --- | --- |
| `pnpm ci:fast` | PR品質ゲート | static、契約、unit、typecheck、buildが成功 |
| `pnpm ci:local` | local統合 | migration、RLS、integration、local E2E、bundle検査が成功 |
| `pnpm ci:staging` | staging受入 | 接続先検査、migration、配置、smoke、E2Eが成功 |
| `pnpm verify:schema-drift` | schema drift | 期待するschema、shadow role、migration履歴が一致 |
| `pnpm test:database-integrity` | DB整合性 | role、権限、RLS、migration条件が実DBで成功 |
| `pnpm verify:trust-root` | PR信頼境界 | trusted manifest、protected path、許可SHAが一致 |

個別検証には`pnpm verify:migration-sql`、`pnpm verify:migration-checksum`、`pnpm verify:migration-history`、`pnpm verify:environment`、`pnpm verify:release`を使います。

## DB・RLS検証

実DB検証では、app role、`rolbypassrls`、table privilege、migration履歴、tenant contextを確認します。

tenantに属する表は`ENABLE ROW LEVEL SECURITY`と`FORCE ROW LEVEL SECURITY`、tenantを含む参照制約、active membership境界を満たす必要があります。

認可確認のrow lockと競合制御のlockを同じSQL句へ混在させません。

fixtureはtenant、user、member、role、status、cleanup条件を明示し、guardianと管理者のtransactionを分離します。

## Trust root・schema drift

未信頼のPRでinstall scriptを実行する前にtrust検査を行います。

protected pathの追加、変更、rename、削除、初回導入は許可条件を限定し、判定不能時は失敗させます。

schema driftはmigration正本、適用済み履歴、shadow role、deploy前後の同一SHAを比較します。

manifestのhashは手入力せず、実ファイルから計算して検証します。

## レポートと停止条件

レポートは`.ci-reports/`へ出し、Gitへ追加しません。

secret、token、個人情報、署名URL、接続文字列を出力しません。

test、build、lint、DB検証のどれかが失敗した場合、後続の成功だけで置き換えず、原因と再実行結果を記録します。

CriticalまたはHighの指摘、tenant越境、認可漏れ、PII漏えい、状態遷移の破綻が残る場合はmergeと昇格を停止します。

## docs-onlyの記録

実装PRにはコード、テスト、必要なmanifestだけを含めます。

完了履歴、検証結果、レビュー判定、再発防止は実装PRと分離したdocs-only変更で更新します。
