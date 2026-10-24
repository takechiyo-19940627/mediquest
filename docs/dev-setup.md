# 開発環境セットアップ(2026-09-04)

> ディレクトリ分割後、この資料の Rust・Dioxus の技術構成と開発手順は `learning-rust/` を対象とします。実用側の `app/` は [実用アプリの技術方針](app-architecture.md) を参照してください。
> 開発コマンドは `learning-rust/` 内で実行してください。以下の `CLAUDE.md` は `learning-rust/CLAUDE.md` を指します。

対象: macOS (Apple Silicon)、Doom Emacs(Emacs 30.2 / doom+ 26.06)、Rust stable。

## 1. Rust ツールチェーン(済)

```sh
rustup component add rust-analyzer   # 済。~/.cargo/bin/rust-analyzer は rustup のプロキシなので component 本体が要る
cargo install rustlings --locked      # 済。演習ディレクトリは ~/projects/rustlings(`cd ~/projects/rustlings && rustlings`)
```

`rust-toolchain.toml` で stable と必要コンポーネント(rustfmt / clippy / rust-analyzer / rust-src)を固定している。

## 2. Doom Emacs(要・本人作業)

### 2.1 `~/.doom.d/init.el`

`doom!` の各セクションに以下を追加する(コメントは既存の行に合わせて任意)。

```elisp
:editor
(format)              ; apheleia。Rust だけ保存時 rustfmt にする(config.el 参照)。+onsave は付けない

:tools
(lsp +eglot)          ; Emacs 組み込みの eglot を使う。lsp-mode は使わない

:lang
(rust +lsp)           ; rustic + rust-analyzer(+lsp があると eglot 経由になる)
```

`:checkers syntax`(flycheck)は有効のまま。eglot の診断は flycheck-eglot 経由で表示される。

### 2.2 `~/.doom.d/config.el`

末尾に追加:

```elisp
;;; Rust ------------------------------------------------------------------
;; rust-analyzer に clippy で検査させる(保存時に clippy の警告も出る)
(setq-default eglot-workspace-configuration
              '(:rust-analyzer (:check (:command "clippy")
                                :cargo (:allTargets t))))

;; Rust バッファだけ保存時に rustfmt(apheleia)を走らせる
(add-hook 'rustic-mode-hook #'apheleia-mode)
```

### 2.3 反映

```sh
doom sync
```

終わったら Emacs を再起動する。Claude Code のセッションは `claude --resume` で戻せる。

### 2.4 動作確認(本リポジトリの `.rs` を開いて)

| 確認項目 | 操作 | 期待 |
|---|---|---|
| eglot 接続 | モードラインに `eglot` 表示 | rust-analyzer が起動する |
| 補完 | `mediquest_core::` と打つ | `quote` が候補に出る |
| 定義ジャンプ | `contains_verbatim` 上で `gd` | `crates/core/src/quote.rs` へ飛ぶ |
| ドキュメント | 識別子上で `K` | eglot-help がポップアップ |
| 診断 | 未使用変数を書いて保存 | flycheck の警告が行に出る |
| 整形 | インデントを崩して保存 | rustfmt で戻る |
| cargo test | `SPC m t a` | `*rustic-compilation*` にテスト結果 |
| 現在のテスト | テスト関数内で `SPC m t t` | そのテストだけ走る |
| clippy | `SPC m b C` | 警告 0 |

主要キー(`SPC m` = localleader): `b b` build / `b r` run / `b C` clippy / `t a` test / `t t` current test。
`gr` 参照検索、`SPC c r` リネーム、`SPC c a` コードアクション。

## 3. 既知の罠

- **CC=gcc-16**: シェルや Emacs の環境に Homebrew GCC が `CC` として残っていると、aws-lc-sys(reqwest の rustls 依存)が Apple SDK ヘッダで失敗する。本リポジトリは `.cargo/config.toml` で `/usr/bin/clang` を強制済み。Emacs を起動する端末で `CC` を export しないこと
- **dioxus-cli**: crates.io の最新が 0.8 alpha。`cargo install dioxus-cli --version "^0.7" --locked` と明示する
- **reqwest 0.13**: TLS feature は `rustls`(`rustls-tls` は無い)
- **クレート名 `core`**: 標準ライブラリと衝突するので `mediquest-core`
- **日本語テスト名**: 可。ただし `DB` のような大文字英字を含むと clippy の non_snake_case 警告

## 4. ワークスペースの決定事項(コードは本人が書く)

構成は `CLAUDE.md` の「アーキテクチャ方針」のとおり(core / usecase / infra/{ai,storage} / ui/{cli,app})。
パッケージ名は `mediquest-` 接頭辞、edition 2024(現在の `Cargo.toml` は `dx new` 雛形の 2021 なので、ワークスペース化のときに 2024 へ揃える)、
依存はルート `Cargo.toml` の `[workspace.dependencies]` に一元化して各クレートから `{ workspace = true }` で参照する。

| クレート | バージョン | feature / 備考 |
|---|---|---|
| dioxus | 0.7 | `fullstack`, `router`。`ui/app` のみ。`web` / `server` は app 側の feature で切り替える |
| serde | 1 | `derive` |
| serde_json | 1 | |
| tokio | 1 | `rt-multi-thread`, `macros`。サーバー側のみ |
| reqwest | 0.13 | `default-features = false`, `json`, `rustls`, `http2`, `charset`。サーバー側のみ(クライアントは API を直接呼ばない)。OpenSSL 非依存 |
| rusqlite | 0.40 | `bundled`。OS の libsqlite3 に依存しない。サーバー側のみ |
| rusqlite_migration | rusqlite 0.40 対応版を crates.io で確認 | マイグレーション。`validate()` をテストに置く |
| clap | 4 | `derive`。cli のみ |
| anyhow / thiserror | 1 / 2 | anyhow は cli の main だけ。ライブラリクレートは thiserror |

keyring は不採用(2026-09-14)。API キーはサーバーだけが持つため不要。
サーバー側専用の依存(tokio / reqwest / rusqlite / usecase)は `ui/app` では `server` feature の時だけ有効にし、WASM ビルドに混ぜない。

確認手順: `cargo build --workspace` → `cargo test --workspace` → `cargo clippy --workspace --all-targets` → `cargo fmt --all -- --check`。
2026-09-04 に同じ構成で一度全部通ることを確認済み(その雛形は本人の希望で削除した)。

## 5. API キー

`ANTHROPIC_API_KEY` を環境変数で渡す。読むのはサーバー側(`dx serve` のサーバープロセスと cli)だけで、クライアント(WASM)には一切渡さない。
Emacs から見えるようにするには、ログインシェルで export した状態で `doom env` を実行して `~/.emacs.d/.local/env.el` に取り込む(この env.el は git 管理外)。
確認: Emacs の vterm で `echo ${ANTHROPIC_API_KEY:+set}` が `set` を返すこと。
