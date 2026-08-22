# デプロイ配置アダプター契約

全体の手順、GitHub Environment設定、stagingからproductionへの昇格、障害対応は [デプロイ運用手順](deployment-guide.md) を参照してください。この文書では、外部サービス固有の配置アダプターとの入出力契約を定義します。

## 1. 目的

staging / production の実配置先は環境固有の外部サービスへ依存するため、GitHub Actions の workflow にサービス固有の実装を埋め込みません。workflow は検証済み成果物、対象環境、配置結果だけを扱い、実際の配置処理は環境ごとの配置アダプターへ委譲します。

配置アダプターは、外部サービスのSDKやCLIを使ってもよい一方、アプリケーションのDB接続、Supabase Service Role Key、R2の秘密鍵をログや公開成果物へ出してはいけません。外部サービスごとの責務と秘密情報の管理は [外部サービス運用仕様](external-services-operations.md) を参照します。

## 2. 入力契約

GitHub Environment の保護されたsecretまたは承認済みの実行環境から、環境ごとに実行可能な配置アダプターを指定します。アダプターは次の引数を受け取ります。

```text
--artifact-sha <40桁の commit SHA>
--release-dir <リリースディレクトリ>
--environment staging|production
```

入力は次の条件を満たさない場合、配置前に失敗させます。

- `artifact-sha` が40桁のコミットSHAである。
- `environment` がworkflowの対象環境と一致する。
- `release-dir` が現在の配置処理で許可されたディレクトリである。
- 成果物のchecksumが、stagingで検証済みの記録と一致する。

## 3. 配置記録

検証済み成果物を配置した後、`--release-dir` 配下へ `deployment-record.json` を作成します。次の値を必須とします。

```json
{
  "status": "success",
  "artifactSha": "配置した commit SHA",
  "environment": "stagingまたはproduction",
  "deployedUrl": "HTTPS の公開 URL",
  "deployedAt": "ISO 8601 形式の配置時刻"
}
```

`deployedUrl` はHTTPSのURLだけを受け付けます。`deployedAt` はアダプターが配置完了を確認した時刻をISO 8601で記録します。失敗時に成功状態の配置記録を作成したり、前回の配置記録を再利用したりしてはいけません。

## 4. 検証と昇格

`pnpm deploy:staging` / `pnpm deploy:production` は、次のいずれかが発生した場合に失敗します。

- アダプターが未設定、実行不能、または異常終了した。
- 成果物のSHA・checksum・環境名が期待値と一致しない。
- HTTPSではないURL、空のURL、許可されていないURLが返された。
- `deployment-record.json` が欠落、壊れている、または必須項目を満たさない。
- 記録された成果物が、配置対象として承認された成果物と異なる。

配置記録を検証できない場合、staging E2E、production promote、利用者への完了通知へ進めません。production は staging で同じ成果物の検証が完了し、GitHub Environment の承認条件を満たした場合だけ昇格させます。

## 5. 証跡と障害対応

配置ごとに、コミットSHA、環境名、配置先URL、開始・終了時刻、migration checksum、E2E結果、承認者をGitHub Actionsの証跡へ保存します。DB URL、JWT、Service Role Key、R2秘密鍵、個人情報は保存しません。

配置が失敗した場合は、アプリを成功扱いにせず、次を確認します。

1. アダプターの終了コード、外部サービスの状態、ネットワーク・証明書エラーを確認する。
2. 成果物SHAと配置記録を照合する。
3. 部分配置の有無を配置先で確認し、必要ならアダプター固有の安全な再実行手順を使う。
4. DB migrationが先に適用されている場合は、アプリとDBの互換性を確認してから再配置またはforward recoveryを判断する。
5. 原因、影響範囲、復旧操作、再発防止策を作業記録へ残す。
