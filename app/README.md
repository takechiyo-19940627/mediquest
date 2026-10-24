# Mediquest アプリ基盤

Nuxt / Vue / TypeScript と Nuxt UI を使った日本語の学習ホームです。教材がない空状態、ティール基調のライト・ダーク・OS連動テーマ、公開稼働確認APIを含みます。SQLiteのDB基盤を含みます。認証・AI・教材操作は未実装です。演習画面のデザイン基準は今後合意します。

## 開発

Node **24.15.0** / npm **11.12.1** を使用します。nodenv利用時はこのディレクトリで `nodenv exec npm` を使ってください。依存はpackage-lock.jsonで固定しています。

```sh
npm ci
npm exec -- playwright install chromium
npm run dev
```

開発サーバーは127.0.0.1に限定します。インストール時にはNuxtの型生成が実行されます。

## 検証

```sh
npm run format
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:e2e
npm run build
```

リポジトリルートから全検証を実行する場合:

```sh
NODENV_VERSION=24.15.0 nodenv exec node scripts/check-app.mjs
```

CIも同じゲートを実行します。単体テストはhealth応答に環境情報を含めない契約、結合テストは実HTTP APIと日本語SSR、ブラウザテストは本番ビルドのホーム・テーマ保存・OS追従・キーボード操作・スマホ/PCの横溢れを検証します。ブラウザテストは専用サーバーを起動し、既存サーバーを再利用しません。各テーマの画面をtest-resultsに保存します。フォントはsystem-uiとし、Nuxt UIのフォント取得を無効化しています。

## 本番ビルドのローカル確認

```sh
npm run build
NITRO_HOST=127.0.0.1 NITRO_PORT=3100 npm run start
```

`/api/health` はプロセスの稼働確認です。DB接続等のreadinessは保証しません。リモート公開の運用・認証は今後の実装です。

## 依存監査の残課題

2026-10-24のnpm auditは11件（high 7、moderate 4）を報告しています。high 7件はlisthen経由のnode-forgeの署名検証問題から伝播したもので、独立した7つの問題ではありません。node-forge最新版1.4.0にも修正がなく、現在のHTTP起動経路で署名検証を使用する証拠は見つかっていません。生成した本番サーバーの依存一覧にもnode-forge/listhenは含まれていませんが、上流修正の追跡が必要です。[署名検証のadvisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv)

旧esbuildにはWindows開発サーバーに関するlowの問題も報告されています。今回のmacOS上の検証には該当しません。fontlessの要求範囲を越える強制更新は行っていません。[esbuildのadvisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr)

GitHubの必須チェック登録と、TAKTからのIssue→PRの通し運転は別途確認が必要です。

## SQLiteとマイグレーション

DB基盤はDrizzle ORM/Kitとbetter-sqlite3を使用します。現在はusers/sourcesのみで、画面やAPIへの教材操作は未接続です。接続はserver/db内で明示作成し、使用後にcloseします。接続ごとに外部キー制約を有効にします。

`MEDIQUEST_DB_PATH` にリポジトリ外の絶対パスを指定し、親ディレクトリを先に用意してください。`.env.example` は記入例です。以下のCLIは.envを自動読込みしません。

```sh
npm run db:generate
MEDIQUEST_DB_PATH=/absolute/data/mediquest.sqlite npm run db:migrate
MEDIQUEST_DB_PATH=/absolute/data/mediquest.sqlite npm run db:seed
```

生成したdrizzle内のSQL・snapshot・journalはレビューしてGitに記録します。migrateは再適用可能です。seedはID 1のローカル管理者を作成し、既存管理者の名前を保持します。既存learnerを管理者へ昇格しません。起動やimport時に移行・seedを自動実行しません。

`npm run test:integration` は一時ディレクトリ内の新規DBのみを使用し、移行再適用、再接続での保持、seedの冪等性、FK・NOT NULL・role制約を確認します。実データを使いません。実データ投入前には停止中のDBコピーまたはSQLite対応のオンラインバックアップと復元を別途検証してください。

Drizzle Kit追加後のmoderate 4件は開発用ローダー経由の旧esbuildからの伝播です。対象はesbuild自身の開発サーバーで、移行生成・適用では起動していません。Kitの旧版への自動降格は行わず、上流修正を追跡します。

## 教材API（ローカル限定・Issue #15）

TAKT の承認連携 #10 が未解決のため、このAPIは監督下の個別実装です。UI・AI生成・認証サービス・教材更新/削除は対象外です。

環境変数 `MEDIQUEST_DB_PATH`（リポジトリ外の絶対パス）に加え、`MEDIQUEST_LOCAL_MODE=true` と `MEDIQUEST_LOCAL_ORIGIN=http://127.0.0.1:3000` を明示します。`npm run db:migrate` と `npm run db:seed` は事前に別途実行し、アプリは自動移行/seedしません。開発は `npm run dev`、本番形式のローカル確認は `NITRO_HOST=127.0.0.1 NITRO_PORT=3000 npm run start` とし、すべてloopbackにbindしてください。

