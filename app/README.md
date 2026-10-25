# Mediquest アプリ基盤

Nuxt / Vue / TypeScript と Nuxt UI を使った日本語の学習ホームです。教材がない空状態、ティール基調のライト・ダーク・OS連動テーマ、公開稼働確認APIを含みます。SQLiteのDB基盤を含みます。ローカル管理者向け教材・生成・確認・採用・明示公開APIを含みます。本人限定の演習開始・回答確定・採点・未回答スキップ・履歴一覧・誤答復習開始APIも含みます。管理UI・演習UI・履歴UI・外部認証・実AI検証は未対応です。演習画面のデザイン基準は今後合意します。

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

`MEDIQUEST_DB_PATH` にリポジトリ外の絶対パスを指定し、親ディレクトリを先に用意してください。`environment.example` は記入例です。以下のCLIは.envを自動読込みしません。

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

`server/services/generation/service.ts` の `generateQuestions(input, config, provider)` は管理者の生成要求を受け付け、検証済み候補を未公開・未レビューの下書きに保存します。TAKT #10 の承認連携が未解決のため監督下の個別実装です。HTTP APIとAnthropic adapterの接続は次節Issue #20を参照してください。実課金検証、画面、プロセス再起動時の復旧は未対応です。採用・公開APIはIssue #24の節を参照してください。テストの固定providerは `tests/` 内に限り、実アプリの生成機能として公開しません。

入力は `sourceId`（正の安全整数）、`requestedCount`（1〜10）、`title`（trim後1〜200 Unicode code points）、`requestKey`（UUID形式）だけです。利用者IDは受け取らず、既存固定管理者のDB上の役割を確認します。model/promptVersionはサーバー側の引数（空白のみ不可・各200 code points以内）から受け付け、runへ固定します。具体的な本番モデルは未決定です。要求比較はsource ID・要求数・セット名を使い、後日のモデル設定変更では再送を競合扱いしません。

受付transactionでdraft setとrunning runを作成し、接続を閉じてからproviderを呼びます。providerは教材本文・要求数・記録済みmodel/promptVersionを受け、success（unknownな出力）、failed（失敗確定）、unknown（結果不明）を返します。型にない応答や未知の例外も結果不明です。再送はrunning/succeeded/failed/unknownすべて元のrunを返し、providerを再呼出ししません。異入力の同一キーはdomain conflictです。別の試行には利用者が明示的に新しいキーを用意します。課金のexactly-onceを保証するものではありません。

候補数は要求数と一致させ、選択肢2〜6件、IDは1〜40文字の英数字/ハイフン/アンダースコアで版内一意、選択肢文は各2,000 code points以内、正解IDは空でなく選択肢内で重複不可です。問題文・解説・引用は各10,000 code points以内かつ空白のみ不可。正規化した全候補JSONはUTF-8で256 KiB以内です。未知フィールドは拒否します。上限は初期リソース制限であり、費用保証ではありません。

非空引用が教材本文に完全一致する場合だけquote_verifiedをtrueとし、不一致もdraftで残します。これは引用文字列の照合であり、医学的な正答性の検証ではありません。生成時のversion_noは1、reviewed/published情報はnull、set_items（採用・順序）はまだ作りません。

`completeGeneration` はrunningの場合だけ候補とsucceededを同一transactionで保存し、既に終わったrunへの重複完了は既存結果を返します。構造不正はfailed/invalid_output、確定失敗はfailed/provider_failed、不明はunknown/provider_unknown、保存障害で候補をrollbackした場合はfailed/storage_failedを記録します。状態更新も失敗した場合は固定のgeneration_storageエラーとなり、runningが残る可能性があります。本文・正解・生provider例外をログやerror codeへ含めません。

教材や過去の候補は削除せず、失敗した空draftと受付履歴も保持します。プロセス停止で残ったrunningを自動再実行・失敗化する処理はありません。状態照会は次節のAPIで提供し、永続復旧は後続設計で扱います。追加移行は `npm run db:generate` で生成し、既存users/sources/再送記録を持つDBからの更新・再適用をテストします。

## 生成開始・状態照会API（Issue #20）

TAKT停止中の監督下実装です。`POST /api/admin/sources/:id/generations` にJSON `{ "title": "セット名", "requestedCount": 1 }` とUUIDの `Idempotency-Key` を送ります。利用者・モデル・APIキーはbodyでは指定できません。既存のローカル管理者/socket/Host/Origin/no-store境界を適用します。新規要求はproviderの終了をawaitし201、既存終端受付の再送は200、同一キーの元要求がrunningなら202です。HTTP 201は生成成功の意味ではなく、必ず `status` と `errorCode` を確認してください。失われた応答は同じ入力・キーのPOST再送で取得します。

`GET /api/admin/generations/:id` はrun/set/source ID・状態・要求数・記録済みmodel/promptVersion・時刻・固定errorCodeだけを返します。`updatedAt` は現在の状態を書いた時刻（開始時または終了時）です。APIキー・教材本文・生レスポンスは返しません。runningは実プロセスの生存を保証せず、再起動しても自動再開・失敗化しません。永続worker/復旧/照合/UIは未実装です。

