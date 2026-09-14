# 問題演習アプリ 要求定義・技術スタック (v0.2)

作成日: 2026-08-15 / 改訂: 2026-09-14(アーキテクチャ検討の決定を反映)
ステータス: 設計決定済み・実装着手前

改訂の経緯: 2026-09-05〜09-14 に設計の分岐 20 項目を検討した。記録は設計ツリー
(https://claude.ai/code/artifact/b895fc0c-6e4c-4623-82fb-b84311dea84b)。
v0.1 からの主な変更は、Web 優先の fullstack 構成、usecase 層の追加、選択肢数の可変化と「2 つ選べ」の要件化、
keyring の廃止、`user_id` の導入、未決事項 4 件の解消。

---

## 1. 目的

書籍・Web ソースから AI で選択式問題を生成し、演習・記録するアプリを Rust で自作する。
医療情報技師試験の学習に使いつつ、Rust とマルチプラットフォーム開発の学習題材とする。

利用者は当面本人のみ。将来「友人に配る」程度の他者利用を想定する(サービスとしての公開は想定しない)。

プロトタイプとして Claude アーティファクト版(React + Claude API + 永続ストレージ)を作成済み。
本プロジェクトはその移植・発展版であり、アーティファクト版を動く仕様書として参照する。

## 2. 機能要件

### 2.1 ソース登録
- 教科書ページの写真(複数枚)とテキスト貼り付けの両方に対応し、併用できる
- 写真は AI で文字起こしし、貼り付けテキストと結合する。文字起こしは画像 1 枚ごとに 1 回のサーバー呼び出し
- 写真はクライアント側で縮小(長辺 1600px 程度、JPEG)してからサーバーへ送る
- **抽出結果は保存前に確認・編集できる**(このテキストが以後すべての解説の根拠になるため)
- 画像そのものは保存しない。抽出テキストのみ保存する(決定)

### 2.2 問題生成
- ソース登録時に一括生成してストックする(生成数は選択可: 4 / 8 / 12 問など)
- 選択式。選択肢は **2〜6 個の可変**。形式は **「1 つ選べ」と「2 つ選べ」の 2 種類**。各問は以下を持つ:
  - 問題文 / 選択肢 / 正解(1 つ、または 2 つ) / 解説
  - **ソース本文からの逐語引用(quote)** — 解説の根拠
  - 引用照合の結果(`quote_verified`)
- 生成はソーステキストのみを根拠とし、ソースから正誤を確認できない問題は作らない
- 生成は同期で待つ(サーバーが完了まで返さない)。速度が問題になったら数問ずつの分割呼び出しに切り替える

### 2.3 演習
- 「1 つ選べ」はタップで即判定。「2 つ選べ」は 2 つ選んで確定ボタンで判定
- 正誤・正答・根拠引用・解説を表示
- 進捗バーとスコア表示
- 出題順はシャッフル。不備フラグ付きの問題は出題から除外

### 2.4 AI 誤り対策(3 段構え)
1. **引用照合**: quote がソース本文と完全一致するか機械照合し、結果を保存。不一致なら警告表示
2. **再検証**: ソース本文を渡して正解の妥当性を AI に再判定させる(妥当 / 誤りの可能性 / 判定不能)
3. **問題誤りフラグ**: ユーザーの最終判断で不備フラグを付与。以後の出題と正答率集計から除外

### 2.5 記録
- 各解答を「正解 / 不正解 / 問題誤り」の 3 値で永続記録
- 全体・ソース別の正答率を表示(問題誤りは分母から除外)
- 直近の解答履歴を一覧表示

## 3. 非機能要件

- **マルチプラットフォーム**: **Web(ブラウザ)を最初に**、次に Android/iOS。1 コードベース(Dioxus)。デスクトップは対象外
- **構成**: Dioxus fullstack。SQLite と Anthropic API キーはサーバーが持ち、クライアント(WASM / モバイル)は UI のみを持つ
- **UI**: スマホ前提(max-width 640px 相当、タップ操作)。既存 SBO 学習ページのダークテーマ設計言語を踏襲
- **日本語 UI**、専門用語はそのまま表示
- **API キー管理**: サーバーの環境変数 `ANTHROPIC_API_KEY` のみ。クライアントには一切渡さない
- **データ**: サーバーの SQLite に保存。端末間同期はサーバー集中のため不要
- **利用者**: 全データに `user_id` を持たせる。M2 までは固定値 1。認証は「友人に配る」段階で外部 ID 連携(Google などの OAuth / OIDC)を axum ミドルウェア 1 箇所に足す。自前パスワード管理はしない
- **サーバーの置き場所**: M2 は開発機の `dx serve`(localhost)。M3 で決める(第一候補は自宅 Mac + Tailscale、配る場合は VPS / PaaS)。ポートと DB パスは環境変数で受け取る

## 4. 技術スタック

| 領域 | 採用 | 備考 |
|---|---|---|
| 言語 | Rust | stable |
| UI フレームワーク | **Dioxus 0.7.x fullstack** | 安定版。0.8 は alpha のため見送り。クライアントは `web`、サーバーは `server` feature |
| ツールチェーン | dioxus-cli (`dx`) | `dx serve` / `dx serve --platform android` |
| サーバー | axum + tokio(Dioxus fullstack 同梱) | サーバー関数(`#[post]` / `#[get]`)で RPC |
| HTTP クライアント | reqwest | サーバー側から Anthropic API を呼ぶ |
| シリアライズ | serde / serde_json | API・DB・モデル共通 |
| DB | SQLite (rusqlite、同期 API) | サーバー側のみ。`spawn_blocking` で tokio と橋渡し。将来 sqlx へ移行余地あり |
| マイグレーション | rusqlite_migration | トランザクション付き適用、`validate()` をテストに置く |
| AI | Anthropic Messages API | 抽出・生成・再検証の 3 用途 |
| エラー | thiserror(ライブラリ)/ anyhow(cli の main のみ) | 層ごとの enum を `#[from]` で包む |

keyring は不採用(v0.1 から削除)。キーはサーバーだけが持つため不要。

### 選定理由(比較の要点)
- **Dioxus**: 1 コードベースで Web+モバイルをネイティブ対応。0.7 系が安定。React 風 RSX で アーティファクト版からの移植が素直。fullstack のサーバー関数でクライアント / サーバーの境界を関数呼び出しに見せられる
- **Tauri 2**: UI が Web 技術で既存 HTML 資産を流用できるが、「全部 Rust で書く」学習目的から外れるため次点
- **Topcoat**: サーバー+ブラウザ型で構成としては魅力があるが、2026 年 7 月公開の実験段階(0.5)で破壊的変更リスクが高く見送り
- **Leptos**: Web 特化のため、モバイルネイティブ要件に合わず見送り

### バージョン注意
Dioxus は 0.4→0.5→0.6→0.7 で RSX 記法・フック API に破壊的変更があった。
ドキュメント・チュートリアル・AI 生成コードは必ず **0.7 前提か確認**する。
- 公式: https://dioxuslabs.com (Learn はバージョン 0.7 を選択)
- API: https://docs.rs/dioxus
- examples: https://github.com/DioxusLabs/dioxus (ブランチとバージョンの対応に注意)

## 5. アーキテクチャ(ワークスペース構成)

```
mediquest/
└── crates/
    ├── core/            mediquest-core     ドメイン型(Source/Question/Record/Answer/Outcome)、
    │                                       引用照合、正答率集計。serde 以外に依存しない
    ├── usecase/         mediquest-usecase  手順の合成(登録→生成→照合→保存 など)。
    │                                       struct App { db, ai } を第 1 引数で受ける。core + infra に依存
    ├── infra/
    │   ├── ai/          mediquest-ai       Anthropic API クライアント(具象)。プロンプト組み立てと
    │   │                                   レスポンスの寛容パースは HTTP に触らない純粋関数。core に依存
    │   └── storage/     mediquest-storage  SQLite。同期 API のまま書き、tokio を知らない。core に依存
    └── ui/
        ├── cli/         mediquest-cli      M1。source add / stats のバッチのみ。usecase を直接呼ぶ
        └── app/         mediquest-app      M2。Dioxus fullstack。サーバー関数は usecase を呼ぶだけ。
                                            usecase への依存は server feature の時だけ有効
```

- `infra/` は core から外へ向かう層(AI、DB)、`ui/` は利用者から内へ向かう層(CLI、画面)。infra 同士は互いに依存しない
- 依存の向き: ui → usecase → infra → core。ディレクトリは説明であって Cargo は強制しないので、向きはレビューで守る
- サーバー関数の引数と戻り値は core の型(serde 対応)で表す。将来 Dioxus 以外のクライアントが必要になったら独立 API に移す
- サーバー側の共有状態(DB 接続、AI クライアント)は `static APP: LazyLock<App>` で保持し、起動時に環境変数から初期化する
- DB 接続は `Arc<Mutex<Connection>>`(`std::sync::Mutex`)。usecase が `tokio::task::spawn_blocking` で包んで storage を呼ぶ
- UI 層を将来乗り換えても core / usecase / infra が資産として残る構成とする

## 6. データモデル

- **users**: id(M2 までは 1 のみ)
- **sources**: id, user_id, name, text(確定した根拠テキスト), created_at
- **questions**: id, user_id, source_id, body, choices(JSON 配列、2〜6 要素), answer(JSON: `{"Single": i}` または `{"Two": [i, j]}`), explanation, quote, quote_verified(bool), flawed(bool)
- **records**: id, user_id, source_id, question_id, ts, outcome(`correct` / `wrong` / `flawed`)

型の方針:
- ID は SQLite の整数(`i64`)、時刻は Unix 秒(`i64`)。UUID や日時クレートは core に入れない。表示整形はクライアント側で行う
- core の `Question` は検証付きコンストラクタでのみ生成できる(選択肢数、正解 index の範囲、Two の 2 つが相異なる、を一箇所で保証)
- 解答結果は `enum Outcome { Correct, Wrong, Flawed }`。`correct: bool` + `flawed: bool` の 2 フラグは使わない

## 7. AI 連携仕様

| 用途 | 入力 | 出力 | 備考 |
|---|---|---|---|
| 抽出 | 画像(base64) | 文字起こしテキスト | 画像 1 枚ごとに 1 サーバー関数呼び出し。クライアントで縮小済み |
| 生成 | ソーステキスト+既出テーマ | 問題の JSON 配列 | 数問ずつ分割呼び出し。重複回避指示を含む。「1 つ選べ」「2 つ選べ」の両形式を生成させ、選択肢数と正解数の整合をパース時に検証 |
| 再検証 | ソーステキスト+問題+現正解 | verdict(correct/wrong/unverifiable)+理由 | JSON 出力 |

共通: JSON 出力はコードフェンス除去+寛容パースで受ける。出力トークン上限を踏まえ 1 回の生成問数を絞る。
パース関数は文字列を受けて `Vec<Question>` を返す純粋関数とし、フィクスチャでテストする。
実 API を呼ぶテストは `#[ignore]` を付け、`ANTHROPIC_API_KEY` がある環境で `cargo test -- --ignored` により手動実行する。

## 8. 未決事項

v0.1 の 4 件(モバイルでの API キー、画像の保存、端末間同期、複数選択形式)は全て解消した。残りは以下。

- サーバーの置き場所(M3 で決める。自宅 Mac + Tailscale か VPS / PaaS か)
- 認証の実装(友人に配る段階。外部 ID 連携の具体サービス)
- クライアント側の状態管理(サーバー関数の結果を Dioxus のシグナルにどう載せるか。M2 着手時)
- 生成の分割呼び出しへの切り替え(同期で速度が問題になった場合)
