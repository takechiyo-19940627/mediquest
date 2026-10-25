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

## ブラウザ配布先と公開設定例

Issue36の実行で npm ci は成功したが、Chromium配布のリダイレクト先と `.env.example` の読取りが拒否された。拒否を別コマンドで回避せず、以下を独立した設定修正として扱う。

- Playwrightはlockfileで1.64.1を固定。導入済み同版の `playwright-core/browsers.json` はChromium revision1248 / Chrome for Testing156.0.8078.4を指定し、`lib/coreBundle.js` の `cftUrl` は `https://cdn.playwright.dev/builds/cft/<version>/<platform>/<archive>` を構成する。実行ログで `storage.googleapis.com:443` へのredirect拒否を確認した。[Google公式Chrome for Testing配布情報](https://github.com/GoogleChromeLabs/chrome-for-testing) の配布先は `https://storage.googleapis.com/chrome-for-testing-public/<version>/...`。この完全一致ホストをprojectとtrusted CLI双方へ追加する。ワイルドカードや別mirrorは追加しない。
- sandboxの `allowedDomains` はホスト単位であり、同ホストのbucket/pathまでは制限しない。Chromeのarchiveだけに技術的に限定できたとは主張しない。許可済み固定 `browser:install` と版固定依存を使い、任意ダウンロードコマンドは追加しない。[Playwright公式導入資料](https://playwright.dev/docs/browsers) のdownload host overrideは使用しない。
- 秘密を持たない公開記入例は `app/environment.example` に改名する。`.env` / `.env.*` のRead denyとsandbox denyReadはそのまま保持し、Gitの旧example例外も除く。READMEの参照だけ更新し、format走査や品質ゲートは除外しない。実際の秘密は `.env` 等に保存し、公開例へ記入しない。

この修正の回帰は設定と公開例の契約のみを検査する。実ブラウザ導入・TAKT再実行は別の確認事項であり、この段階で成功とは扱わない。

## レビュー前のhost品質証拠

`mediquest-app` はimplement/fixの実装報告後、readonly reviewへ遷移する前に、hostの `app-command.sh host-quality` で既存の全7チェックを実行する。実装者はsandboxで実行不能な検証を成功扱いしないが、実装が完成している場合は制約を記録してdoneを返し、hostゲートへ進める。仕様・認証の進行不能は引き続き停止する。host失敗はTAKTが同じ工程へ返し、max_steps=12と監督の同一原因上限を維持する。

証拠はGit管理外 `.takt/quality/latest.json` とattempt UUID別JSON/log。worktree実パス、Git管理対象と未追跡・非ignoreソースの内容/モード/リンクを含むSHA256、全7チェック名、開始/終了時刻、status、終了コード、log hashを保存する。起動直後に旧成功を無効化し、runtime不在・実行失敗・中断・検証中のソース変更は成功にしない。readonly reviewerは直前の証拠とlogを読み、attemptIdを報告に引用し、コードとテストを独立レビューする。finalizeでは再度全ビルドを繰り返さず、host verifierが現在ソース・worktree・logの一致と全7成功を検証する。内容が変われば最終ゲートは失敗し、監督が原因を調べて既存の再試行上限内で実装工程から全7と独立レビューを取り直す。新しいimplement/fixを通らず古いattemptを選択する操作はしない。

host検証はClaude sandbox外の承認済み処理であり、workerにはhost-quality操作のBash許可を追加しない。`.takt`と制御scriptsの編集禁止も維持する。証拠は署名付き第三者証明ではなく、監督・CI・独立レビューを置き換えない。Git ignoreされた実データや依存展開物そのものはソースsnapshot対象ではなく、版固定lockfileと実行した検証を証拠に含める。

TAKT0.49のcommandGateRunnerはHOME/NODENV_ROOTを渡さない。固定launcherはNODENV_ROOT未設定時のみシェルのユーザーホーム解決で `.nodenv` を選び、Node24.15.0を検証する。HOMEや秘密を含む親環境全体は復元しない。`check-takt-host-quality.mjs` は実commandGateRunner＋偽nodenvで、この環境とruntime失敗時の旧証拠無効化を検査する。実LLM・queue・アプリゲートは動かさない。

## readonly最終ゲート失敗と版固定ローカルTAKT

TAKT0.49.0のquality gate失敗はdoneルールより先に処理され、同じ工程へ戻る。readonly finalizeでは修復できず、fixルールを追加するだけでは遷移できない。このため `scripts/takt-local-patch.mjs` で**新しいローカルコピーだけ**に `readonly-quality-abort-v1` を適用する。グローバルインストールは変更しない。元package名/version=TAKT0.49.0と `WorkflowRunLoop.js` のSHA256を固定し、不一致・既存出力先には適用しない。コピーに元ソースとpatch markerを保存し、利用前に元hashと生成後hashを再検証する。異なる版への自動適用は禁止。

patchは `step.edit === false` のgate失敗だけを、失敗snapshot保存後に `[readonly_quality_gate_failed]` 理由でabortする。edit:trueとedit未指定の既存再試行は変えない。連続runloopと単工程の両方で、通常gateと子工程から返る `qualityGateFailure` の4分岐を対象とする。このworkflowは並列stepを定義しない。実parallel orchestration自体の動作検証は範囲外で、共有runloopへの子失敗伝達を回帰で検査する。監督は停止原因を確認して既存上限内で実装修復・全7・独立レビューを取り直し、自動で失敗回数をリセットしない。

準備と検証（live queueへ接続する前に独立レビューが必要）:

```sh
node scripts/takt-local-patch.mjs prepare /path/to/takt-0.49.0 /new/local/copy
node scripts/check-takt-readonly-abort.mjs /new/local/copy
```

queue adapterは選択packageを検証してから読み込み、同じ実パスを `TAKT_PACKAGE_DIR` としてlauncherへ渡す。launcherも実行モードでは再検証する。未patchのglobal既定や改変コピーは実行を拒否する。診断doctor等は従来どおり実行できる。実行時にpatchを自動生成・適用しない。ローカルコピーへの準備と回帰はTAKT task/model/ネットワークを動かさない。

## TAKT内の実装・修正をCodexへ切替

ユーザーの明示依頼により、workflowのimplement/fixだけ `provider: codex`、`required_permission_mode: edit`、`provider_options.codex.network_access:false` とする。plan/review/finalizeはproject既定のClaude/readonlyを維持する。TAKTの外で代行する切替ではなく、host全7ゲート・失敗上限・ローカルTAKT patch・独立レビューは同一である。モデル名は指定しない。

TAKT0.49の実装はCodex SDKを使い、editをworkspace-write、readonlyをread-onlyへ変換する。Claudeのallowed_toolsと `.claude/settings.json` はCodexを制御しないため、正式な `TAKT_CODEX_CLI_PATH` で `scripts/codex-scoped.mjs` を通す。Codex CLI0.163.0を起動時に確認し、未検証の版は停止する。SDKの旧JSONフラグは現行の `--json` へ変換する。

[公式permissions資料](https://developers.openai.com/codex/permissions) に従い、legacy `--sandbox` を同等の組込みprofileを継承するnamed profileへ変換する。これに制御dirのreadonlyと秘密ファイルのdenyを加え、network無効、approval_policy=never、web_search無効を固定する。user config/rulesは読まず認証ストレージは従来どおり使用する。実際のGit worktree rootと起動cwdのrealpath一致を必須とし、subdirectory起動を拒否する。project/system configが存在する場合はlegacy sandbox設定によるprofile無効化を避けるため起動を拒否し、監督へ確認を返す。グローバル設定は変更しない。

CodexにはClaudeの文字列Bash allowlistを適用したとは主張しない。Codexの操作は限定filesystem profile内で実行され、境界外の昇格やネットワークは許可しない。npm ciやChromium取得が必要ならhostで承認済みの準備を行う。appソースと依存lifecycleの実行許可であり、全工程をOS隔離したという意味ではない。

`check-takt-codex.mjs` は実TAKT loader・Codex client・SDKからwrapperを経て偽CLIへ接続し、担当分離、sandbox/profile変換、network/approval拒否を検査する。実モデル・通信・TAKT taskは動かさない。CLI版確認とこの回帰だけで実OSのdeny動作まで実証したとは扱わず、初回live再開には独立レビューと監督判断が必要。

## Codex runtimeを認証ディレクトリから分離

Issue52 attempt2では、`~/.local/bin/codex` の実体が `~/.codex/packages/standalone/releases/0.163.0-aarch64-apple-darwin/bin/codex` だった。filesystem profileの `~/.codex = deny` がAGENTS読込み用helper自身のexecを拒否した。macOS Seatbeltでこのdenyだけを掛けた最小再現でも元リンクはexit71、同一バイナリの別配置は `--version` exit0になった。これは実行位置の衝突の再現であり、全profileやモデル/TAKT実行成功の証拠とは別である。

秘密ディレクトリのdenyを緩めず、`scripts/codex-runtime.mjs` で版固定のnative executableと同梱 `codex-code-mode-host` だけをGit管理外 `.takt/runtime/codex-0.163.0-darwin-arm64/` にコピーする。認証・設定・履歴はコピーしない。両artifactのSHA256をレビュー対象として固定し、既存出力先・異なる版/内容/プラットフォームは拒否する。launcherは毎回hashを確認し、失敗時にPATHや元リンクへfallbackしない。wrapperもrealpathがcredential deny対象配下でないことを確認する。グローバルのCodex配置は変更しない。

```sh
node scripts/codex-runtime.mjs prepare /path/to/installed/codex .takt/runtime/codex-0.163.0-darwin-arm64
```

このコピーはTAKTを起動する管理側repoに事前準備する。workerの実装対象やGit成果物に含めない。`.takt`はworkerからreadonlyであり、ユーザー領域の認証情報は従来どおりdenyのまま。Issue52のqueue/retry回数はこの準備で変更しない。次回の実タスク再開は独立レビューと監督判断後に行う。

## host-ready判定と品質判定の区別

Issue52 attempt3ではPhase3 judgeがhostゲート前に「全7未確認」を理由にABORTを選び、その後host全7が成功しても保存済み判定が適用された。実装者向けinstructionsだけでなく、judgeが読むimplement/fixのrulesを「実装/修正完了、host検証へ引継ぎ可能」と定義する。sandbox制約や今回hostゲート待ちは引継ぎ条件に含め、品質成功とは区別する。実装自体の進行不能、仕様・認証判断、既定失敗上限は停止理由として維持する。

全7hostゲートは省略せず、失敗ならreviewへ進まない。成功しても真のABORTを強制的に上書きしない。実runloop回帰では、事前ABORT+host成功の元挙動、host-ready+host失敗の同工程保持、成功後のreview遷移を検査する。静的条件テストと偽response回帰は実モデルの語義判断の安定性を保証しない。Issue52の到達済み再試行上限やqueueはこの修正で変更しない。
