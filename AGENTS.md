# 開発方針

- `learning-rust/` は Rust・Dioxus の学習用。配下の `AGENTS.md` を参照する。
- `app/` は実用アプリ用。Nuxt / Vue + TypeScript と Nuxt のサーバー機能を採用する。詳細は `docs/app-architecture.md` を参照する。
- `docs/` は共有資料。既存資料の Rust 前提の技術選定は学習側の参考であり、実用側への採用決定ではない。
- 両ディレクトリの実装や依存関係は独立させる。

- 実用アプリの開発プロセスは `docs/development-process.md` を参照する。TAKT/CIの整備状況を区別し、未実行チェックを成功として報告しない。

## 自律開発

- 継続的なIssue/TAKT/PR運用は `agents/AGENTS.md` と各役割に従う。ユーザーはIssue作成、並列TAKT、失敗改善、レビュー修正、条件を満たすPRのマージを承認済み。
- 監督・実装・独立レビューを分離し、独立した調査・レビューにはサブエージェントを使える。マージ条件や検証基準を弱めて完了にしない。
