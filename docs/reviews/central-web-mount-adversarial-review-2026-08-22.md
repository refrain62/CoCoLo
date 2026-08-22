# 中央Web接続の敵対的レビュー

対象ブランチは `integration/web-mount` です。

対象コミットは `e3be64b`、`630bd7d`、`30cf646` と、その後の中央Web文書です。

## 判定

Criticalは0件です。

Highは0件です。

中央Webを次の統合工程へ渡せますが、中央APIとPR #30、PR #31の取り込みが完了するまで本番機能として扱えません。

## 確認項目

| 観点 | 判定 | 確認内容 |
| --- | --- | --- |
| 認証状態 | 合格 | sessionがない場合に機能routeを表示せず、ログイン画面へ戻る既存経路を維持した |
| tenant境界 | 合格 | tenant IDをURL、query、body、チーム選択UIへ置かず、中央所属APIの応答だけを利用する |
| role | 合格 | roleを中央APIから取得し、管理画面をowner/adminへ限定し、画面のrole選択を用意しない |
| 資源ID | 合格 | 送迎と詳細URLの資源IDをUUIDv7で検証し、不正値をfeature APIへ渡さない |
| 直接URL | 合格 | 既知route、未認証、UUIDv7不正、unknown pathを専用テストで確認した |
| 状態遷移 | 合格 | 所属情報や担当部員の取得失敗を空状態や成功状態へ置き換えない |
| LINE | 合格 | status APIが未応答の間は接続済み・未接続を確定せず、未接続結果だけを表示する |
| R2 | 合格 | API、署名URL、PUT、completeの各失敗を成功表示へ変換しない |
| 個人情報 | 合格 | tenant ID、認証情報、LINE secret、R2 secret、object keyを画面へ出さない |
| API未接続 | 合格 | feature APIの中央mount前であることを画面と統合文書へ明記した |

## Mediumとして残る条件

### 中央所属API

`GET /api/v1/session` は現在の統合ベースに存在しません。

このendpointが未実装の間は、中央Webは所属情報を確認できず、feature画面を表示しません。

### 回覧板API

PR #30からWeb画面とAPI clientだけを取り込み、中央navigationへ接続しました。

回覧板API、DB migration、RLS、添付ダウンロードは中央API統合後に接続します。

### チーム選択とsession lifecycle

PR #31のチーム選択画面はリモートで利用可能ですが、`auth-context` との接続は後続条件です。

session refresh/logoutと同時に変更すると認証状態の競合を起こすため、今回のブランチでは扱いません。

### 非管理者向けの読み取り画面

既存の部員管理と役員連絡先画面は編集操作を含み、読み取り専用propsを持ちません。

中央Webは非管理者へ誤って編集画面を表示しないため、owner/admin以外を中央で停止します。

仕様どおりのstaff/guardian向け読み取り画面が必要になった場合は、既存feature画面へ読み取り専用表示を追加する別レビューが必要です。

## 検証結果

`pnpm exec vitest run apps/web/src/central-navigation.vitest.ts` は8件成功しました。

リポジトリ全体のVitestは17ファイル51件が成功しました。

`pnpm --filter @cocolo/domain build` と `pnpm --filter @cocolo/ui build` は成功しました。

`pnpm --filter @cocolo/web exec tsc -p tsconfig.json --noEmit` は成功しました。

リポジトリ全体の `pnpm build` は成功しました。

リポジトリ全体の `pnpm test` は、中央APIから除外された部員編集と退部routeを前提にした既存テスト4件が失敗しました。

リポジトリ全体の `pnpm lint` は、統合ベースのBiome設定がルート指定で0ファイル扱いとなり失敗しました。

リポジトリ全体の `pnpm typecheck` は、既存APIテストが中央APIから除外された `MemberRepository.update` 型を参照するため失敗しました。

上記3件は中央Webの変更範囲外であり、CriticalまたはHighの中央Web指摘には分類しません。