新規生成にはサーバー側で `MEDIQUEST_GENERATION_ENABLED=true`、`ANTHROPIC_API_KEY`、`MEDIQUEST_ANTHROPIC_MODEL` を明示します。未設定は503でrun/setを作りません。モデルの具体名・実課金試験はこのIssueでは決めていません。全workspace用キーを使う場合は `MEDIQUEST_ANTHROPIC_WORKSPACE_ID` も設定します。既存受付の再送とGETはこれらの設定を撤去しても利用できます。Nuxt public runtimeConfigには設定しません。

送信先は `https://api.anthropic.com/v1/messages` 固定、リダイレクト追従なし、自動再試行0回、全応答の受信期限60秒、受信上限1 MiB（Content-Lengthに依存せず実測）、`max_tokens=8192` です。これらは費用保証ではありません。プロンプト版は `mediquest-questions-v1`。教材はsystem命令に混ぜず、userメッセージのJSONデータとして区切り、tool権限は与えません。出力はtext blockのJSONだけを扱い、end_turn以外、非text block、壊れたJSON、上限超過は有効候補と扱いません。既存の構造・引用検証後だけdraft保存します。

公式APIからの4xx拒否（408を除く）はfailed、5xx・通信エラー・timeout・切断はunknownとして扱います。200で不正な応答はinvalid_outputです。クライアント切断はHTTP responseのcloseとwritableFinishedで判定し、正常なrequest本文読了を切断扱いしません。AbortSignalをfetchへ渡しますが、外部処理や課金の取消しは保証しません。failed/unknownを同じキーで送っても外部呼出しを繰り返しません。

### Anthropic一次資料の確認（2026-10-24）

