# Mediquest の限定事前許可

ユーザーは開発の都度TTY承認を求める案を取り消し、Mediquestの編集と承認済みの開発検証を事前許可する方針に変更した。旧 `takt-approval-design.md` の対話コールバック試作は未接続のまま保持する。

TAKT 0.49.0 の project `provider_options.claude.allowed_tools` に、`bash scripts/app-command.sh <固定操作>` と固定の git 読取コマンドのみを登録する。任意 Bash / node / npx / npm install、bypassPermissions、sandbox無効化、グローバル設定変更は追加しない。

固定操作は `ci`、`format`、`format:check`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:e2e`、`build`、`dev`、`browser:install`、`quality`、`versions`。引数追加や未知操作は拒否する。作業ディレクトリをリポジトリ直下へ固定し、nodenv Node 24.15.0、npmキャッシュとChromium保存先をそのworktreeの `app/.cache/` に固定する。TAKT自身のNode 20.19.0とは区別する。Chromium導入は既存依存の `app/node_modules/playwright/cli.js install chromium` のみ。

これは **Mediquestの編集可能なコードと、npm ciの依存lifecycleを実行する許可** であり、文字列allowlist自体はOS隔離ではない。npm scriptsが実行するコードも承認範囲である。許可リストや設定自身の変更、秘密情報の取得、実AI課金、外部公開は含まない。

## 工程と実行境界

- `implement/fix` の edit:true 工程には事前許可Bashが届く。編集はappの実装を対象とし、設定・制御スクリプト等はprojectの編集denyにする。
- `plan/review/finalize` の edit:false 工程ではTAKT engineがBash許可を除去する。これを緩和しない。ソースと検証レポートを読み、コマンドによる再検証はimplement/fixまたは監督者へ戻す。レポート保存はTAKT host側が行う。
- 最終quality gateはTAKT hostから同じ `app-command.sh quality` を実行する。既存承認済みのhost検証であり、Claude sandboxの外にある。全工程がsandbox隔離されるとは主張しない。

`.claude/settings.json` はsandbox enabled / failIfUnavailableをtrue、自動Bash許可とunsandboxed実行をfalse、除外コマンドを空にする。依存・Chromium配布先とlocalhostを指定し、制御設定・秘密ファイルへのアクセスを制限する。sandbox起動やブラウザ実行が環境上できなければ失敗として扱い、設定を勝手に緩和しない。

`provider: claude` はSDK providerではなくheadless CLIである。TAKTは `--allowed-tools` とsandboxの2項目をCLIへ渡すが、`--setting-sources project` は付けない。user/local/managed設定が継承されるため、projectだけの許可が実効設定の全てとは保証できない。`scripts/takt-preflight.mjs` は既知のローカル継承設定の追加allow、hooks、sandbox緩和等を読取検出して実行前に停止する。設定内容は出力せず、グローバル設定も書き換えない。リモートmanaged設定、未知の注入経路、実行中の設定変更まで網羅する隔離機構ではない。

未許可操作はheadlessの拒否として停止・報告し、別コマンドやTTY承認へ迂回しない。実CLIの設定mergeと各操作の許否は実スモークで確認が必要で、loader/doctorだけでは実行成功を主張しない。既存queueロック・並列上限・失敗履歴・独立レビュー/マージ条件は維持する。

## オフライン検証

```sh
node --test scripts/takt-preauthorization.test.mjs
node scripts/check-takt-preauthorization.mjs /path/to/reviewed/takt-0.49.0
bash scripts/takt.sh workflow doctor .takt/workflows/mediquest-app.yaml
```

固定launcherテストは偽nodenvで引数とcache/runtimeを検査する。loader回帰は実TAKTのproject/workflow loader、engineのeditフィルター、headless clientを使い、**引数だけ記録する偽CLI** への伝達を確認する。実Claude/SDK、モデル、ネットワーク、TAKT queueは実行しない。これらの成功と実sandbox/実開発の成功は別の証拠である。

## trusted CLI 設定への伝達（PR37 の追補修正）

2026-10-25 に `claude --version` で 2.1.310 を確認した。[公式 sandboxing 文書](https://code.claude.com/docs/en/sandboxing#repository-settings-under-an-admin-required-sandbox) は、2.1.285以降に `--settings` の `allowUnsandboxedCommands:false` でadmin-requiredとなり、projectの `network.allowedDomains` と `allowLocalBinding:true` が無視されると説明している。TAKT 0.49.0 がCLIへ渡す2項目と、projectの通信許可だけでは npm registry / localhost が許可されなかった。

`scripts/takt.sh` は実行モードだけで、TAKT正式の `TAKT_CLAUDE_CLI_PATH` に `scripts/claude-trusted.mjs` を指定する。wrapperはTAKTの厳格な2項目以外のsandbox指定、設定の重複や危険なCLI上書きを拒否し、レビュー済みの固定network許可を同じ `--settings` に載せる。projectファイル全体や任意の追加許可をtrusted scopeへ昇格しない。enabled / failIfUnavailable はtrue、autoAllowBashIfSandboxed / allowUnsandboxedCommands / filesystem.disabled はfalse、excludedCommandsは空のままである。projectのdeny設定は引き続き適用され、グローバル設定を変更しない。

[公式 filesystem isolation の説明](https://code.claude.com/docs/en/sandboxing#which-settings-can-disable-it) に沿って、preflightは継承された `sandbox.filesystem.disabled:true` も起動前に拒否する。ユーザー設定を自動修正せず、該当設定の見直しが必要なことを報告する。管理設定優先の制約や未知の設定注入まで上書きできる保証はしない。

回帰は実TAKTのCLIパスresolver→headless client→wrapper→偽CLIまで接続し、trusted scopeの通信設定と従来のコマンド許可・読み取り工程の制限が保持されることを確認する。ネットワークを実際に通す試験ではない。Issue36の失敗履歴や作業ツリーは保持し、この修正段階ではTAKT再実行・拒否された依存導入の再試行を行わない。
