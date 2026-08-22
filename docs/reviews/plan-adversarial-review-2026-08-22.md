# 実装前敵対的レビュー記録（2026-08-22）

## 対象

- 対象ファイル: `docs/ implementation-plan.md`
- 第1レビュー対象コミット: `e0ed27f`
- 第1レビュー後の修正コミット: `9596e9b`
- レビュー方式: サブエージェントによる読み取り専用レビュー
- 実装・テスト基盤: 未作成

## 第1レビュー結果

実装開始不可。Critical 2件、High 9件、Medium 4件。

- DBレベルのテナント境界が未保証
- Node.js / Cloudflare Workers と Prisma の接続方式が未確定
- Tenant、TenantMembership、EventAttendance 等の実スキーマが不足
- API単位の権限マトリクスが不足
- R2の公開URL設計に情報漏えいリスク
- PR品質ゲートとTDDの実行手順が未定義
- 一括実装プロンプトが小さなレビュー単位と矛盾

## 第1レビュー後の修正

`9596e9b` で次をプランへ追加した。

- Phase 0〜3 の Node.js 20 固定
- Tenant、TenantMembership、GuardianMember、AuditLog を含む Phase 1 方針
- RLS、複合外部キー、private R2、短期署名URLの方針
- API権限マトリクス、TDD、PR品質ゲート、タスク一覧、中断後の再開手順
- 一括実装プロンプトを Phase 1 の最初の縦切りへ縮小

## 第2レビュー結果（対象 `9596e9b`）

実装開始不可。Critical 1件、High 9件、追加 Medium。

主な残存指摘は、RLS policy と transaction context の具体性不足、Phase 1 Schema の選択肢残存、旧 Int / 新 UUID の衝突、API・フィールド単位の権限不足、private R2と旧公開URL記述の矛盾、実行可能な `quality.yml` 不足、TDDの実DB検証不足、T-003/T-004状態の矛盾、個人情報保持・AuditLog運用不足だった。

## 判定

本記録作成時点では、T-003を継続中、T-004を不合格として扱う。Critical / High がゼロになるまでアプリ実装へ進まない。

## 再レビューの合格条件

- `SET LOCAL` を含む同一 Prisma transaction client の実行契約がある
- 全テナント表の `ENABLE/FORCE ROW LEVEL SECURITY`、`USING`、`WITH CHECK`、非BY PASS RLSロールが定義されている
- Phase 1 Schema の主キー、外部キー、enum、nullability、index、削除動作に選択肢がない
- 旧原案 Schema が非権威の付録として隔離されている
- APIとレスポンスフィールドの権限マトリクスがある
- private R2、Attachment、短期署名URLの契約が一貫している
- `quality.yml` の実行手順と package scripts、実PostgreSQL/RLS fixture が一致している
- タスク状態、コミットSHA、テスト結果、再開先が一貫している

## 第3レビュー結果（対象 `687827f`）

実装開始不可。Critical 1件、High 5件、Medium 4件。

- RLSの tenant 条件は追加されたが、Member / GuardianMember / AuditLog / TenantMembership の role・担当範囲 policy が十分に具体化されていない
- Prisma UUID の `@db.Uuid`、relation、onDelete、enum、metadata 制約が未確定
- POST / PATCH / DELETE と role 別 DTO・監査 action の表が不足
- Playwright の webServer / health check と test-only adapter の本番除外が未定義
- `cocolo_app` の `BYPASSRLS`、実接続ユーザー、権限、context未設定時の失敗をCIで自動検証する契約が不足

## 第3レビュー後の修正

第3レビュー結果を受け、T-003を継続中、T-004を不合格のまま維持する。RLSを table / role 別 policy として固定し、Phase 1 の UUID 型・relation・制約、API DTO表、Playwright起動契約、実DBロールassertionをプランへ追加してから第4レビューを実施する。

## 第4レビュー結果（対象 `46023fc`）

Critical 0件、High 3件、Medium 3件。**実装開始不可**。

- membership検証、`FOR UPDATE`、role/status確認、`SET LOCAL`、業務クエリを同一 transaction に原子化する必要がある
- `GuardianMember` の Tenant relation と削除動作が不足している
- PATCH / DELETE / owner-admin の出力 DTO、状態遷移、監査 metadata が未確定

## 第4レビュー後の修正

第4レビューを受け、T-003を継続中、T-004を不合格のまま維持する。次の修正では、同一 transaction 内の membership lock と context 設定、`@db.Uuid` を含む Tenant relation、完全な部員 CRUD DTO、ローカル・ステージング・本番の環境分離を確定する。

## 第5レビュー結果（対象 `9f49cb4`）

Critical 0件、High 2件。**実装開始不可**。

- main push から直接 production migration できる記述が残り、staging migration・smoke・E2E・承認済み artifact SHA の昇格Workflowが不足
- DB/Auth/R2/secret の環境分離に、環境誤接続時の起動拒否、Service Role Keyの用途制限、local/staging E2E認証の分離が不足

## 第5レビュー後の修正

第5レビュー結果を受け、T-003を継続中、T-004を不合格のまま維持する。staging deploy、production promote、environment guard、環境別 secret、R2 bucket allowlist、E2E script 分離をプランへ追加してから第6レビューを実施する。

## 第6レビュー結果（対象 `30ebace`）

Critical 0件、High 5件。**実装開始不可**。

- production promote がアプリ artifact だけを取得し、checkout 側の migration を `prisma migrate deploy` するため、staging検証済み migration の不変性が不足
- 実装計画の Phase 2〜5 と機能仕様書の Phase 対応が不一致
- 機能仕様書が部員本人の出欠回答を許可する一方、MemberUser の認証モデルがない
- guardian の注文確認、締切後の staff 出欠修正、Phase 1 API 権限が文書間で不一致
- Attachment の `status` と `deletedAt` の整合条件が不足

## 第6レビュー後の修正

第6レビュー結果を受け、T-003を継続中、T-004を不合格のまま維持する。機能仕様書のフェーズ・権限・状態遷移を正本として更新し、release artifact に migration と checksum を同梱して production では検証済み release だけを適用する。UUIDv7、migration SQL の英語物理名・日本語コメント・UTF-8、pnpm の `minimumReleaseAge`、Actions の SHA 固定と追加のサプライチェーン対策も実装前契約へ追加してから再レビューする。

## 第7レビュー結果（対象 `d04faee`）

Critical 0件、High 0件、Medium 5件。**実装開始可**。

- PromotionRunのpreview → completed / failed、failed → completed / failed、owner/admin限定UPDATE RLS、Idempotency-Key・requestHash・result保存・再送時の409を確定
- staging runのworkflow name、REST APIのworkflow path、job stepのmigration / smoke / E2E成否、artifact SHA、GitHub attestationをcheckout前に検証する契約を確定
- production secretをartifact検証後のstepへ限定し、Web/APIプロトコル、private R2 upload、UUIDv7、Monorepo package境界、PostgreSQL 17、migration SQL検査を文書間で整合
- MediumはPromotionRun列別更新表、固定CLI導入、staging強権限job分離など、T-005の実装・CI検証で解消する

最終判定は、Critical / High がゼロのため実装開始可。次の作業はT-005のRed（開発基盤の検証テスト）から開始する。
