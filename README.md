# mediquest

AI を使った問題演習アプリ。Rust 学習と実用アプリの開発を分けて進めます。

- `learning-rust/`: Rust・Dioxus の学習用。既存の実装と開発設定を移しています。
- `app/`: アイデアを早く実用化するためのアプリ。Nuxt / Vue + TypeScript と Nuxt のサーバー機能を採用します。
- `docs/`: 要求定義などの資料。既存資料の Rust 前提の技術選定は学習側の参考とし、実用側は [技術方針](docs/app-architecture.md) を参照してください。

Rust 関連の開発コマンドは `learning-rust/` 内で実行してください。

実用アプリの残作業と受入完了条件は [初回リリース計画](docs/first-release-plan.md) を参照してください。

招待制インターネット公開に向けた認証・認可・サーバー構成の合意は [公開設計](docs/internet-release-design.md) を参照してください（設計段階・公開対応未実装）。
