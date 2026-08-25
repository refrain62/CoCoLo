# Phase 3 役員・連絡先の統合メモ

## 対象仕様

このメモは `docs/functional-specification.md` の FS-BRD-001 と FS-BRD-002 の実装境界を記録する。

FS-BRD-001 は年度ごとの役職枠、役職種別、担当者、連絡先を管理する。

年度引き継ぎは役職名と役職種別だけを複製し、担当者、LINE連絡先、電話番号、表示設定を初期化する。

FS-BRD-002 は `line`、`phone`、`both` の表示設定に従って連絡先を投影する。

owner と admin には設定済みの連絡先を返すが、staff と guardian には役職枠だけを返す。

## 実装範囲

| 層 | 実装 | 備考 |
| --- | --- | --- |
| contract | `packages/contracts/src/board-contact-contract.mjs` | 入力項目、年度、役職種別、表示設定を検証する |
| domain | `packages/domain/src/board-contact-domain.ts` | 個人情報を含む投影と年度引き継ぎの不変条件を定義する |
| API | `apps/api/src/features/board-contact/` | 認証所属から tenant を解決し、manager 操作を認可する |
| DB repository | `packages/db/src/board-contact-repository.ts` | Prisma の生成モデルを増やさず raw SQL と transaction を扱う |
| Web | `apps/web/src/features/board-contact/` | staff/guardianの閲覧専用一覧とowner/adminの登録、編集、削除、年度引き継ぎを提供する |
| 専用テスト | `apps/api/test/board-contact/`、`apps/web/src/features/board-contact/*.vitest.ts` | 契約、投影、認可、tenant 境界、API client を検証する |

## API 契約

すべてのエンドポイントは `Authorization: Bearer <access-token>` を要求する。

API は token の user ID から有効な所属を一意に解決し、リクエスト本文の `tenantId` を受け付けない。

| メソッド | パス | 用途 | 権限 |
| --- | --- | --- | --- |
| GET | `/api/v1/board-members?fiscalYear=2026` | 年度の役職一覧 | 所属利用者 |
| POST | `/api/v1/board-members` | 役職枠と連絡先の登録 | owner、admin |
| PATCH | `/api/v1/board-members/:boardMemberId` | 役職枠と連絡先の更新 | owner、admin |
| DELETE | `/api/v1/board-members/:boardMemberId` | 役職枠の削除 | owner、admin |
| POST | `/api/v1/board-members/copy-year` | 前年度の役職枠の引き継ぎ | owner、admin |

連絡先の投影は API が行う。

Web は `lineContact` と `phone` がレスポンスに含まれる場合だけ画面へ表示し、レスポンスにない値を補完しない。

## DB repository の前提

DB repository は Prisma schema に未登録の `board_contacts` を raw SQL で扱う。

この分離は、DB を後から外部サービスへ移行する際に API の repository 契約を維持し、データアクセス実装だけを交換するためである。

統合側の migration は次の列と制約を用意する。

| 列 | 型と制約 | 内容 |
| --- | --- | --- |
| `id` | `uuid`、主キー | 役職枠の識別子 |
| `tenant_id` | `uuid`、`tenants.id` 参照 | テナント境界 |
| `fiscal_year` | `integer`、2000〜2100 | 対象年度 |
| `role_name` | `varchar(100)` | 役職名 |
| `role_type` | `varchar(16)` | `admin`、`staff`、`member` |
| `assignee_user_id` | `varchar(128)`、NULL許容 | 同じテナントの有効な所属ユーザー |
| `line_contact` | `varchar(200)`、NULL許容 | LINE上の連絡先 |
| `phone` | `varchar(32)`、NULL許容 | 電話番号 |
| `contact_preference` | `varchar(8)` | `line`、`phone`、`both` |
| `created_at` | `timestamptz` | 作成日時 |
| `updated_at` | `timestamptz` | 更新日時 |

`(tenant_id, fiscal_year, role_name)` に一意制約を設定する。

`role_type` と `contact_preference` は CHECK 制約で許可値を限定する。

repository は各 transaction の開始時に `app.tenant_id`、`app.user_id`、`app.role` を設定し、所属を再確認する。

DB 側の RLS は `tenant_id` が `app.tenant_id` と一致する行だけを読み書き可能にし、書き込みは `app.role` が `owner` または `admin` の場合に限る。

`cocolo_app`には `board_contacts` の直接SELECTを付与しない。repositoryはtenant・active membership・manager roleをDB関数内で再検証するprojectionを使い、staffとguardianには連絡先PIIをNULLで返す。管理操作の取得、役職重複確認、年度引き継ぎも専用関数を経由し、DMLの`RETURNING`で直接SELECT権限を迂回しない。

担当者の所属確認と役職枠の変更は同じ transaction で実行する。

年度引き継ぎと役職名の重複確認はテナント単位の transaction advisory lock で直列化する。

監査ログには連絡先の値を保存せず、値の有無だけを metadata に残す。

役員・連絡先は無料featureキー `board-contacts` で管理する。

APIは契約が有効な場合だけ役員・連絡先routeを実行し、契約未設定時も503で停止する。

Webは同じfeatureキーでowner/adminのチーム設定とstaff/guardianの閲覧専用メニューを表示制御する。

## 現行の統合状態

中央API、Webルート、DB repository、共有export、`board_contacts` のmigrationは `develop` に統合済みである。DB PII境界はPR #191で統合した。

年度引き継ぎは行ごとのUUIDv7生成とINSERT影響行数による`copiedCount`を実装済みである。

残る受入は、OpenAPI同期、staging実DB/RLSでの複数行とrollback確認である。

## 検証

専用 API テストは認証、認可、入力境界、tenant の決定、個人情報投影、年度引き継ぎを確認する。

専用 Web テストは token 付与、年度 query、JSON body、ID の URL エンコード、未認証時の通信抑止、staff/guardianの閲覧メニュー、feature flag、非公開連絡先表示を確認する。

DB repository の raw SQL は統合側の migration 適用後に DB integration test を追加し、RLS と transaction rollback を確認する。

PR #191ではfresh local DBでmanagerのprojectionだけがPIIを取得でき、staff/guardianはNULL、直接SELECTは全roleで拒否、別tenantは0件になることを確認した。WindowsのPrisma engine DLL rename EPERMにより公式integration runnerは完走していないため、staging/Linux受入を残す。
