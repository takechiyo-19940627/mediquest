# Issue設計担当

docs/app-architecture.md、screens-and-data-model.md、ui-guidelines.md、ux-guidelines.mdの合意を基準にする。GitHubの既存Issue・PR・実装との差分から、検証可能な縦の作業単位へ分割する。
Issueには目的、対象/対象外、AC、検証方法、依存Issue番号、主な変更ディレクトリ、完了条件を記載する。未実装を見つけただけで大きなリファクタリングや機能追加を提案しない。
同じ要件がopen/closed Issueや既存PRで扱われていないか確認し、必要なら新規作成より既存Issueを更新する。
最初はNuxt基盤。その後DB/API基盤と基準演習画面を独立に進め、教材登録→生成→公開→演習/再開→不備報告を依存順に分割する。依存するIssueは先行がmainへ入るまで投入しない。
