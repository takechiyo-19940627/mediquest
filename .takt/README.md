# Mediquest の TAKT 設定

TAKT **0.49.0** に対応した実用アプリ用の workflow。限定事前許可の範囲と検証方法は [開発事前許可](../docs/takt-preauthorization.md) を参照。

## 検証

リポジトリ直下で実行する。

```sh
bash scripts/takt.sh workflow doctor .takt/workflows/mediquest-app.yaml
node --test scripts/check-app.test.mjs
```

`scripts/takt.sh` は `.takt/version` とCLIのバージョンを照合する。nodenvがある環境では、このプロセスのみ Node 20.19.0 を選ぶ。別の既存環境にTAKTがある場合は `TAKT_NODE_VERSION` で指定する。nodenvのglobal設定や、アプリのNode設定は変更しない。
nodenvがない場合はPATH上のTAKTを使用する。インストールや更新は自動で行わない。プロバイダー・モデル・認証は利用者の既存TAKT設定を継承し、APIキーはリポジトリに書かない。

## Issue から開始

例の123は実際のIssue番号に置き換える。先行Issueが完了しており、作業がコミットされている状態で実行し、TAKTの対話で独立した作業ツリーを選ぶ。

```sh
bash scripts/takt.sh --issue 123 --workflow mediquest-app
```

非対話実行は、専用のクリーンな作業ツリーでのみ行う。`--pipeline` はそのディレクトリを直接変更するため、通常の作業中チェックアウトで実行しない。

```sh
bash scripts/takt.sh --pipeline --issue 123 --workflow mediquest-app   --branch codex/issue-123 --auto-pr --draft
```

PRは明示指定時にのみ作成する。マージは `../agents/roles/integrator.md` の条件を満たした監督者、または人が行う。未コミットのローカル変更を入力として勝手に取り込ませない。

## フロー

`plan → implement → review →（必要なら fix → review）→ finalize`

- ローカルの persona/instruction/output-contract を参照し、グローバルの同名部品に依存しない。
- 編集は implement/fix のみ。計画・レビュー・最終報告は編集なし。
- 最大12ステップ。上限を外すオプションで実行しない。
- 各工程のレポートを保存する。実行ログ・キューはGit管理外。
- 最後にTAKT自身が `bash scripts/app-command.sh quality` を実行する。文字列の「確認してください」だけのゲートではない。
- このスクリプト実行のためプロジェクト限定で `workflow_command_gates.custom_scripts: true` を設定している。設定とゲート自体の変更はレビュー対象とする。

## 品質ゲートの契約

`app/package.json` に以下のscriptsが全て必要。ゲートが順番に `npm run` で実行し、一つでも失敗すれば不合格とする。

1. `format:check`
2. `lint`
3. `typecheck`
4. `test:unit`
5. `test:integration`
6. `test:e2e`
7. `build`

インストール用のパッケージマネージャーの採用は別途行う。チェック時にはNode/npmがPATHに必要。各コマンドの上限は5分、TAKTゲート全体は40分。必要な時間が増えた場合は根拠を添えて更新する。
アプリのscriptsと品質ゲートは導入済み。ドキュメントのみのタスクにはこのアプリ用workflowを適用しない。

ゲートの実装には成功・失敗・未整備・タイムアウトと実際のnpm実行を確認するテストがある。テスト内の成功だけ返す仮コマンドはゲート自身の試験用であり、アプリの品質確認の代用ではない。

## CI と制約

`.github/workflows/process-checks.yml` はゲート自身のテストとラッパーの構文を確認する。アプリのCIではない。
TAKT workflowは0.49.0の `workflow doctor` で検証済み。実プロバイダーによるIssueからPRまでの試行、アプリCI、GitHub必須チェック・権限の設定は後続。
チェック設定もAIが編集できるため、これだけで改変に対する強制力を保証しない。CIの独立実行・保護設定・人による設定差分の確認を組み合わせる。

## 自律運用

監督手順は [agents/AGENTS.md](../agents/AGENTS.md)。同時実装は最大2タスク、TAKT実行プロセスは1つ。queueの変更とrunをロック付きアダプターで直列化する。実行中のqueueには追加しない。

### キュー操作（TAKT 0.49.0専用）

```sh
node scripts/takt-queue.mjs inspect
node scripts/takt-queue.mjs enqueue-issue /tmp/mediquest-issue.json
node scripts/takt-queue.mjs run
node scripts/takt-queue.mjs retry TASK_NAME /tmp/mediquest-investigation.md
node scripts/takt-queue.mjs enqueue-pr /tmp/mediquest-pr-review.json
```

Issue JSONは `gh issue view N --json number,title,body,state` の結果。レビュー修正JSONは監督者が同一repoの最新PRから取得した `number/title/state/isCrossRepository/headRefOid/headRefName/baseRefName` と、`body` に具体的な修正指示、`reviewFingerprint` にコメントID・更新日時・head SHAから計算したSHA256を設定する。受け入れたPRのheadが変わっていないか実行前にも確認する。

追加・再試行・runは共通ロックで排他。inspectは実行中も読み取り可能。生の `takt add/run/watch` と同時に使わない。pending上限2、再試行は初回を含む合計3回、pr_failedは再生成せずPR公開だけ復旧する。
`.takt/supervisor-queue.lock/owner.json` を残したプロセスが死んだ場合は、実行コマンド・開始時刻・子プロセス・queueを照合してから監督者が復旧する。ロックを無条件に削除しない。
TAKT内部APIの利用を0.49.0に固定している。更新やローカルforkには互換テストが必要。`TAKT_PACKAGE_DIR` を指定すると、queue操作と実行の両方で同じインストールを使う。

### 定期監督

Codexのこのタスクに30分間隔のheartbeat「Mediquest 自律開発監督」を設定済み。監督者が役割指示を読み、状態確認・改善・新規投入・条件付きマージを行う。PC/Codexが動いており、GitHubとTAKTの認証が利用できることが前提。常時サーバーとしての稼働は保証しない。

### ベースブランチと既存失敗の復旧

Issueの`base_branch`はブランチ名`main`を指定する。TAKT 0.49.0は`origin/main`などのremote-tracking refを拒否する。
旧アダプターが投入した`origin/main`で失敗したIssueは、調査メモを添えた通常の`retry`で復旧する。共通ロック内でTAKTのTaskStoreを使い、対象タスクのベース名だけを`main`へ修正してから再投入する。Issue・タスク名・失敗履歴を維持し、再試行回数上限も適用する。queueを直接編集しない。

`run`前に`origin/main`をfetchし、失敗時は起動しない。ローカル`main`が存在する場合は取得したrefと一致することも要求する。TAKT内の再fetchが失敗しても古いローカルmainへフォールバックさせないためである。古いmainがある場合は監督者が他のworktreeで使われていないこと・祖先関係を確認し、fast-forwardのみで更新してから再開する。ユーザーの変更をresetで消さない。TAKTの`auto_fetch`はグローバル設定専用のため、プロジェクト設定には追加しない。
