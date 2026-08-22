# trust rootの初回bootstrap

現在の`develop`にはtrust rootが存在しないため、PR #41/#42自身を「自己保護済み」と扱わない。
`pull_request_target`、promotion、deploy、DB gateは、base側にtrust rootがない場合にfail-closedで停止する。
GitHub Freeのprivate repositoryではbranch protectionの技術強制ができないため、ownerの手動手順を先行コミットとして分離する。

## ownerの先行手順

1. ownerが`develop`の現在先端から、次の保護対象を含むbootstrap commitを手動で作成する。
   `.github/security/trust-root.json`、`trusted-file-manifest.json`、`CODEOWNERS`、trust workflow、validator、秘密情報またはdeployを扱う全`scripts/**`。
2. そのcommitでは`trust-root.json.status`を`manual-owner-bootstrap-required`のままにし、ownerが内容・SHA固定・manifest hash・CODEOWNERSを確認する。
3. ownerが別の先行コミットで`status`を`bootstrapped`へ変更し、`bootstrap_commit`へ手順1のcommit SHAを設定する。
4. ownerがそのSHAをcheckoutした状態で`pnpm verify:trust-root`と`pnpm lint:workflows`を実行し、GitHub側でrequired reviewer、Environment protection、required checkを手動確認する。
5. ここまで完了して初めて、trust rootをbaseに含むPRを作成・更新する。root導入前のPR #41/#42は、ゲートが成功しないことが正しい状態である。

bootstrap後も、#41/#42が追加・変更するprotected pathはbaseのmanifestにないため、ownerが別の先行commitで対象SHAをmanifestへ拡張するまでPRゲートは拒否する。feature PR自身がmanifestやtrust scriptを更新して通過する経路は持たせない。

bootstrap commitとbootstrapped commitは、PRから導入した変更を根拠にしてはならない。
ownerが確認できない場合、またはroot marker・manifest・CODEOWNERS・trust scriptのいずれかが欠落/変更された場合は、promotionとdeployを実行しない。
