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
