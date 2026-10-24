# 実用アプリ

アイデアを早く動く形にして、実際に使うための開発ディレクトリです。

Nuxt / Vue + TypeScript と UI ライブラリの Nuxt UI を採用し、バックエンドも Nuxt のサーバー機能で実装します。Node.js 上でまずローカルの Web アプリとして利用し、将来はリモートサーバーへの移行、必要に応じたアプリ化を検討します。

デザインはティールを基調とし、ライト・ダークの両テーマに対応します。

詳細は [実用アプリの技術方針](../docs/app-architecture.md) を参照してください。DB は SQLite、DB アクセスは Drizzle ORM、マイグレーションは Drizzle Kit を採用します。実装や依存関係はまだ追加していません。
機能要件は [要求定義](../docs/requirements.md) を参考にします。

UI 実装時は [UI ガイド](../docs/ui-guidelines.md) を参照してください。

教材登録と AI による問題生成は管理者ページで行い、管理者が内容に責任を持ちます。学習者は管理者が用意した問題で演習します。

演習・中断再開・管理者による公開・不備報告のルールは [UX 方針](../docs/ux-guidelines.md) を参照してください。

初期版の対象画面とデータ構造は [画面一覧・DB設計](../docs/screens-and-data-model.md) を参照してください。

Issue・TAKT・検証・レビュー・PRの進め方は [開発プロセス](../docs/development-process.md) を参照してください。TAKT専用workflowと検証ゲートは整備済みです。実行方法は [TAKT設定](../.takt/README.md) を参照してください。アプリ本体とそのCIは未構築です。
