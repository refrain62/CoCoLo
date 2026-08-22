# 中央API mount敵対的レビュー（2026-08-22）

## 結論

Criticalは0件、Highは0件です。

中央APIのsession、Auth team selection path、未接続featureの503、OpenAPI生成一致をコードとテストで固定しました。

## 監査で検出したCritical / High

| 重要度 | 検出事項 | 対応 |
| --- | --- | --- |
| Critical | 中央APIに`GET /api/v1/session`がなく、Webがactive membershipに基づくtenantとroleを取得できなかった | session routeを追加し、Bearer検証とactive membership解決を中央middlewareで必須化した |
| High | Auth team selectionの中央mountが`/api/v1/teams`で、Web契約の`/api/v1/auth/teams`と不一致だった | 中央mount、503 fallback、認証例外判定、OpenAPI、中央APIテストを`/api/v1/auth`へ統一した |
| High | server起動経路でfeature dependenciesが未注入でも、未接続条件とroute応答がテストで固定されていなかった | 接続済みのAuth team selectionだけを実repositoryへ接続し、その他は明示503とテスト・文書で固定した |
| High | 中央OpenAPIにsession、team、全mount対象pathが不足し、生成yamlとの一致検証がなかった | TypeScript生成元へpathを集約し、yaml生成とdeep equalityテストを追加した |

## 確認観点

未認証は401、active membershipがないsessionは403、未接続featureは503、unknown pathは404となることを確認します。

session responseはtenant IDとroleを認証コンテキストからだけ生成し、HTTP入力やログから個人情報を受け取りません。

Auth team selectionはactive membershipだけを返し、選択時にもuser IDとtenant IDの組み合わせを再検証します。

UUID pathは中央入口でUUIDv7へ限定し、feature repositoryへ不正IDを渡しません。

## 残るMedium / 後続条件

中央DB schema、migration、RLS、grantが未統合のため、eventなど7機能の本番repositoryは503です。

stagingとproductionでは分散rate-limit storeの注入が起動条件です。

Supabase Authのsession refresh、logout、選択tenantの永続化は後続Auth接続が必要です。

Webの`main.tsx`と業務API clientへのteam selection接続はWeb担当の後続作業です。

R2とLINEの外部サービス設定、retry、監視は各adapter接続時に追加検証します。

## 判定

上記のCritical / Highは中央API範囲で解消済みです。

後続条件を満たすまでは、503を成功応答へ置き換えてはいけません。
