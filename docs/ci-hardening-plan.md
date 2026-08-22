# CI強化計画

## 1. 目的

開発者が変更を安全に統合できるよう、静的検査、単体テスト、統合テスト、セキュリティ検査、定期検査を再現可能なCIとして整備します。

この計画はCIの検出範囲だけでなく、Workflow自体の改変、秘密情報の露出、依存関係の侵害、テナント越境、危険なmigration、テストの形骸化も検査対象にします。

E2Eは実行負荷が高いため、PRごとの自動実行から除外します。
ローカルE2Eは日次と週次の定期実行、および必要時の手動実行で確認します。

## 2. 現状と制約

2026年8月22日時点のPR品質ゲートは約80秒で完了しますが、現行仕様で要求しているローカルE2Eと本番バンドル検査はWorkflowから脱落しています。

リポジトリはGitHub Freeの非公開リポジトリです。
この構成では`develop`と`main`へbranch protectionとrequired checksを設定できないため、CIはマージを技術的に強制するゲートではなく、変更を検出して証拠化する助言的ゲートとして扱います。

GitHub側ではDependabot alertsが無効、Environmentが0件、Actionsがすべて許可、Actionの完全SHA固定強制が無効です。
Environment secretを利用できないため、stagingとproductionへのデプロイは有効化しません。
repository secretを代替として使うとデプロイ承認と環境分離が弱くなるため、この計画では禁止します。

## 3. PR品質ゲート

`quality.yml`は`develop`と`main`に対する`pull_request`、両ブランチへの`push`、secretを受け取らない`workflow_call`で実行します。

すべてのジョブは`ubuntu-24.04`、最小権限、固定タイムアウトで動かします。
PRの古い実行だけを`concurrency`で中止し、`push`の検査は中止しません。

`actions/checkout`は`persist-credentials: false`とし、PRジョブはsecretを参照しません。
`pull_request_target`、未信頼コードをcheckoutする`workflow_run`、`secrets: inherit`、GitHub contextの値を直接`run`へ展開する記述を禁止します。

| ジョブ | 検査内容 | 上限 |
| --- | --- | --- |
| `static-unit-build` | 固定install、Biome、型検査、依存境界、Workflow、OpenAPI、Prisma、単体テスト、カバレッジ、build、本番バンドル検査 | 10分 |
| `integration` | PostgreSQL 17、migration、RLS、テナント境界、ロール別統合テスト | 10分 |
| `security` | runtime、開発用、CI用依存関係、秘密情報、SAST、構成ミス、例外期限 | 10分 |
| `gate` | 上記3ジョブの結果をfail-closedで集約する固定チェック | 2分 |

`gate`は`if: always()`で上流ジョブを待ち、すべての結果が`success`の場合だけ成功します。
`failure`、`cancelled`、`skipped`、未知値、欠落は非0終了とします。

PRの目標はp95実時間5分以内、合計job-minutes 12分以内とします。
初回2回の測定は暫定値とし、10回到達時に正式評価します。

v1では依存関係キャッシュを使用しません。
固定installが14日連続でp95 60秒を超えた場合だけ、PRはrestore-only、信頼済み`push`だけsave可能な設計を別レビューします。

## 4. E2Eの実行契約

E2EはPR品質ゲートでは自動実行しません。
PRでは単体テスト、APIテスト、実PostgreSQL統合テストまでを必須の検査範囲とします。

日次実行は`develop`の検証済みSHAを対象に、ChromiumでローカルE2Eを1回実行します。
失敗時の自動retryは行わず、再実行による成功で元の失敗を合格へ変更しません。

週次実行は同じSHAと固定seed、TZ、localeを使い、ローカルE2Eを3回反復します。
一度でも失敗したテストはflakeとして失敗させ、owner、Issue、最大14日の期限がないquarantineを認めません。
認証、認可、テナント境界、RLSを確認するE2Eはquarantine対象外とします。

