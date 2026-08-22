# T-013 共通API強化 敵対的レビュー

## 対象

- 対象: CORS allowlist、rate limit、構造化ログ、公開JSON response runtime schema
- 根拠: `docs/reviews/t011-remediation-release-review-2026-08-22.md` の残存Medium、`docs/ implementation-plan.md` のAPI契約
- 中央統合: 対象外。接続点は `docs/integration/api-hardening.md` に記録した。

## レビュー観点

| 観点 | 確認内容 | 判定 |
| --- | --- | --- |
| テナント越境 | 認証済みrate limitのkeyにtenantIdとuserIdを含め、tenantを跨いだ同一userの制限共有を避ける。response schemaはtenantIdを公開項目に含めない。 | 合格 |
| 認証前のCORS | allowlist外origin、preflight method、preflight headerを認証処理より前に拒否する。`*`とcredentialsを許可しない。 | 合格 |
| rate limit | IPだけのkeyを使わず、identity欠落とstore障害を503でfail-closedにする。超過時は429と`Retry-After`を返す。 | 合格 |
| 個人情報と秘密 | ログschemaをstrictにし、Authorization、query、body、IP、氏名などの項目を型とruntime検証で受け付けない。 | 合格 |
| 公開契約 | 成功routeのschema未登録、JSON解析失敗、schema不一致で元の本文を返さない。 | 合格 |
| 複数instance | local用in-memory storeを本番の共有制限と誤認しない接続条件を文書化する。 | 合格 |

## 検証

専用テストで次を確認する。

- allowlist内外のactual requestとpreflight
- 不許可headerとcredentials未出力
- 毎分60件、window reset、429、`Retry-After`
- identity欠落時の503とIP単独fallbackなし
- ログの固定項目、秘密情報の不出力、query除外
- 正常なUUIDv7 response、未知項目、契約不一致時の500置換

実装コミットは b25f93a である。
専用テスト10件を含むAPI unit test 32件、workspaceの pnpm test、pnpm build、pnpm lint、pnpm typecheck が成功した。
pnpm lint ではBiome 90ファイル、workspace依存境界、各packageの型検査を確認した。
pnpm --filter @cocolo/api test:unit では専用テスト10件を含む32件が成功した。

Critical 0件、High 0件で合格とする。
残る作業は、中央APIへの接続、stagingとproductionの分散rate-limit store設定、全機能のresponse registry登録である。
