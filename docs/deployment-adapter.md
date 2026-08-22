# デプロイ配置アダプター契約

staging / production 環境への実配置は、環境固有のサービスに依存します。そのため、ワークフローへ直接プロバイダーの実装を埋め込みません。GitHub Environment の保護されたシークレットで、環境ごとに実行可能な配置アダプターを指定します。

配置アダプターは次の引数を受け取り、検証済みの成果物を配置した後、`--release-dir` 配下へ `deployment-record.json` を作成します。

```text
--artifact-sha <40桁の commit SHA>
--release-dir <リリースディレクトリ>
--environment staging|production
```

配置記録は次の値を必須とする。

```json
{
  "status": "success",
  "artifactSha": "配置した commit SHA",
  "environment": "stagingまたはproduction",
  "deployedUrl": "HTTPS の公開 URL",
  "deployedAt": "ISO 8601 形式の配置時刻"
}
```

`pnpm deploy:staging` / `pnpm deploy:production` は、配置アダプターの未設定・失敗、成果物の SHA 不一致、環境不一致、HTTPS ではない配置 URL、配置記録の欠落をすべて失敗として扱います。配置記録を検証できない場合は、staging 環境の E2E テストや production 環境への昇格へ進みません。
