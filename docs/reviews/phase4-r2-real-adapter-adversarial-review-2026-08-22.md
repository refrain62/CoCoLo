# Phase 4 R2実接続adapter 敵対的レビュー（2026-08-22）

## 対象

- `apps/api/src/features/attachments/r2-real-attachment-storage.ts`
- `apps/api/src/features/attachments/fake-attachment-storage.ts`
- `packages/domain/src/attachment-domain.ts`
- R2環境検証と運用文書

中央API mount、DB schema、migration、LINE、Web entrypointは対象外とし、変更していない。

## Critical / High

0件。

## 確認観点

| 観点 | 結果 |
| --- | --- |
| 公開URL | R2の公開URLは生成しない。PUT/GET/DELETEはいずれも短期署名URLだけを使う。 |
| 別tenant | object keyを`tenantId/attachments/attachmentId`形式へ固定し、任意pathや別prefixを拒否する。 |
| 署名期限 | 期限切れ、現在時刻以前、15分超過の署名を拒否する。DELETEはadapter内で60秒の短期署名に限定する。 |
| secret漏えい | 環境検証エラーへsecret値を含めない。Web entrypoint、manifest、公開設定へsecretを追加していない。 |
| 上書き | PUT署名前に`HeadObject`で既存objectを確認し、存在する場合は署名しない。PUT commandにも`IfNoneMatch: "*"`を設定する。 |
| サイズ/MIME検証 | adapterでサイズ上限を確認し、domainでMIME、サイズ、magic byte、SHA-256を検証する。 |
| object存在/metadata | `HeadObject`で存在と`ContentLength`/`ContentType`/metadataを読み、本文サイズ不一致を拒否する。 |
| エラー時の安全状態 | 署名・読み取り・削除失敗は成功扱いにせず例外へ倒す。削除404だけは冪等なcleanup成功として扱う。 |
| fake/local分離 | fake adapterは期限切れ署名と上書き拒否をlocal/test内で再現し、R2実接続adapterとは別テストで検証する。 |

## 残リスク

- 実Cloudflare R2資格情報は使用できないため、外部接続はHTTP stubで検証した。staging有効化前に実bucketの非公開設定、CORS、最小権限access keyを確認する。
- 既存のPhase 4 attachment API/DB実装はdevelop未導入のため、本PRではadapter契約と検証に限定した。中央接続は後続PRで行う。
