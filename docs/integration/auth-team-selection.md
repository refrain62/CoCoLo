# 複数チーム選択の統合契約

この文書は FS-AUTH-002 の専用実装を、中央APIとWeb画面へ統合するときの契約を定めます。

## 実装範囲

専用ブランチでは、次の部品を独立して実装しています。

* `packages/contracts/src/auth-team-selection-contract.ts`：チームID、選択要求、一覧応答、選択応答のZod契約。
* `packages/domain/src/auth-team-selection-domain.ts`：active所属だけを選択可能にする業務ルール。
* `packages/db/src/auth-team-selection-repository.ts`：既存の`TenantMembership`と`Tenant`を読むDB adapter。
* `apps/api/src/features/auth-team-selection/app.ts`：認証付きのチーム一覧・選択ルート。
* `apps/web/src/features/auth-team-selection/`：API client、選択画面、選択中チームヘッダー。

中央統合前提のため、`apps/api/src/app.ts`、`apps/web/src/main.tsx`、`packages/db/prisma/schema.prisma`、既存の共有indexは変更していません。

## APIの接続

中央APIは`createAuthTeamSelectionApp()`を`/api/v1/auth`へmountします。

| Method | Path | 認証 | 説明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/auth/teams` | Bearer JWT | 利用者のactive所属だけを名前順で返す |
| `POST` | `/api/v1/auth/teams/select` | Bearer JWT | bodyの`tenantId`を再検証し、選択中チームとroleを返す |

JWTの署名、issuer、audience、`exp`、`nbf`の検証は既存の`@cocolo/auth`へ委譲します。

チーム選択ルートは、JWTの`sub`から取得したuser IDをDB adapterへ渡し、bodyの`tenantId`だけを認可の根拠にしません。

選択できる所属は`status=active`だけです。

`invited`と`suspended`は一覧に含めず、直接選択しても403を返します。

別利用者の所属や別テナントのIDを指定した場合も、所属の存在を推測できない同じ403応答にします。

## 選択状態の受け渡し

選択画面は、選択応答をメモリ上の状態として保持します。

業務APIへのリクエストには、次のヘッダーを付けます。

```http
X-CoCoLo-Team-Id: 00000000-0000-7000-8000-000000000001
```

このヘッダーは利用者が書き換えられるため、ヘッダー値だけで認可してはいけません。

中央統合時の認証middlewareは、各リクエストで次の順序を守ります。

1. Bearer JWTを検証してuser IDを得る。
2. `X-CoCoLo-Team-Id`をUUIDv7として検証する。
3. user IDとteam IDの複合条件で`TenantMembership`を`FOR UPDATE`付きで取得する。
4. `status=active`を確認し、DBから得たroleを認証Contextへ設定する。
5. 同じtransaction内でRLS contextを設定して業務クエリを実行する。

ヘッダーがない状態で複数のactive所属を持つ利用者を暗黙選択してはいけません。

選択後に所属が停止された場合は、次の業務APIリクエストで403にし、Webは再度チーム選択へ戻します。

## DBと分離運用

今回のadapterは、アプリケーションデータを持つPostgreSQLの`TenantMembership`と`Tenant`を読み取るだけです。

Supabase Authの`auth.*` schemaやセッションを参照せず、JWTのsubjectを`userId`文字列として扱います。

将来DBをSupabase PostgreSQLから分離する場合は、`AuthTeamSelectionRepository`の次の二つの操作を新DB adapterへ置き換えます。

* `listActiveMemberships(userId)`
* `findActiveMembership(userId, tenantId)`

新DBでも、user IDとtenant IDの複合条件、active状態、テナント名、roleの取得を一つのtransaction境界で保証します。

Authのユーザー情報を新DBへ複製する場合も、パスワードやrefresh tokenは複製せず、外部subjectと所属情報だけを保持します。

## 中央統合で追加する作業

この専用ブランチでは共有ファイルを変更していないため、次の作業を中央統合ブランチで行います。

* APIの`/api/v1/auth`へのmount。
* 既存のmember、event、orderなどの認証middlewareへの`X-CoCoLo-Team-Id`導入。
* Webの`main.tsx`でチーム選択画面をログイン後かつ業務画面の前に表示する接続。
* 業務API clientへの選択チームヘッダー付与。
* 共通ヘッダーへの選択中チーム名とrole表示。
* 実PostgreSQLでtenant A/B、複数所属、停止直後の再検証を確認する統合テスト。
* OpenAPI生成元へのルート追加。