手動実行は`workflow_dispatch`から対象SHAを40桁のcommit SHAで指定します。
対象SHAを形式検証してから明示的にcheckoutし、ブランチ名や未検証の入力をshellへ展開しません。
将来staging E2Eを有効化する場合は、保護されたstaging資格情報とURLの完全一致を必須にします。

日次、週次、手動のE2Eはtest-only Authと合成個人情報だけを使用します。
trace、video、storage state、DB dump、環境変数、HTTP bodyはArtifactへ保存しません。
保存対象は秘匿化した固定レポートだけとし、upload前にcanary secretと個人情報を検査します。

定期E2Eが失敗した場合は、専用ジョブだけに`issues: write`を与えます。
固定形式の重複排除Issueを作成し、回復時に閉じます。
Issueにはテスト名、判定、run URLだけを記録し、ログ断片、token、個人情報を含めません。

## 5. テストとカバレッジ

`pnpm test`を全単体テストの正規入口へ統一し、Vitestと`node:test`の取りこぼしをなくします。
0件のtest suiteとplaceholder testはCIを失敗させます。

Vitest V8とc8を固定版で導入し、テスト専用source mapからソース単位のIstanbul JSONとLCOVへ統合します。
対象は`apps/*/src`と`packages/*/src`を明示し、`dist`、生成物、テスト、設定ファイルだけを除外します。

全体基準はlines、functions、statementsを85%、branchesを80%とします。
認証、API認可、テナント境界、環境ガードはlines、functions、statementsを90%、branchesを85%とします。
変更行はlinesを90%、branchesを85%とします。

カバレッジの正本は追跡対象の`.github/ci/coverage-baseline.json`とします。
このJSONにはtool version、対象ファイル、critical file一覧、各metricを記録します。

PRではeventのbase SHAを環境変数で渡し、40桁の16進数であることを検証してから、そのSHAだけを明示的に取得します。
`git show`でbase側のbaselineを読み、削除、低下、対象除外、別SHA、取得不能をfail-closedにします。

初回値が固定基準未満の場合は変更行基準を即時必須化し、既存値は単調増加させます。
既存値はCI導入から30日以内に固定基準へ到達させます。

## 6. migrationとRLS

PostgreSQL 17のservice imageはdigestで固定します。
既存migrationにはchecksum manifestを作成し、編集と削除を検出します。

追加migrationごとの静的検査、空DBへの全migration適用、Prisma schemaとの差分、migration履歴のdriftを分けて検査します。
RLS無効化、過剰な`GRANT`、role変更、既存データを無条件に削除するDDLは、期限付き例外がない限り拒否します。

migration owner、role bootstrap、`cocolo_app`、seedの接続資格情報を分離します。
`cocolo_app`がNOSUPERUSER、NOBYPASSRLS、非owner、不要なrole membershipなしであることを実DBで確認します。

context未設定、tenant Aからtenant Bへの越境、各roleのCRUD、guardian担当外、AuditLogの更新と削除を失敗ケースとして固定します。
古いmigrationに安全な記述が存在するだけで新しい危険なmigrationが合格しないよう、追加ファイル単位でも検査します。

この検査の正本は `packages/db/prisma/migrations.sha256` です。
`pnpm verify:migration-checksum` は各 `migration.sql` の生バイト列をSHA-256で計算し、manifestとのchecksumとファイル集合を完全一致させます。
そのため、既存migrationの編集だけでなく、migrationの追加、削除、改名、manifestの破損も失敗します。

空のPostgreSQLへmigrationを適用した後は、`pnpm verify:migration-history` を `DIRECT_URL` だけで実行します。
`_prisma_migrations` のmigration名、checksum、完了時刻、rollback状態をmanifestと照合し、app roleや別の接続先へのフォールバックを認めません。
schema drift、RLS、role属性、policyの実DB検査は別のCI-003実装単位で追加します。

既存migrationの変更禁止は、同じPRでmanifestだけを更新して検査を回避できないよう、Workflowが受け取ったbase SHAとの差分でも確認します。
base SHAは40桁のcommit SHAとして扱い、既存migrationの編集、削除、改名を拒否し、新規migrationの追加だけを許可します。

