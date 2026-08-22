# デプロイadapter契約

staging / production の実配置は環境固有サービスへ依存するため、Workflowへ直接のprovider実装を埋め込まない。GitHub Environmentのprotected secretで、環境ごとの実行可能なadapterを指定する。

adapterは次の引数を受け取り、検証済みartifactを配置した後、`--release-dir` 配下へ `deployment-record.json` を作成する。

```text
--artifact-sha <40桁のcommit SHA>
--release-dir <release directory>
--environment staging|production
```

配置記録は次の値を必須とする。

```json
{
  "status": "success",
  "artifactSha": "配置したcommit SHA",
  "environment": "stagingまたはproduction",
  "deployedUrl": "httpsの公開URL",
  "deployedAt": "ISO 8601の配置時刻"
}
```

`pnpm deploy:staging` / `pnpm deploy:production` はadapter未設定、adapter失敗、artifact SHA不一致、環境不一致、HTTPSでない配置URL、配置記録欠落のいずれも失敗として扱う。配置記録が検証できない場合、staging E2Eやproduction promoteへ進めない。
