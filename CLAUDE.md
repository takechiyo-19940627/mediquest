# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

mediquest は、書籍・Web ソースから AI で 4 択問題を生成し、演習・記録する自分専用アプリ(Rust 製)。
医療情報技師試験の学習用であり、同時に Rust とマルチプラットフォーム開発の学習題材でもある。
既存の Claude アーティファクト版(React + Claude API)を「動く仕様書」とした移植・発展版。

**現状: コード未着手、環境は準備済み(2026-09-04)。** ワークスペースは本人が自分で書く(下記「開発の進め方」参照)。
要求定義は `docs/requirements.md`(v0.1)が一次資料。実装前に必ず読むこと。設計判断・未決事項もそこにある。
開発環境(Emacs / ツールチェーン)の手順と既知の罠は `docs/dev-setup.md`。

## 技術スタック(決定済み)

- Rust stable、Cargo ワークスペース
- UI: **Dioxus 0.7.x**(0.8 alpha は使わない)、CLI は `dx`
- reqwest + tokio、serde / serde_json
- SQLite (rusqlite)、keyring(API キーは OS キーチェーンまたは環境変数。コードに埋め込まない)
- Anthropic Messages API(抽出・生成・再検証の 3 用途)

**Dioxus のバージョンに注意**: 0.4→0.7 で RSX 記法・フック API に破壊的変更がある。
参照するドキュメント・サンプル・生成コードが 0.7 前提か必ず確認する。

## コマンド

- `cargo build --workspace` / `cargo test --workspace` / `cargo test -p mediquest-core <test_name>`
- `cargo clippy --workspace --all-targets` / `cargo fmt --all`(コミット前に両方通す。warning 0 を維持)
- M2 以降: `dx serve`(デスクトップ)/ `dx serve --platform android`(モバイル)
- **dx の導入は必ず `cargo install dioxus-cli --version "^0.7" --locked`**。crates.io の最新は 0.8 alpha なのでバージョン指定を省くと alpha が入る

## 環境上の注意

- C 依存クレート(aws-lc-sys, libsqlite3-sys)は `.cargo/config.toml` で `CC=/usr/bin/clang` を強制している。シェルに `CC=gcc-16` があると Apple SDK ヘッダがコンパイルできず壊れるため。消さないこと
- reqwest は 0.13 系。TLS の feature 名は `rustls`(0.12 までの `rustls-tls` ではない)
- 依存バージョンはルート `Cargo.toml` の `[workspace.dependencies]` に一元管理。各クレートは `{ workspace = true }` で参照する
- API キーは環境変数 `ANTHROPIC_API_KEY`。ファイルにもコードにも書かない

## アーキテクチャ方針

```
crates/core/     mediquest-core     モデル(Source/Question/Record)、引用照合、正答率集計。他クレートに依存しない
crates/ai/       mediquest-ai       Anthropic API クライアント、抽出/生成/再検証プロンプト
crates/storage/  mediquest-storage  SQLite。sources / questions / records の 3 テーブル
crates/cli/      mediquest-cli      M1 の CLI(バイナリ名 mediquest)。UI なしで生成→演習→記録を通す
app/             (M2 で追加)        Dioxus UI(薄いガワ)
```

パッケージ名は `mediquest-` 接頭辞(`core` は標準ライブラリの `core` と衝突するため)。
UI 層は将来差し替え可能にする。ビジネスロジックは core/ai/storage に置き、app/cli には持ち込まない。

## ドメイン上の重要な制約

- 各問題はソース本文からの **逐語引用 (quote)** を必ず持つ。quote とソース本文の完全一致を機械照合し、不一致は警告する
- 問題生成はソーステキストのみを根拠とする。ソースから正誤を確認できない問題は作らない
- 解答記録は「正解 / 不正解 / 問題誤り」の 3 値。**問題誤り(flawed)は出題と正答率の分母から除外**する
- AI の JSON 出力はコードフェンス除去+寛容パースで受ける。出力トークン上限を考慮し 1 回の生成問数を絞る
- 画像は抽出テキストのみ保存し、画像自体は破棄する(現方針)

## UI 方針

- スマホ前提(max-width 640px 相当、タップ操作)、ダークテーマ
- 日本語 UI。専門用語はそのまま表示

## 開発の進め方(本人の希望)

- **コードは本人が書く。Claude は書かない。** 理解のために自分で書きたいという本人の明確な希望(2026-09-04)。Claude の役割はレビュー、解説、エラーの読み解き、設計相談、参考リンクの提示。求められない限りソースファイルを生成・編集しない
- 依存のバージョンと feature の決定事項は `docs/dev-setup.md` の表を参照(reqwest 0.13 は `rustls`、rusqlite は `bundled` など)
- テスト名は日本語で可。ただし大文字英字を含めると clippy の non_snake_case に当たる
- 並行して rustlings(`~/projects/rustlings`)で基礎を進めている

## ロードマップ

M1: ワークスペース + core + CLI で生成→演習を通す → M2: Dioxus デスクトップ 5 画面 → M3: Android 動作確認 → M4: 仕上げ