- [API overview / Authentication](https://platform.claude.com/docs/en/api/overview): `Authorization: Bearer` はAPIキーにも使用でき、WIF短期トークン専用ではありません。従来のx-api-keyも互換fallbackとして掲載されています。本実装はAPIキーをBearerで送ります。キーがworkspace限定でない場合のanthropic-workspace-idも記載されています。
- [API versions / Version history](https://platform.claude.com/docs/en/api/versioning): 2026-10-21が利用可能なAPI版として掲載され、anthropic-versionへの指定が説明されています。本実装はこの版に固定し、同版で削除されたtemperature/top_p/top_kを送りません。betaヘッダーは使いません。
- [Messages API](https://platform.claude.com/docs/en/build-with-claude/working-with-messages) と [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons): model/max_tokens/messagesとtext content、end_turnを確認しました。
- [API errors](https://platform.claude.com/docs/en/api/errors): 4xxの要求拒否と5xxの障害を確認しました。結果不明や課金有無を断定する情報には使いません。

実キー・実AIは検証に使っていません。unitはtransportを引数注入、HTTP結合テストはNuxtテスト設定のaliasでprovider factoryだけを置換し、通常buildは実adapterを参照します。環境変数によるfakeモードや任意API endpointは本番コードにありません。本番E2Eでtest-only transportがserver/public出力に混入しないことと、ブラウザ出力にキー設定やAPI接続先が混入しないことを検査します。

## 候補閲覧と明示確認API（Issue #22）

TAKT #10の承認連携が未解決のため監督下の個別実装です。既存のローカル管理境界とno-storeを適用します。教材・候補本文をログへ出しません。UI・編集は未実装で、採用順序・公開APIは次節を参照してください。人による演習デザイン合意も別途必要です。

- `GET /api/admin/sets?limit=20`: id/title/status/sourceId/createdAt/candidateCount/reviewedCountとnextCursor。最大100件、createdAt/id降順、次ページはbeforeにnextCursorを指定。一覧は本文・正答を含みません。
- `GET /api/admin/sets/:id`: セットと生成runに属するcandidates（版ID、問題ID、版番号、本文、選択肢、正答ID、解説、引用、引用照合結果、確認者/時刻、fingerprint）。候補のない受付は空配列です。published/archivedも管理者は閲覧できます。
- `PUT /api/admin/sets/:setId/versions/:versionId/review`: `{ "fingerprint": "取得したSHA-256", "confirmed": true }`。引用不一致は `acknowledgeQuoteMismatch: true` も必要です。引用の一致も明示確認も医学的正答性を自動保証しません。

確認は管理者が当該内容を確認した記録です。draftかつ成功した生成・activeな問題だけを対象に、形式・引用と内容fingerprintを再検査して同じIMMEDIATE transactionで確認者とサーバー時刻を保存します。同一内容の再送は初回確認者/時刻を保持します。fingerprintは版ID・本文・選択肢順序/ID/文・正答ID・解説・引用から計算します。古い内容や状態競合は409、所属不一致/不存在404、不正入力400、非管理者403、上限超過413、障害500です。未知フィールドとクライアント指定の確認者を拒否します。受信上限512 KiB/10秒は教材APIと共通です。

確認してもセットはdraftのままで、publishedBy/Atや採用集合は変わりません。今後内容編集を導入する際は確認記録を無効化し再確認を必須とします。公開履歴を持つセットのset_itemsから参照された版は確認記録も変更できません。本件は既存reviewed列のみ利用し追加移行はありません。

## 採用順序と明示公開API（Issue #24）

管理者が確認済み候補の採用順を保存し、その集合を明示公開できます。公開後の本人限定演習開始/問題取得はIssue #28を参照してください。演習UIは未実装です。回答確定APIはIssue #30を参照してください。公開メタデータの一覧/詳細はIssue #26の節を参照してください。管理者の明示的な公開停止はIssue #46の節を参照してください。管理UI、内容編集、改訂・複製は対象外です。TAKT #10停止中の監督下実装で、演習画面の人による合意とは独立しています。

- `GET /api/admin/sets/:id`: candidatesとは別に採用順のitems（versionId/position/questionId/内容fingerprint/確認情報など）、revision、publishFingerprintを返します。
- `PUT /api/admin/sets/:id/items`: `{ "expectedRevision": 0, "versionIds": [2, 1] }`。0〜10版を順番どおり全置換します。空集合もdraft保存可能です。確認済み・active・成功run由来の当該セット/教材の版のみ採用でき、版/論理問題の重複を拒否します。同じ現行集合なら再検証後に変更なしで200、異なる集合は期待revision一致時だけ保存してrevisionを1増やします。古い操作がABA後の集合を復活させる更新は行いません。
- `POST /api/admin/sets/:id/publish`: `{ "expectedRevision": 1, "publishFingerprint": "GETで得たSHA-256", "confirmed": true }`。空でない採用集合の形式・確認・状態・所属を再検査し、期待revisionとfingerprintが一致する場合だけ公開します。初回201、保存した公開要求と完全一致する再送200。公開者/時刻とrevisionを保持し、異なる要求は409です。

publishFingerprintはセットID/教材ID/revision、採用順、版内容fingerprint、確認者/時刻、問題/生成状態を含み、確認APIの内容fingerprintとは別です。生成・確認・採用保存は自動公開しません。引用不一致も管理者が明示確認済みなら採用可能であり、医学的正答性を自動保証しません。

IMMEDIATE transactionで集合の置換・revision更新または公開記録を原子的に保存します。障害時には旧集合を保持します。published/archivedや公開履歴を持つセットの集合は変更できず、その参照版の確認記録も変更できません。これはAPIでの保護で、直接DB改ざんの防止ではありません。将来編集は公開版の上書きではなく新しい版が必要です。

ローカル管理者/socket/Host/Origin/no-store、512 KiB/10秒の受信上限と固定エラーを再利用します。新移行はset_itemsと集合revision/公開要求照合列を追加し、旧教材・候補・確認記録を保持します。実AI・実データを使わず、新規/旧DB移行再適用、制約、rollback、採用/公開の同時要求を検証します。

## 学習者向け公開セット一覧・詳細（Issue #26）

`GET /api/sets?limit=20` は公開セットのid/title/description/publishedAt/availableQuestionCountだけをitemsに返します。最大100件、publishedAt/id降順です。次ページはnextCursor（`published:時刻:ID`）をbeforeへ渡します。管理一覧のcreatedAtカーソルは受け付けません。

`GET /api/sets/:id` は同じメタデータとcanStartを返します。採用集合にあるactive・確認済み・教材/生成所属が一致する版の論理問題数を数え、未採用候補は除外します。0件でも公開セットを残しcanStart=falseです。公開者/時刻が揃うpublishedのみ対象とし、draft/archived/不存在は同じ404です。問題/版ID、本文、選択肢、正答、解説、引用、教材本文、確認者、生成詳細は返しません。

明示ローカルmode/socket/Host/Origin/no-storeは管理APIと共通です。固定ユーザーID 1がadminまたはlearnerなら閲覧可能ですが、learnerの管理API利用は引き続き403です。ID/roleをクライアントから指定する仕組みや匿名公開・外部認証はありません。これは本人PC用で、友人向けの外部配信を安全に行う認証ではありません。

TAKT #10停止中の監督下実装です。UIは未実装で、canStartは現在の件数に基づく表示用情報です。本人の履歴一覧APIは Issue #36 を参照してください。開始APIはIssue #28を参照してください。版単位の不備確定・除外は Issue #34 を参照してください。

## 演習開始・固定出題・再取得（Issue #28）

固定ローカル利用者（admin/learner）が公開セットから演習を開始できます。TAKT #10停止中の監督下実装で、UI・復習は未実装です。回答確定・採点・結果集計はIssue #30、本人の履歴一覧はIssue #36、未回答スキップと再開順序はIssue #41を参照してください。本人PC用の既存socket/Host/Origin/no-store境界を使い、外部認証や利用者切替は追加しません。

- `POST /api/sessions`: UUIDのIdempotency-KeyとJSON `{ "setId": 1 }`。初回201、同一キー・同一セットは200で同じsession、異セットは409。別キーは別演習です。セット公開・現在の出題可能版/形式を開始transaction内で再確認し、0件なら409。未公開は404です。回答列はnullで作成します。
- `GET /api/sessions/:sessionId`: 本人の概要と順序付きitems（id/position/state/skippedAt）、取得可能な未回答のうち通常未回答を先に、なければスキップ済みをposition順で選んだcurrentItemIdを返します（Issue #41）。保存した版と公開集合のpositionを固定し、再取得や再起動で並び替えません。現在の最新版へ差し替えず、ランダム化もしません。
- `GET /api/sessions/:sessionId/items/:itemId`: 未回答の場合は、本人sessionに属する問題のid/position/body/choices/requiredSelectionCountだけを返します。選択肢IDは全選択肢を元の順序で返し、どれが正答かを示す配列・判定・解説・引用・教材・生成情報は返しません。HTMLはJSONの文字列であり、将来のUIでもv-htmlに渡しません。
- `POST /api/sessions/:sessionId/resume`: 空JSON `{}`。未回答かつ現在stoppedの項目に除外理由stoppedと時刻を原子的に保存します。既存除外は上書きしません。同じ操作は冪等です。他人session/itemや別sessionのitemは不存在と同じ404です。

GETは書込みをせず、未回答の現在停止または保存済み除外をstate=excludedとして投影します。通常停止だけでは回答済み項目を除外しません。該当itemのGETはid/position/stateのみ返し、問題を露出しません。resumeで保存した除外は後でactiveへ戻っても当該演習で維持します。全問除外でも履歴を削除せず、currentItemId=nullを返します。Issue #30の回答/resume transactionで残り未回答が0ならcompletedへ更新します。対象0件の正答率は0%ではなくnullです。回答済み項目の除外保存は今回の対象外です。

セット公開停止後も本人の既存演習と同一開始キー再送を保持し、新しい開始だけ拒否します。追加Drizzle移行はstudy_sessions/study_itemsと一意性/FK/状態制約を導入し、既存公開集合・教材・確認情報を保持します。途中item保存失敗時はsessionごとrollbackします。

再取得はページ再読込/サーバー再起動と停止除外の保存までです。回答保存APIは次節を参照してください。再開UIは未実装です。不備版は開始・再取得・再開でも除外します（Issue #34）。

## 回答確定・採点・本人feedback（Issue #30）

`POST /api/sessions/:sessionId/items/:itemId/answer` に `{ "selectedIds": ["a"] }` を送ります。1〜6件の重複しないASCII選択肢ID（各40文字以内）だけを受け付け、未知フィールド・選択数の不足/超過・当該版にないIDは400です。固定版の正答と集合が完全一致した場合だけ正答で、部分点はありません。保存時にIDを並べ替えて正規化します。順不同の回答を禁止する制約はなく、最初の未回答以外も本人の取得可能itemなら確定できます。

初回と同一集合の再送は200、異なる回答の再送は409です。応答はitem/session/replayed。同じ集合は初回選択・正誤・answeredAtを維持し、completed後も再送できます。保存済み回答を通常停止や公開停止のために再採点しません。未回答の停止/保存済み除外には409を返し、拒否操作では除外を書込みません。停止除外を保存する場合は明示的にresumeを呼びます。

未回答GETは従来の問題DTOでfeedbackキーを持ちません。本人の確定済みitemだけfeedback（selectedIds/isCorrect/answeredAt/answerIds/explanation/quote）を追加します。再取得・サーバー再起動後も同じ保存結果を返します。他人や別sessionのitemは同じ404です。回答済みへの通常停止でもfeedbackを取得でき、明示的な保存済み除外は優先して問題を隠します。不備版は回答済みも除外して feedback を隠します（Issue #34）。

回答保存・未回答stoppedの除外同期・session完了更新は同一IMMEDIATE transactionです。途中障害は全てrollbackし、安全な500だけを返します。resumeでも除外同期後に完了を判定します。未回答0件ならcompletedとcompletedAtを一度だけ保存し、再送/resumeで時刻を変更しません。GETは状態を投影するだけで更新しません。サーバーが返すcurrentItemIdは保存済みposition順の次の未回答であり、自動遷移や自動回答を実行しません。

session.statisticsはtotalItemCount/excludedCount/eligibleCount/answeredEligibleCount/unansweredEligibleCount/correctEligibleCountを返します。accuracyは **correctEligibleCount / eligibleCount の0〜1比率** です。未回答は未正答として分母に含め、statusで未完了を区別します。対象0件はaccuracy=null・accuracyStatus=no_eligible_items、それ以外はaccuracyStatus=availableです。除外した行や過去回答は削除しません。丸めや点数表示は未実装のUIへ委ねます。

schema/依存追加はありません。既存のローカル利用者/socket/Host/Origin/no-store、有限JSON受信、固定エラー境界を維持します。TAKT #10停止中の監督下実装で、UI・復習・外部認証は対象外です。不備確定は Issue #34、履歴一覧は Issue #36、未回答スキップは Issue #41 を参照してください。

## 不備報告の受付と管理者確認（Issue 32）

TAKT #10 の停止中に監督下で実装した API です。UI・通知は未実装です。管理判断・不備版除外は Issue #34、報告者本人の未回答スキップ（報告とは連動しない独立した明示操作）は Issue #41 を参照してください。

- `POST /api/sessions/:sessionId/items/:itemId/reports` は本人の項目に `{ "message": "指摘内容" }` を受け付けます。trim 後 1〜2000 Unicode コードポイント、未知フィールドは拒否します。未回答・回答済み・完了・停止・保存済み除外の項目から報告できます。
- 同じ利用者・固定問題版の open 報告は一つです。初回は 201 / `replayed:false`、既存があれば 200 / `replayed:true` と既存本文を返します。別の演習や異なる本文で再送しても、最初の本文・参照項目・時刻を上書きしません。入力・所有者検証は再送判定より先です。
- 学習者応答は `id/message/status/createdAt/replayed` のみです。報告で問題・正答・解説を取得することはできません。
- `GET /api/admin/reports` は open のみを新しい順に返します。`limit` は既定 20、最大 100、`before` は応答の `nextCursor` を使用します。`GET /api/admin/reports/:reportId` は管理者だけが当該保存版の問題・正答・解説・引用・出典 ID を確認できます。
- 受付は IMMEDIATE transaction と部分一意インデックスで重複を防ぎます。報告以外の出題状態・回答・集計・除外・公開状態は変更しません。新規の追加移行で既存データを保持します。

本文上限、重複時の既存本文返却、受付対象状態、一覧 open 限定は Issue 32 の実装契約です。固定ローカル利用者と既存の接続元・Host・Origin 検証を使用し、全応答は no-store。外部公開用認証ではありません。

## 管理者の不備判断と版単位の除外（Issue 34）

`PUT /api/admin/reports/:reportId/resolution` は `{ "decision": "confirmed", "note": "理由" }` を受け付けます。decision は confirmed / dismissed、note は trim 後 1〜2000 Unicode コードポイントです。管理者だけが一度判断でき、同じ判断・理由の再送は元の判断者・時刻・理由を返し `replayed:true` とします。異なる内容は 409。別報告を自動解決しません。

confirmed は当該保存版だけに不備を記録し、最初の不備時刻・判断者・理由を保持します。別報告の confirmed でも上書きせず、dismissed でも解除しません。問題全版の停止や公開セット構成の書換えは行いません。管理者詳細には解決記録と版不備情報を追加します。

不備版は公開件数・新規開始・採用・新規公開から除外します。本人の古い回答済み履歴にも GET 時点で除外を投影し、理由 `invalidated` を返します。問題・feedback は隠しますが、保存済み選択・正誤・回答時刻は変更しません。通常停止より不備が優先し、対象ゼロの accuracy は null です。未回答不備への採点は拒否、同じ保存済み回答の再送は除外 DTO を返し、異回答は拒否します。

GET は保存しません。resume / 新規回答成功の進捗同期では不備除外を版の最初の不備時刻で保存し、全問除外でも resume で完了できます。過去の完了時刻は保持します。これらの再送・完了更新・feedback 非表示は Issue 34 の実装契約です。

0006 は Drizzle 生成 SQL の旧表コピーで新規 nullable 列を明示 NULL に補正しています。参照される表を再作成するため移行専用接続で FK を一時停止し、全未適用移行と履歴を IMMEDIATE transaction 内で適用、全 FK 整合を確認してから commit します。失敗時は DDL・データ・履歴を rollback し、成功・失敗とも FK を復元します。アプリ稼働を止めて既存の移行コマンドを実行してください。

TAKT #10 停止中の直接監督実装です。UI・通知・改訂・複製・全版停止・不備解除・復習・外部認証は対象外です。本人の未回答スキップは Issue #41 を参照してください。

## 本人限定の演習履歴・中断一覧（Issue #36）

`GET /api/sessions` は固定ローカル利用者（admin/learner）本人の演習sessionだけを一覧します。利用者IDをクエリやボディで指定する仕組みはなく、adminも自分の履歴だけを取得し、learnerの管理API利用は引き続き403です。中断は新しい状態ではなく、既存の `in_progress` のまま一覧に現れます。

- クエリは `limit`（既定20、最大100）、`status`（省略時は全件、`in_progress` / `completed` のみ）、`before`（応答の `nextCursor` をそのまま渡す）だけを受け付けます。未知フィールド・`userId` 等の利用者指定・同じクエリの重複・不正な値・他namespaceのcursorは400です。
- 並び順は `startedAt` 降順、同時刻は `id` 降順で固定です。cursorは `study:<startedAt>:<id>` の専用namespaceで、ページまたぎの同一時刻でも欠落・重複しません。応答は `{ items, nextCursor }` で、該当なしは `items=[]` / `nextCursor=null` です。
- 各itemは `id/setId/setTitle/status/mode/startedAt/completedAt/currentItemId/statistics` だけです。問題一覧・本文・選択肢・回答選択・正答・解説・引用・教材・生成情報・他人の情報は含みません。`setTitle` は現在のセット名で、タイトルのsnapshot列は追加していません。
- `statistics` と `currentItemId` は個別GET（`GET /api/sessions/:sessionId`）と同じ集計定義を同じ時点で投影します。公開停止後やセットarchived後も本人の過去sessionを表示し、未回答の通常停止・不備版・保存済み除外は個別GETと同じく除外として集計します。全問が対象外の `in_progress` は一覧GETでも `in_progress` のまま `currentItemId=null`、`accuracy=null` / `accuracyStatus=no_eligible_items` です。完了への更新は従来どおり回答・resumeのtransactionだけが行います。
- 一覧GETは書込みをしません。返したIDはそのまま既存の個別GET・resume・item取得に使えます。read transaction内で本人解決→対象ページのsession取得→そのページ分だけ進捗を投影し、全履歴をメモリへ読み込みません。`limit+1` で次ページ有無を判定します。

schema/移行/依存の追加はありません。`study_sessions` は単一利用者・小規模データで、`user_id` が既存一意制約の先頭列にあるため、専用indexは実データ量の根拠が出るまで追加しません。既存のローカルmode/socket/Host/Origin/no-store/固定エラー境界を共有し、保存系の障害は安全な500だけを返します。並び順・status filter・limit/cursor形状・現在タイトル表示は Issue #36 の実装契約であり、プロダクト合意（画面一覧の `/history`・ホームの中断演習・UXの保存済み進捗からの再開）とは区別します。履歴UI・結果専用画面・検索/期間指定・総件数・履歴削除・バックアップ/復元は対象外です。

## 本人の未回答スキップと再開順序API（Issue #41）

本人は進行中演習の取得可能な未回答itemを一時的にスキップし、学習を続けられます。`docs/screens-and-data-model.md` の `study_items.skipped_at` と「通常未回答→最後にスキップ分、未回答が残れば完了しない」、`docs/ux-guidelines.md` の「報告者本人が一時スキップして学習継続、誤答として新規記録しない」を実装します。UI・スキップ解除・任意並替え・報告連動の自動操作・誤答復習は対象外です。

- `POST /api/sessions/:sessionId/items/:itemId/skip` に空JSON `{}` を送ります。利用者・時刻・回答をクライアントが指定するフィールド（`userId` / `skippedAt` / `selectedIds` など）や配列・非オブジェクトは400で、入力検証は所有者判定より先です。他人のsession・別sessionのitem・不存在は同じ404です。
- 対象は本人のin_progress sessionに属する未回答かつ非除外（停止中でない・不備版でない・保存済み除外でない）itemだけです。回答済み（回答後の遅延再送を含む）・停止・不備・保存済み除外・完了済みsessionへの新規スキップは409で、除外も時刻も書き込みません。
- 初回は `skipped_at` が null の行だけを条件付きUPDATEで更新し、IMMEDIATE transaction内で一度だけ時刻を保存します。同じitemへの再送・並行送信は保存済みの時刻を返し `replayed:true` です。時刻の上書きや順序の回転はしません。初回・再送とも200です。
- 応答は `{ item: { id, position, skippedAt }, session, replayed }` だけです。問題文・選択肢・正答・解説・引用・feedbackは含みません。`session` は個別GETと同じ概要で、各itemに `skippedAt`（nullまたは時刻）、`statistics` に `skippedUnansweredCount`（除外されていないスキップ済み未回答の件数）を追加します。`unansweredEligibleCount` はスキップ分を含んだままで、accuracyの分母・対象0件のnull・不備優先は従来どおりです。
- 次問の選択は開始・個別GET・回答・resume・履歴一覧で共通です。取得可能な未回答のうち `skippedAt=null` をposition順で先に、なければスキップ済みをposition順で選びます。保存済みpositionとitems配列の順序は変えず、サーバー再起動・resume後も同じ順序です。スキップ済みが停止・不備・保存済み除外になった場合は次問候補と `skippedUnansweredCount` から外れます。
- スキップは未回答のまま残り、`selected_ids_json` / `is_correct` / `answered_at` / `excluded_*` を書きません。全問スキップでも `in_progress` のまま先頭のスキップへ戻り、最後の未回答一問をスキップしても同じitemがcurrentのまま完了しません。スキップ済みitemへの回答は通常どおり一度だけ確定し、回答後は選出対象外になります。`skipped_at` は過去の操作記録として回答後も保持します。
- skip自体は完了判定や除外の保存を行いません。完了への更新と停止/不備除外の保存は従来どおり回答・resumeのtransactionに委ねます。応答のsessionは現在の停止状態を投影するだけで、保存同期はしません。GET・履歴一覧は書き込みをしません。保存失敗は全てrollbackし、安全な500とno-storeだけを返します。
- 権限は既存の固定ローカル利用者（admin/learner）・socket/Host/Origin・no-store境界を共有し、learnerの管理APIは引き続き403です。

移行 `0007_study_item_skipped_at` は `ALTER TABLE study_items ADD skipped_at integer`（nullable）だけで、表の再作成はありません。既存行はnullとして読め、回答・除外・不備・報告・公開データ・FKを保持し、再適用は無変更です。アプリ停止中に既存の移行コマンドを実行してください。再スキップ時の非回転、回答後の `skipped_at` 保持、HTTP形状（200/200・`item/session/replayed`）、`skippedAt` の全item付与、`skippedUnansweredCount` は Issue #41 の実装契約であり、既存docsの規定（列・順序・未完了）とは区別します。

## 本人の誤答から固定版の復習演習を開始するAPI（Issue #44）

本人は完了した自分の演習の誤答だけを集めた新しい復習演習を開始できます。`docs/screens-and-data-model.md` の `mode` (normal/review)・`parent_session_id`、「誤答復習は出題可能な誤答版を使って新規演習を作る。新しい版へ自動置換しない。停止・不備の問題は復習からも除外する」、「公開停止は新規開始を止める」を実装します。UI、改訂版への置換、誤答以外のカスタム復習、間隔反復、親子統合成績、削除は対象外です。

- `POST /api/sessions/:sessionId/reviews` に UUID の `Idempotency-Key` と空JSON `{}` を送ります。`:sessionId` は本人の元演習（親）です。利用者・親・版・正誤をクライアントが指定するフィールド（`userId` / `parentSessionId` / `versionIds` / `isCorrect` / `setId` など）や配列・非オブジェクトは400で、入力・キー検証は所有者判定より先です。他人の演習・不存在は同じ404です。
- 対象は親の `study_items` のうち回答済みかつ誤答（`answered_at` 非null・`is_correct=false`）で保存済み除外がなく、問題が現在active・版が不備でなく・形式検証を通り・親のセットの公開集合に残っている固定版です。正答・未回答・スキップのみ・停止中・不備版・保存済み除外は選びません。選定は開始APIと同じ判定部品を再利用し、最新版への置換はしません。対象0件は409で空の演習を作りません。
- 新規作成は親が `completed` で、かつ親のセットが現在公開中（published・公開者/時刻あり）の場合だけです。親が進行中、またはセットが公開停止（archived）・未公開の場合は409です（親は本人所有で存在するため404ではなく状態競合として扱います）。公開停止後も保存済みの復習演習の再取得・再開・同一キー再送は保持します。
- 子の `study_items` は親の `question_version_id` と `position` 値をそのまま保持し（非連続可、親子で対応可能）、回答・採点・スキップ・除外列はすべてnullで作成します。`mode='review'`、`parent_session_id=親ID`、`set_id=親のset_id`。親の回答・正誤・時刻・スキップ・除外・状態は一切変更しません。
- 初回201 / `replayed:false`、同一キー・同一親の再送（並行送信を含む）は200 / `replayed:true` で保存済みの復習sessionを現在状態の投影で返し、対象を再選定しません。別キーは別の復習演習です。`(user_id, start_request_key)` の一意制約は全mode共通なので、同じキーを別の親・通常開始に使う、通常開始のキーで復習を開始する、復習のキーで通常開始する、はいずれも409で誤ったsessionを返しません。
- 応答は `{ session, replayed }` で、`session` は個別GETと同じ概要に `parentSessionId` を追加したものです（通常演習はnull）。個別GET・履歴一覧の各itemにも `parentSessionId` を追加します。開始応答・子の未回答item GETに親の正誤・正答・解説・引用は含めません。
- 復習sessionの回答・スキップ・再開・不備報告・履歴は通常演習と同じ所有者・不備規則で動作し、親の採点を変更しません。復習演習を完了すれば、その誤答から更に復習を開始でき、直接の親IDだけを保存します（多世代の集約はしません）。
- session/items の保存は同じIMMEDIATE transactionで、途中失敗は全てrollbackし安全な500とno-storeだけを返します。GET・履歴は書き込みをしません。権限は既存の固定ローカル利用者（admin/learner）・socket/Host/Origin・no-store境界を共有し、learnerの管理APIは引き続き403です。

移行 `0008_study_session_review` は `study_sessions` を再作成し、`mode` のCHECKを `normal/review` に拡張、nullableの `parent_session_id`（self FK、ON DELETE restrict）と `(normal かつ parent null) または (review かつ parent 非null かつ parent≠自身)` のCHECKを追加します。0006と同じく旧行の新列には明示的に NULL をコピーし、既存の演習・回答・スキップ・除外・不備・報告・公開データ・FKを保持し、再適用は無変更です。アプリ停止中に既存の移行コマンドを実行してください。復習の経路/本文、完了親限定、公開停止セットからの新規復習拒否（409）、親position値の保持、再復習許可、`parentSessionId` DTO、公開集合外の版を409とする扱いは Issue #44 の実装契約であり、既存docsの規定（mode/parent列・誤答版での新規作成・非置換・停止/不備除外・公開停止による新規開始停止）とは区別します。

## 管理者の明示的なセット公開停止API（Issue #46）

管理者が公開済みセットを明示的に `archived` へ遷移させ、新規の演習開始だけを止めます。`docs/screens-and-data-model.md` の `status` (draft/published/archived)、管理セット画面の「公開済みは閲覧・公開停止・改訂用複製」、「公開停止は新規開始を止めるが進行中演習・履歴は保持」を実装します。UI（確認ダイアログを含む）、改訂用複製、再公開・停止解除、全版の問題停止、不備確定の変更、内容編集、監査履歴（archivedAt/by列）、削除、認証拡張は対象外です。自動停止は導入せず、管理者の明示操作だけが停止します。

- `POST /api/admin/sets/:setId/archive` に空JSON `{}` を送ります。`user`/`status`/`revision`/`expectedRevision` などクライアントが状態や本人を指定するフィールド、配列・非オブジェクトは400で、入力検証はセット検索より先です。不存在は404、draft・公開者/時刻の欠けた公開記録不整合（published/archivedとも）は409です。独立したidempotency keyやexpectedRevisionは受け取りません。
- `published` かつ公開者/時刻がある場合だけ `archived` へ更新し、既存の安全な nextRevision で `revision` を1増やします。既に `archived` で公開記録があるセットへの再送（並行送信を含む）は同じ保存状態を返し、revisionは増えません。初回/再送とも200で、応答は `id/status/revision/publishedBy/publishedAt/replayed` の明示DTOです。
- 更新するのは `question_sets.status/revision` の1行だけです。公開日時・公開者・`publish_request_revision`/`publish_request_fingerprint`、採用集合（`set_items`）、版内容、教材、問題の `status`、不備・報告、演習・回答・採点・成績は変更しません。停止だけで問題を `stopped`/不備版にしません。
- 停止後の既存APIの効果（既存の判定で動作し、本Issueではコード変更なし）: `GET /api/sets` から消え、`GET /api/sets/:id` は404。新しい通常開始は既存の404、新しい復習開始は既存の409で拒否します。同一開始キーの通常/復習再送は保存済みsessionを返し、既存sessionのGET・履歴・resume・skip・answer・不備報告と既存復習の利用は継続します。管理一覧/詳細は `archived` と固定内容を引き続き取得できます。
- 停止後の古い公開要求の再送は409で再公開しません（`publishSet` はpublished再送のみ許可）。採用集合の変更も409です。
- IMMEDIATE transactionで権限と対象セットを読み、競合するarchiveと開始要求は直列化されます。開始が先なら既存sessionを保持し、archiveが先なら新規開始を拒否します。UPDATE失敗時はrollbackし、安全な500とno-storeだけを返し、秘密を応答・ログに出しません。ローカル管理者/socket/Host/Origin/no-store、512 KiBの受信上限と固定エラーを再利用し、learnerは403です。GETは書き込みません。

公開停止は一方向で、再公開・停止解除は対象外です。公開済み内容がAPI上不変な現段階に限り、保存状態そのものをキーとして一度だけ遷移させます。将来再公開を導入する場合は、古いarchive要求が新しい公開を停止しないよう別途版照合（expectedRevision等）が必要です。これは未合意の再公開機能を先取りしないための制限です。新しい改訂版の作成と旧版停止の同時処理は後続の改訂Issueで扱い、単独のarchiveはその代替ではありません。schema・migration・依存の変更はありません。HTTP経路、初回/再送とも200、revisionの加算、キー不要は Issue #46 の実装契約であり、既存docsの規定（status archived、公開停止による新規開始停止、既存演習・履歴の保持）とは区別します。

## 未公開候補の内容修正・引用再照合・確認取消API（Issue #48）

管理者が、一度も公開していないdraftセットに属する生成候補の問題文・選択肢・正答・解説・引用を修正できます。`docs/screens-and-data-model.md` の管理セット画面「問題・選択肢・正解・解説・引用の確認修正」、公開ルール2「問題内容の編集後は照合・管理者確認をやり直す」、ルール3「公開済みセットの構成と問題版の内容は固定する」を実装します。未公開かつ履歴から参照されていない候補だけを同じ `question_versions` 行で更新します。公開済み・archivedの版の修正、改訂用複製・新version生成、`supersedes` の切替、教材本文の編集、UI、生成モデルの再呼出、通知、不備解除、監査履歴、認証拡張は対象外です。

- `PUT /api/admin/sets/:setId/versions/:versionId/content`: 本文は `expectedRevision`（GETのセットrevision）、`expectedFingerprint`（GETの候補fingerprint）と `body`/`choices`/`answerIds`/`explanation`/`quote` の完全な組です。部分更新はできません。これ以外のフィールド（`id`/`questionId`/`versionNo`/`sourceId`/`generationRunId`/`reviewedBy`/`reviewedAt`/`quoteVerified` など）、配列・非オブジェクト、不正JSONは400で、入力検証はセット検索より先です。内容5項目は生成結果と同じ契約（`validateGeneration`）で検証します: 本文・解説・引用は空白のみ不可で各10,000文字以内、選択肢は2〜6件・ID形式 `[A-Za-z0-9_-]{1,40}`・版内一意・ラベル2,000文字以内、正答IDは非空・重複なし・選択肢の部分集合。受信上限512 KiB/10秒、Content-Type、ローカル管理者/socket/Host/Origin/no-store、固定エラーは既存部品を再利用し、learner・user欠落・`MEDIQUEST_LOCAL_MODE=false` は403です。
- 対象外の状態は409です: セットがdraft以外または公開日時あり、対象版が公開記録（`published_at` 非null、archived含む）を持つ別セットの `set_items` から参照、`study_items` から参照（演習履歴が参照する内容は変更しない）、不備確定済み（`invalidated_at` 非null）、生成runが成功以外、問題が `stopped`、問題/runと教材の所属不一致、確認者/時刻の片方だけが記録。所属しない版・不存在のセット/版は404です。
- `expectedRevision` と `expectedFingerprint` の両方を現在値と照合し、どちらかが古ければ内容が同一でも409です（stale再送を『同じ本文だから』で受理しない）。両方が現在値で内容が完全一致する場合だけno-opとして200を返し、確認状態・revisionは変わりません。
- 差分がある場合は同じIMMEDIATE transactionで、内容5項目と教材本文との `quoteVerified`（サーバー計算）を更新し、`reviewedBy`/`reviewedAt` をnullに戻し、既存の安全な `nextRevision` でセットrevisionを1増やします。`set_items`（採用のID/位置）、問題ID、版番号、生成run、教材、公開履歴、演習回答は変更しません。採用済み候補は未確認に戻るため、再確認するまで `POST .../publish` は409です。古いfingerprintでの確認・古い公開要求も409です。
- 応答は初回/no-opとも200で `id/questionId/versionNo/body/choices/answerIds/explanation/quote/quoteVerified/reviewedBy/reviewedAt/fingerprint/revision/changed` の明示DTOです。`fingerprint` は新しい内容fingerprint、`revision` はセットの現在revision、`changed` は保存が起きたかです。
- 確認API・公開API・採用APIとは同じtransactionで直列化されます。確認→編集は確認取消、編集→古いfingerprintの確認は409。公開→編集は409、編集→古い公開は409、編集後の新しい公開要求も再確認まで409です。同じ基準からの異なる編集は一方だけ保存され、A→B→Aの後に古い `expectedRevision` でBを再送しても復活しません。UPDATE途中の失敗は内容・確認・revisionをすべてrollbackし、安全な500とno-storeだけを返し、本文を応答・ログに出しません。

成功応答が失われた場合の自動再送200（受付記録）は導入しません。クライアントは `GET /api/admin/sets/:id` で現在のrevision/fingerprint/内容を確認してから、必要なら新しい値で再送してください。引用一致と管理者確認は医学的正答性を保証しません。修正内容の総量は512 KiBの受信上限と各フィールド上限で制限され、費用保証ではありません。schema・migration・依存の変更はありません。同一行更新、stale 409、no-op契約、200/`changed` の応答形は Issue #48 の実装契約であり、既存docsの規定（編集後の再照合・再確認、公開済み版の不変）とは区別します。
