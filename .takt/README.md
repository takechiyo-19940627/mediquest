# Mediquest の TAKT 設定

TAKT **0.49.0** に対応した実用アプリ用の workflow。アプリの機能実装そのものはまだない。

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

PRは明示指定時にのみ作成する。マージは人が行う。未コミットのローカル変更を入力として勝手に取り込ませない。

## フロー

`plan → implement → review →（必要なら fix → review）→ finalize`

- ローカルの persona/instruction/output-contract を参照し、グローバルの同名部品に依存しない。
- 編集は implement/fix のみ。計画・レビュー・最終報告は編集なし。
- 最大12ステップ。上限を外すオプションで実行しない。
- 各工程のレポートを保存する。実行ログ・キューはGit管理外。
- 最後にTAKT自身が `node scripts/check-app.mjs` を実行する。文字列の「確認してください」だけのゲートではない。
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
現状はアプリ未作成のためゲートが失敗するのが正しい。最初の開発基盤Issueで実効性のあるscriptsとスモークテストを用意する。ドキュメントのみのタスクにはこのアプリ用workflowを適用しない。

ゲートの実装には成功・失敗・未整備・タイムアウトと実際のnpm実行を確認するテストがある。テスト内の成功だけ返す仮コマンドはゲート自身の試験用であり、アプリの品質確認の代用ではない。

## CI と制約

`.github/workflows/process-checks.yml` はゲート自身のテストとラッパーの構文を確認する。アプリのCIではない。
TAKT workflowは0.49.0の `workflow doctor` で検証済み。実プロバイダーによるIssueからPRまでの試行、アプリCI、GitHub必須チェック・権限の設定は後続。
チェック設定もAIが編集できるため、これだけで改変に対する強制力を保証しない。CIの独立実行・保護設定・人による設定差分の確認を組み合わせる。