このモードは認証ではありません。同一PCの利用者が操作できる固定管理者（DBのID 1）です。外部公開、ポート転送、ローカルのリバースプロキシ経由は禁止です。リモート対応時には別の認証/認可を実装します。直接接続socketのloopback、正規Host、送られた場合のOriginを検証し、Forwarded/X-Forwarded-*で利用者や接続元を判定しません。未設定・ユーザー不在・learnerは403です。管理API応答には `Cache-Control: no-store` を設定します。

- `POST /api/admin/sources`: `Content-Type: application/json`、UUID形式の `Idempotency-Key`、JSON `{ "title": "教材名", "body": "教材本文" }` を送ります。初回201、同一キー・正規化済み同一内容の再送200で同じIDを返します。異なる内容で同じキーを使うと409です。
- `GET /api/admin/sources?limit=20`: `items`（id/title/createdAt）と `nextCursor` を返します。次ページは `before=<nextCursor>`。最大100件、作成日時・ID降順。本文を含めません。
- `GET /api/admin/sources/:id`: 本文を含む教材JSON。IDは正整数の10進表記で安全整数以内です。不正400、不存在404です。

タイトルは前後trim後1〜200 Unicode code points、本文は空白のみ不可・100,000 code points以内です。本文の改行・前後空白・HTML文字列を保持します。HTMLとして実行せず、将来のUIでも `v-html` で表示しません。未知フィールド（createdBy/role等）は400です。要求全体は512 KiBまで実受信量で検査し、受信待ちは10秒以内です。受信待ちにDB接続を保持せず、保存直前にも管理者権限を確認します。

失敗は固定日本語メッセージと `error.code` を返します。主な状態は400入力不正、403拒否、404不存在、409再送競合、413過大、415JSON以外、500予期しない障害です。本文・DBパス・SQL・生例外を応答/ログへ出しません。再送記録は `source_creation_requests` に保存し、教材と同じIMMEDIATE transactionで作成します。既存sourcesに必須列を追加せず、追加移行で既存データを保持します。

結合テストは一時DB・本物のHTTPサーバーで正常、権限、再送/並行競合、入力上限、旧移行からの更新、固定エラーを確認します。複数HTTP fixtureによるNuxt生成ディレクトリ競合を避けるため結合テストはファイル間を直列実行します。実教材・実AIは使いません。

## 生成受付と下書き保存サービス（Issue #18）

`server/services/generation/service.ts` の `generateQuestions(input, config, provider)` は管理者の生成要求を受け付け、検証済み候補を未公開・未レビューの下書きに保存します。TAKT #10 の承認連携が未解決のため監督下の個別実装です。**HTTP生成API、実Anthropic接続、課金、画面、採用・公開、プロセス再起動時の復旧は未接続**です。テストの固定providerは `tests/` 内に限り、実アプリの生成機能として公開しません。

入力は `sourceId`（正の安全整数）、`requestedCount`（1〜10）、`title`（trim後1〜200 Unicode code points）、`requestKey`（UUID形式）だけです。利用者IDは受け取らず、既存固定管理者のDB上の役割を確認します。model/promptVersionはサーバー側の引数（空白のみ不可・各200 code points以内）から受け付け、runへ固定します。具体的な本番モデルは未決定です。要求比較はsource ID・要求数・セット名を使い、後日のモデル設定変更では再送を競合扱いしません。

受付transactionでdraft setとrunning runを作成し、接続を閉じてからproviderを呼びます。providerは教材本文・要求数・記録済みmodel/promptVersionを受け、success（unknownな出力）、failed（失敗確定）、unknown（結果不明）を返します。型にない応答や未知の例外も結果不明です。再送はrunning/succeeded/failed/unknownすべて元のrunを返し、providerを再呼出ししません。異入力の同一キーはdomain conflictです。別の試行には利用者が明示的に新しいキーを用意します。課金のexactly-onceを保証するものではありません。

候補数は要求数と一致させ、選択肢2〜6件、IDは1〜40文字の英数字/ハイフン/アンダースコアで版内一意、選択肢文は各2,000 code points以内、正解IDは空でなく選択肢内で重複不可です。問題文・解説・引用は各10,000 code points以内かつ空白のみ不可。正規化した全候補JSONはUTF-8で256 KiB以内です。未知フィールドは拒否します。上限は初期リソース制限であり、費用保証ではありません。

非空引用が教材本文に完全一致する場合だけquote_verifiedをtrueとし、不一致もdraftで残します。これは引用文字列の照合であり、医学的な正答性の検証ではありません。生成時のversion_noは1、reviewed/published情報はnull、set_items（採用・順序）はまだ作りません。

`completeGeneration` はrunningの場合だけ候補とsucceededを同一transactionで保存し、既に終わったrunへの重複完了は既存結果を返します。構造不正はfailed/invalid_output、確定失敗はfailed/provider_failed、不明はunknown/provider_unknown、保存障害で候補をrollbackした場合はfailed/storage_failedを記録します。状態更新も失敗した場合は固定のgeneration_storageエラーとなり、runningが残る可能性があります。本文・正解・生provider例外をログやerror codeへ含めません。

教材や過去の候補は削除せず、失敗した空draftと受付履歴も保持します。プロセス停止で残ったrunningを自動再実行・失敗化する処理はありません。後続の復旧・状態照会API設計で扱います。追加移行は `npm run db:generate` で生成し、既存users/sources/再送記録を持つDBからの更新・再適用をテストします。