Workflowと検証スクリプトはPRの変更対象になり得るため、検査結果だけを信頼境界にしません。
.github/CODEOWNERSでWorkflow、検証スクリプト、package設定、lockfileのownerレビューを要求し、GitHub側でbranch protectionを利用できる環境では当該レビューと品質ゲートを必須条件にします。
GitHub Freeの非公開リポジトリで必須レビューを技術的に強制できない期間は、ownerが差分を確認してからDraft PRを更新し、CIへ秘密情報を渡しません。

## 7. セキュリティと供給網

runtime依存だけでなく、buildとCIで実行される開発用依存もCriticalとHighで失敗させます。

Gitleaks、Semgrep OSS、Trivyは固定version、固定Action SHAまたはimage digest、リポジトリ内の固定ルールで実行します。
telemetryを無効にし、scanner jobへsecretを渡しません。

scannerの標準出力、標準エラー、JSON、SARIFは`RUNNER_TEMP`内の権限制限ファイルへ保存します。
ログ、Summary、Issueにはツール名、重大度別件数、判定、run URLだけを出します。
生の結果はArtifactへ保存せず、ジョブ終了時に削除します。

例外はID、owner、根拠、緩和策、関連Issue、失効日を必須とします。
Criticalの例外期限は最大7日、Highは最大14日とし、期限切れはCIを失敗させます。

Dependabot dependency graphとalerts、通知を有効化します。
security updateの自動PRは、既定ブランチ`main`へ作られて現在の`develop`起点の運用を迂回するため無効化します。

repository ownerはCritical通知から24時間以内、High通知から72時間以内に`develop`起点の`security/<advisory-id>`を作成し、`develop`宛てPRで修正します。
npmとGitHub Actionsのversion updateだけを週次で`develop`へ作成し、自動マージは行いません。

## 8. Workflowの自己検査

Workflowは`actionlint`と単体テストを持つ独自validatorで検査します。

次の悪性fixtureを用意し、validator自身が改悪されていないことを確認します。

- 未固定Actionと未固定container imageを拒否する。
- `permissions: write-all`と不要な個別write権限を拒否する。
- `pull_request_target`と`secrets: inherit`を拒否する。
- checkoutのcredential保持を拒否する。
- 未信頼のGitHub contextを`run`へ直接展開する記述を拒否する。
- timeoutとconcurrencyがないPR Workflowを拒否する。
- 上流ジョブの失敗、取消、skip時に集約`gate`を失敗させる。

## 9. 定期検査

日次WorkflowはE2Eスモークに加え、全履歴の秘密情報検査、SAST、依存関係検査、migration driftを実行します。

週次WorkflowはE2E反復、Windows上のlint、型検査、単体テスト、build、mutation testを実行します。
WindowsではPostgreSQL service containerを使わず、DB検査はUbuntuに限定します。

mutation testは認証、ドメイン、契約、API認可、テナント境界、環境ガードを対象とします。
Strykerのbreak scoreを70とし、baselineを単調増加させます。
JWT、テナント、RLS、環境ガードを無効化するsurvivorはscoreに関係なく失敗させます。

月2,000分のうち25%を定期検査と障害調査用に予約します。
月次予測が上限を超える場合は日次の重いsecurity検査を週次へ移しますが、PRの静的検査、単体テスト、統合テスト、CriticalとHighの検査は削りません。

## 10. GitHub設定とデプロイ停止

ActionsをGitHub製と明示allowlistへ限定し、GitHub側でも完全SHA固定を必須にします。
default tokenはread-only、ActionsからのPR承認は禁止を維持します。

GitHub Freeの非公開リポジトリを使う期間は、`admin`と`write`をrepository ownerだけに限定します。
ownerアカウントはMFAとpasskeyを有効にし、回復コードとログイン履歴を定期確認します。

実行可能なstagingとproduction Workflowは`.github/workflows`から非実行の設計資料へ移します。
Free期間はflag、手動dispatch、repository secretのいずれでもデプロイできない状態を維持します。

