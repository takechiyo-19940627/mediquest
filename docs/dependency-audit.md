# 初回リリース前の依存監査

2026-10-31、Issue #82。Node 24.15.0 / npm 11.12.1、`app/package-lock.json` に対する `npm audit --json` の記録。auditの終了コード1は下記残件によるもので、監査成功・脆弱性ゼロとは扱わない。全7品質ゲートの成功とも別の判断である。

## 適用した更新

- Nuxt 4.6.2 → 4.6.3。ページ認証のパス正規化および開発サーバーの情報公開に関する修正を適用。MediquestのAPIには独立した管理・本人境界があるが、上流修正も取り込む。[Nuxt advisory](https://github.com/nuxt/nuxt/security/advisories/GHSA-9v7c-q64q-vv33)
- node-forge 1.4.0 → 1.4.2。listhenの互換範囲内で更新。1.4.1のセキュリティ修正と1.4.2のBuffer入力回帰修正を採用。[公式変更履歴](https://github.com/digitalbazaar/forge/blob/v1.4.2/CHANGELOG.md)
- `npm audit fix --force`、Drizzle Kitの旧版への降格、依存元の要求範囲外のoverrideは使用していない。

更新後の監査件数: **critical 0 / high 0 / moderate 42 / low 2、計44**。これは依存元への伝播を含むパッケージ件数であり、独立した44個の脆弱性を意味しない。Nuxtも残るビルド依存の伝播先として表示される。

## 残る経路と採用判断

| 依存 | 利用経路・判断 | 上流情報 |
|---|---|---|
| minimatch | ESLint等のファイル探索。修正版11系は依存元の10系要求外。強制的なmajor変更を避け、依存元の更新で解消する。 | [advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) |
| glob | nft/archiver-utils等のビルド時探索・アーカイブ処理。修正版14系は13/10系要求外。 | [advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) |
| esbuild | drizzle-kitのTypeScriptローダー、fontless等。問題となるesbuild開発HTTPサーバーをアプリの起動・移行で使用していない。自動提案されるKit降格は採用しない。 | [advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99) |
| deepmerge | Rollupのnode-resolve等のビルド設定合成。監査時の最新版4.3.1にも修正版なし。 | [advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) |

利用者入力がこれらの問題経路に到達しないことと、依存自体の修正済みとは区別する。リポジトリやビルド設定を信頼できない入力に置き換えたり、開発サーバーを外部公開したりしない。初回は本人PCのloopback限定で運用する。残件は依存元の互換更新が提供された際に再監査する。定期実行は追加しない。

## 再確認

```sh
cd app
npm audit --json
npm ls nuxt node-forge glob minimatch esbuild deepmerge
npm run build
```

最終品質検証と本番生成物の点検結果は [受け入れテスト項目書](acceptance-test-checklist.md) の証拠欄にまとめる。開発依存の監査結果を本番の安全性保証へ読み替えない。

最終検証: アプリSHA `68aa11af244919f44a8cf2f2a6a23ef1595936a1` の全7ゲート成功（2026-10-31）。本番 `.output/server/package.json` と生成物のパスを点検し、node-forge/listhenが含まれないことを確認。テスト専用provider marker・固定テストキーも `.output` に含まれない。これは上記の開発依存の監査残件を解消したという意味ではない。最新headのCI・独立レビューは [PR #86](https://github.com/takechiyo-19940627/mediquest/pull/86) に記録する。
