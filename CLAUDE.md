# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

mediquest は、書籍・Web ソースから AI で 4 択問題を生成し、演習・記録する自分専用アプリ(Rust 製)。
医療情報技師試験の学習用であり、同時に Rust とマルチプラットフォーム開発の学習題材でもある。
既存の Claude アーティファクト版(React + Claude API)を「動く仕様書」とした移植・発展版。

**現状: コード未着手。** 要求定義は `docs/requirements.md`(v0.1)にあり、これが唯一の一次資料。
実装を始める前に必ず読むこと。設計判断・未決事項もそこに記載されている。

## 技術スタック(決定済み)

- Rust stable、Cargo ワークスペース
- UI: **Dioxus 0.7.x**(0.8 alpha は使わない)、CLI は `dx`
- reqwest + tokio、serde / serde_json
- SQLite (rusqlite)、keyring(API キーは OS キーチェーンまたは環境変数。コードに埋め込まない)
- Anthropic Messages API(抽出・生成・再検証の 3 用途)

**Dioxus のバージョンに注意**: 0.4→0.7 で RSX 記法・フック API に破壊的変更がある。
参照するドキュメント・サンプル・生成コードが 0.7 前提か必ず確認する。

## 予定コマンド(ワークスペース作成後)

- `cargo build` / `cargo test` / `cargo test -p <crate> <test_name>`
- `dx serve`(デスクトップ)/ `dx serve --platform android`(モバイル)

## アーキテクチャ方針

```
crates/core/     モデル(Source/Question/Record)、引用照合、正答率集計
crates/ai/       Anthropic API クライアント、抽出/生成/再検証プロンプト
crates/storage/  SQLite。sources / questions / records の 3 テーブル
app/             Dioxus UI(薄いガワ)
```

UI 層は将来差し替え可能にする。ビジネスロジックは core/ai/storage に置き、app には持ち込まない。

## ドメイン上の重要な制約

- 各問題はソース本文からの **逐語引用 (quote)** を必ず持つ。quote とソース本文の完全一致を機械照合し、不一致は警告する
- 問題生成はソーステキストのみを根拠とする。ソースから正誤を確認できない問題は作らない
- 解答記録は「正解 / 不正解 / 問題誤り」の 3 値。**問題誤り(flawed)は出題と正答率の分母から除外**する
- AI の JSON 出力はコードフェンス除去+寛容パースで受ける。出力トークン上限を考慮し 1 回の生成問数を絞る
- 画像は抽出テキストのみ保存し、画像自体は破棄する(現方針)

## UI 方針

- スマホ前提(max-width 640px 相当、タップ操作)、ダークテーマ
- 日本語 UI。専門用語はそのまま表示

## ロードマップ

M1: ワークスペース + core + CLI で生成→演習を通す → M2: Dioxus デスクトップ 5 画面 → M3: Android 動作確認 → M4: 仕上げ