GitHub Proへ移行した場合もproductionを直ちに有効化しません。
`develop`と`main`のPR必須、`品質ゲート / gate`必須、force pushと削除禁止、conversation解決、管理者bypass禁止をAPIで検証してから、CIを強制ゲートへ変更します。

productionの解除には、保護された環境、外部承認とOIDCまたはKMS署名、環境非依存buildまたは環境別の個別署名、同一SHAの手動E2E成功、expandとcontractに分けたmigration、backupとrestore drillを要求します。

## 11. 実装順序

1. **CI-001 現状証拠:** Workflow、GitHub設定、所要時間、未実行検査、残余リスクを記録します。
2. **CI-002 テスト探索:** `pnpm test`、0件検査、カバレッジ正本と悪性fixtureを追加します。
3. **CI-003 DB検査:** migration checksum、schema drift、RLS、role境界を追加します。
4. **CI-004 PRゲート:** static、unit、build、integration、security、集約`gate`へ再編します。
5. **CI-005 セキュリティ:** scanner、Dependabot alerts、例外期限、ログ秘匿を追加します。
6. **CI-006 E2Eと定期検査:** 日次、週次、手動E2E、Windows互換、mutation testを追加します。
7. **CI-007 GitHub設定:** Action allowlist、SHA固定、アクセス制限、デプロイ停止を適用します。
8. **CI-008 再レビュー:** 通常系と悪性fixtureを実行し、CriticalとHighが0件になるまで修正します。

観測期間は2回の成功runまたは最大7日とします。
カバレッジの既存負債を除くCriticalとHighの検査は、観測だけで終わらせず最初から失敗条件にします。

## 12. 受け入れ条件

- PRではlint、型検査、単体テスト、カバレッジ、build、実PostgreSQL統合テスト、セキュリティ検査が成功する。
- PRではE2Eを自動実行せず、日次、週次、手動の各入口から同じE2E suiteを実行できる。
- 日次E2Eの失敗が秘匿情報を含まないIssueとして可視化される。
- 未固定Action、write権限、未信頼shell展開、secret継承を悪性fixtureで拒否できる。
- baseline低下、未テスト行、0件suite、placeholder testを拒否できる。
- 既存migration改変、RLS削除、app roleのowner化、contextなし全件取得、テナント越境を拒否できる。
- scannerがcanary secretを検出して失敗し、ログ、Summary、Issue、Artifactにはcanary値を残さない。
- Free状態ではstagingとproductionのjobを開始できない。
- 10回の観測後にPRのp95実時間5分以内、合計12 job-minutes以内、月次予測1,500分以内、Artifact使用量250 MiB未満を満たす。
- 実装後の敵対的レビューでCriticalが0件、Highが0件となる。

## 13. 敵対的レビュー記録

初回レビューはCritical 2件、High 7件、Medium 3件で不合格でした。
Freeの非公開リポジトリでCIを強制できない点、利用不能なデプロイ保護を安全性の根拠にしていた点、PRの信頼境界、cache poisoning、カバレッジの回避、migrationとRLS、scanner、Artifact、flakeを修正対象としました。

第2回レビューはCritical 0件、High 4件で不合格でした。
集約`gate`のfail-open、消失するArtifactをカバレッジ正本にする設計、scannerログへの秘密情報露出、Dependabot security updateの既定ブランチ制約を修正しました。

第3回レビューはCritical 0件、High 0件で合格しました。
残るMediumは10回到達時のp95再評価、coverage tool更新時の専用rebaseline、Windows検査範囲、ownerアカウントの運用、scannerの定期レビューとして本計画へ取り込みました。

## 14. 参照資料

- [GitHub Docs: About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: REST API endpoints for deployment environments](https://docs.github.com/en/rest/deployments/environments)
- [GitHub Docs: Supply chain security](https://docs.github.com/en/code-security/concepts/supply-chain-security/supply-chain-security)
- [GitHub Docs: Customizing Dependabot pull requests](https://docs.github.com/en/code-security/tutorials/secure-your-dependencies/customizing-dependabot-prs)
