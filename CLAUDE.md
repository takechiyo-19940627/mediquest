# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

mediquest は、書籍・Web ソースから AI で選択式問題を生成し、演習・記録するアプリ(Rust 製)。
医療情報技師試験の学習用であり、同時に Rust とマルチプラットフォーム開発の学習題材でもある。
既存の Claude アーティファクト版(React + Claude API)を「動く仕様書」とした移植・発展版。
利用者は当面本人のみだが、「友人に配る」程度の他者利用を想定して `user_id` を最初から持たせる。

**現状: 設計決定済み、コード未着手(2026-09-14)。** ワークスペースは本人が自分で書く(下記「開発の進め方」参照)。
要求定義は `docs/requirements.md`(v0.2)が一次資料。実装前に必ず読むこと。設計判断の経緯は設計ツリー
(https://claude.ai/code/artifact/b895fc0c-6e4c-4623-82fb-b84311dea84b)にある。
開発環境(Emacs / ツールチェーン)の手順と既知の罠は `docs/dev-setup.md`。

## 技術スタック(決定済み)

- Rust stable、Cargo ワークスペース
- UI: **Dioxus 0.7.x fullstack**(0.8 alpha は使わない)、CLI は `dx`。クライアントは `web`(WASM)、サーバーは `server` feature
- サーバー関数(`#[post]` / `#[get]`)でクライアント / サーバー間を RPC。サーバーは axum + tokio
- reqwest + tokio(サーバー側のみ)、serde / serde_json
- SQLite (rusqlite、同期 API)+ rusqlite_migration(サーバー側のみ)
- Anthropic Messages API(抽出・生成・再検証の 3 用途)。API キーはサーバーの環境変数 `ANTHROPIC_API_KEY` のみ
- keyring は不採用。クライアントはキーを持たない

**Dioxus のバージョンに注意**: 0.4→0.7 で RSX 記法・フック API に破壊的変更がある。
参照するドキュメント・サンプル・生成コードが 0.7 前提か必ず確認する。

## コマンド

- `cargo build --workspace` / `cargo test --workspace` / `cargo test -p mediquest-core <test_name>`
- `cargo clippy --workspace --all-targets` / `cargo fmt --all`(コミット前に両方通す。warning 0 を維持)
- 実 API を呼ぶテストは `#[ignore]`。`cargo test -p mediquest-ai -- --ignored` で手動実行(課金あり)
- M2 以降: `dx serve`(Web、クライアントとサーバーを両方起動)/ `dx serve --platform android`(M3)
- **dx の導入は必ず `cargo install dioxus-cli --version "^0.7" --locked`**。crates.io の最新は 0.8 alpha なのでバージョン指定を省くと alpha が入る

## 環境上の注意

- C 依存クレート(aws-lc-sys, libsqlite3-sys)は `.cargo/config.toml` で `CC=/usr/bin/clang` を強制している。シェルに `CC=gcc-16` があると Apple SDK ヘッダがコンパイルできず壊れるため。消さないこと
- reqwest は 0.13 系。TLS の feature 名は `rustls`(0.12 までの `rustls-tls` ではない)
- 依存バージョンはルート `Cargo.toml` の `[workspace.dependencies]` に一元管理。各クレートは `{ workspace = true }` で参照する
- rusqlite / reqwest / tokio / usecase はサーバー側専用。`ui/app` ではこれらへの依存を `server` feature の時だけ有効にし、WASM ビルドに混ぜない
- API キーは環境変数 `ANTHROPIC_API_KEY`。ファイルにもコードにも書かない

## アーキテクチャ方針

```
crates/core/            mediquest-core     ドメイン型(Source/Question/Record/Answer/Outcome)、引用照合、正答率集計。serde 以外に依存しない
crates/usecase/         mediquest-usecase  手順の合成。struct App { db, ai } を第 1 引数で受ける。core + infra に依存
crates/infra/ai/        mediquest-ai       Anthropic API クライアント(具象)。プロンプト組み立てとパースは純粋関数。core に依存
crates/infra/storage/   mediquest-storage  SQLite。同期 API のまま書き tokio を知らない。core に依存
crates/ui/cli/          mediquest-cli      M1。source add / stats のバッチのみ。usecase を直接呼ぶ
crates/ui/app/          mediquest-app      M2。Dioxus fullstack。サーバー関数は usecase を呼ぶだけ
```

- パッケージ名は `mediquest-` 接頭辞(`core` は標準ライブラリの `core` と衝突するため)
- 依存の向きは ui → usecase → infra → core。infra 同士(ai と storage)は互いに依存しない。Cargo は階層を強制しないのでレビューで守る
- ビジネスロジックは core / usecase に置き、ui には持ち込まない。サーバー関数の中身は usecase の呼び出し 1 行にする
- サーバー関数の引数と戻り値は core の型(serde 対応)。将来 Dioxus 以外のクライアントが必要になったら独立 API に移せる形を保つ
- DB 接続は `Arc<Mutex<Connection>>`(`std::sync::Mutex`)。usecase が `tokio::task::spawn_blocking` で包んで storage を呼ぶ
- サーバー側の共有状態は `static APP: LazyLock<App>` で保持し、起動時に環境変数(DB パス、API キー、ポート)から初期化する
- trait による抽象化(AI クライアントや Store のモック)は行わない。困った関数にだけ後付けする
- エラーは各クレートが thiserror の enum を持ち、usecase が `#[from]` で包む。anyhow は cli の main だけ

## ドメイン上の重要な制約

- 各問題はソース本文からの **逐語引用 (quote)** を必ず持つ。quote とソース本文の完全一致を機械照合し、結果を `quote_verified` に保存、不一致は警告する
- 問題生成はソーステキストのみを根拠とする。ソースから正誤を確認できない問題は作らない
- 選択肢は **2〜6 個の可変**。形式は「1 つ選べ」「2 つ選べ」の 2 種類で、`enum Answer { Single(ChoiceIdx), Two(ChoiceIdx, ChoiceIdx) }` で表す
- `Question` は検証付きコンストラクタでのみ作れる。不変条件(選択肢数、index の範囲、Two の 2 つが相異なる)は一箇所に集約し、フィールドは private
- 解答記録は `enum Outcome { Correct, Wrong, Flawed }` の 3 値。**問題誤り(flawed)は出題と正答率の分母から除外**する
- ID は `i64`(SQLite の整数)、時刻は Unix 秒の `i64`。日時クレートは core に入れない
- 全テーブルに `user_id`。usecase の全関数は第 1 引数に `UserId` を取る。M2 までは固定値 1
- AI の JSON 出力はコードフェンス除去+寛容パースで受ける。出力トークン上限を考慮し 1 回の生成問数を絞る。生成は同期で待つ(遅ければ分割呼び出しへ)
- 画像はクライアントで縮小して送り、抽出テキストのみ保存する。画像自体は破棄する(決定)

## UI 方針

- スマホ前提(max-width 640px 相当、タップ操作)、ダークテーマ
- 日本語 UI。専門用語はそのまま表示
- 演習画面は「1 つ選べ」がタップで即判定、「2 つ選べ」が 2 つ選んで確定、の 2 モード

## 開発の進め方(本人の希望)

- **コードは本人が書く。Claude は書かない。** 理解のために自分で書きたいという本人の明確な希望(2026-09-04)。Claude の役割はレビュー、解説、エラーの読み解き、設計相談、参考リンクの提示。求められない限りソースファイルを生成・編集しない
- 設計相談では質問を 1 問ずつ出し、一覧や長い解説はアーティファクトにまとめる(ターミナルの表示が切れるため。2026-09-05)
- 依存のバージョンと feature の決定事項は `docs/dev-setup.md` の表を参照(reqwest 0.13 は `rustls`、rusqlite は `bundled` など)
- テスト名は日本語で可。ただし大文字英字を含めると clippy の non_snake_case に当たる
- 並行して rustlings(`~/projects/rustlings`)で基礎を進めている

## テスト方針

- core: 純粋関数のユニットテスト(引用照合、正答率、コンストラクタの検証)
- ai: パース関数を文字列フィクスチャで検証。実 API は `#[ignore]` で手動実行
- storage / usecase: `Connection::open_in_memory()` で実 SQL を通す。`Migrations::validate()` もここに置く
- ui: 当面テスト無し(`dx serve` で手動確認)。サーバー関数が 10 本を超えたら HTTP 経由の結合テストを検討

## ロードマップ

M1: ワークスペース + core / usecase / infra + CLI(バッチ)でソース登録→生成→DB 保存を通す
→ M2: Dioxus Web(fullstack)で 5 画面。演習・記録はここで初めて実装
→ M3: Android/iOS 動作確認、サーバーの置き場所(Tailscale か VPS)、必要なら認証
→ M4: 仕上げ
