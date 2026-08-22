# 部員ライフサイクルの統合メモ

対象仕様は `FS-MEM-003` です。

この実装は既存の部員一覧と同じ `createApp`、`createMemberRepositories`、`MemberApi` を利用します。

## API契約

既存の認証middlewareが `auth`（認証済みの `tenantId` と `role`）を設定した後、次の操作を提供します。

| Method | Path | 許可 | 結果 |
| --- | --- | --- | --- |
| `PATCH` | `/api/v1/members/:memberId` | `owner` / `admin` | 基本情報を置換更新し、公開DTOを`200`で返す |
| `POST` | `/api/v1/members/:memberId/retire` | `owner` / `admin` | `retired`化し、公開DTOを`200`で返す |

通常編集は全項目を受け取る置換更新です。

`name`、`kana`、`category`、`gradeLevel`、`ageGroup`、`status`を送信し、`status`には`active`または`suspended`だけを指定できます。

退部済みの部員は通常編集できません。

退部操作を同じ部員へ再送すると、追加の状態変更なしに`retired`の公開DTOを返します。

## テナントと状態遷移

`tenantId`はリクエストbody、query、pathから受け取らず、認証Contextからrepositoryへ渡します。

repositoryはtransaction-localに`app.tenant_id`、`app.user_id`、`app.role`を設定し、active所属を再確認してから`tenantId`と`id`の複合条件で対象行をロックします。

行ロックは編集と退部を直列化するために必要です。

ロックを省くと、退部直前の編集が退部後の値を上書きする競合を許してしまいます。

通常編集は`active`と`suspended`の間だけを扱い、`retired`への遷移を専用操作へ限定します。

## 監査と個人情報

`member.update`と`member.retire`の監査INSERTは状態変更と同じtransactionで行います。

監査metadataには変更前後の状態、変更項目、実行者が指定したrequestIdだけを保存し、氏名、ふりがな、特記事項などの値は保存しません。

公開DTOからは`tenantId`と`note`を除外します。

APIの認可は画面の表示制御に依存せず、別クライアントやcurlからの呼び出しでも同じ条件で検証します。

## Web接続点

`MemberManagementPage`は既存の`MemberApi`を受け取り、一覧の各行から編集と退部を実行します。

ブラウザはaccess tokenだけをBearerヘッダーへ設定し、`tenantId`や`note`を送信しません。

退部確認はブラウザで行いますが、状態変更の認可と冪等性はAPIとRLSが保証します。

## E2E実行条件

`e2e/member-lifecycle.spec.ts`は、専用fixtureの部員IDとaccess tokenを明示した場合だけ実APIへ接続します。

productionでは常に無効です。

```powershell
$env:MEMBER_LIFECYCLE_E2E = '1'
$env:MEMBER_LIFECYCLE_MEMBER_ID = '<専用fixtureのUUID>'
$env:MEMBER_LIFECYCLE_ACCESS_TOKEN = '<専用fixtureのaccess token>'
pnpm test:e2e:local
```

未設定時はskipされ、既存E2Eのfixtureや状態を変更しません。
