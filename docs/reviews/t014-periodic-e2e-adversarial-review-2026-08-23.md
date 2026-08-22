# T-014 periodic E2E 敵対的レビュー

- 対象: `feature/t014-periodic-e2e`
- 起点: `origin/develop` (`70dd4bd`)
- 範囲: 日次・週次・手動SHA指定のlocal Chromium E2E、固定レポート、失敗Issue同期

## 確認事項

| 観点 | 確認結果 |
| --- | --- |
| 認証と環境境界 | `APP_ENV=local` と `E2E_ENV=local` を必須化し、test-only Authの合成認証値以外を受け付けない。staging / production URL・資格情報はWorkflowへ渡さない。 |
| 対象SHA | 日次・週次はdevelopの最新SHAと成功済みquality runのSHA一致を確認する。手動実行は小文字40桁を検証し、APIでcommit存在を確認した出力だけをcheckoutする。 |
| 個人情報 | DB fixture、Auth、登録値はtest-onlyまたは合成値に限定する。テスト名は許可済みの固定IDへ縮退し、未知のタイトルをレポートへ保存しない。 |
| ログとArtifact | Playwrightのraw outputはRunner一時領域へ置き、traceを無効化し、自動retryを行わない。Artifactは厳密な固定JSONだけとし、canary、認証値、接続文字列、メール、電話番号、HTTP body等をupload前に拒否する。 |
| Issue連携 | `issues: write` は専用jobだけに付与する。Issue本文はテスト名、判定、run URLの固定形式に限定し、同一タイトルで重複排除し、成功時にcloseする。 |
| 供給網 | checkout、pnpm、Node、Artifact Actionを完全SHA固定し、PostgreSQL service imageもdigest固定とする。checkout credentialは保持しない。 |
| 反復 | 日次は1回、週次は同一SHA・固定seed・UTC・localeで3回をretryなしで実行し、一度でも失敗すればWorkflowを失敗させる。 |

## 判定

静的レビューのCritical / High指摘は0件。

Node 24での対象スクリプト型検査、固定レポートテスト、Workflow Action SHA検査、`pnpm test`、`pnpm typecheck`、`pnpm build`は成功した。

この実行環境ではDocker Engineへ接続できないため、PostgreSQL serviceを使うlocal E2Eの実行証跡は取得していない。Workflow上ではPostgreSQL service、migration、合成fixture投入をE2E開始前に固定している。
