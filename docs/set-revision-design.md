# 公開セット改訂の実装契約

Issue #57 の設計成果。基準は main `6235e379`。**この資料の追加では改訂機能は実装されない。** 以下の「実装判断」は既存合意を具体化する後続実装の契約であり、ユーザーが個別に指定した仕様とは区別する。

## 既存合意と現在の差分

根拠は [画面・データ設計](screens-and-data-model.md) の「公開・修正・履歴のルール」3〜7と [UX方針](ux-guidelines.md)。公開済み内容・構成を変えず、変更版だけ新しく作り、改訂公開と旧セット公開停止を原子的に行う。通常の改訂は再採点しない。

| 対象 | 現行実装 | 本設計で必要な変更 |
| --- | --- | --- |
| 改訂元 | 設計上の `supersedes_set_id` が実schemaにはない | 改訂元と作成時revisionを保存 |
| 候補所属 | reviewの候補・件数は version → generation_run → set で推定 | 明示的な候補所属へ置換 |
| 生成来歴 | `generation_run_id` が必須 | 生成なしの派生版を表現。既存runは保持 |
| 採用・順序 | `set_items` | 候補所属と分離したまま維持 |
| 内容修正 | 未公開・履歴未参照の同一行のみ更新 | 共有・公開版からの変更は別行を作る |
| 公開 | 下書き単体の公開と単体archive | 改訂元との同時更新を追加 |
| 学習履歴 | 開始時の版・順序、回答時正誤を保持 | 置換・再採点せず回帰検証 |

対応箇所は `app/server/db/schema.ts`、`services/review/service.ts`、`services/publication/service.ts`（servicesは `app/server/` 配下）。既存の公開版編集拒否、管理者境界、停止・不備除外を解除しない。TAKT workerのdocs保護は変更せず、監督側の設計作業として扱う。

## 最小データ案（実装判断）

以下の一案を採用し、汎用ブランチ管理や改訂履歴専用コピーは導入しない。

- `question_sets` に nullableな `supersedes_set_id`（自己FK、削除RESTRICT）と `supersedes_revision` を追加する。両方NULLまたは両方指定。後者は作成時の元セットrevision。作成後は変更不可。
- 同じ元セットから複数の下書き作成を許す。ただし `supersedes_set_id WHERE published_at IS NOT NULL` に部分一意indexを設け、**一度でも公開された後継は一つ**にする。後継をarchiveしても別の兄弟は公開できない。次の改訂は後継から作る。
- `set_candidates(set_id, question_id, question_version_id)` を追加する。setとversionにRESTRICT FK、`UNIQUE(set_id, question_id)` と `UNIQUE(set_id, question_version_id)`。version側に `UNIQUE(id, question_id)` を追加し、候補からの複合FKで論理問題との一致を保証する。
- 教材一致はtransaction内で set.source_id = question.source_id を検証する。候補は同一論理問題につき一版。`set_items` は候補の `(set_id, question_version_id)` を複合FKで参照し、採用集合・順序だけを表す。版の交換時は採用参照を一時削除して候補を交換し、元の順序で再挿入する。途中状態を外へ見せない。
- `question_versions.generation_run_id` をnullableにし、nullableな `derived_from_version_id`（自己FK、RESTRICT）を追加する。既存生成版は元runを保持、手動派生版はrun=NULLかつderived_from指定。両者のどちらか一方を必須にするCHECKを設ける。派生元は同じquestionであることをサービスで検証する。
- `set_revision_requests` は `(requested_by, request_key)` を一意にし、元set ID・要求した元revision・新タイトル/説明を含む正規化要求fingerprint・作成set IDを保持する。元set/作成set/userはRESTRICT FK。採用済みの生成受付とは別のキー空間にする。

旧生成版の所属を変えるためにrunを作ったり `generation_runs.set_id` を更新したりしない。生成来歴のDTOは派生版ではnullと派生元IDを明示し、元runを「この版を生成したrun」として表示しない。既存の引用・確認は版の属性であり、所属ごとの確認テーブルは追加しない。

## APIと状態遷移（実装判断）

すべて管理者限定で既存のローカル境界・入力制限・安全なエラー・no-storeを継承する。以下のフィールド名は後続実装の契約とする。

| 操作 | API・入力 | 結果と競合 |
| --- | --- | --- |
| 改訂作成 | `POST /api/admin/sets/:setId/revisions`、`requestKey`, `expectedRevision`, `title`, `description` | 初回201、同一要求再送200 + `replayed:true`。同一キー別要求409 |
| 内容変更 | 既存 `PUT /api/admin/sets/:setId/versions/:versionId/content`、既存内容フィールドとexpectedRevision/expectedFingerprint | 新版が必要なら新version IDを返す。要求先versionが現在候補でなければ409 |
| 内容の明示確認 | 既存 `PUT /api/admin/sets/:setId/versions/:versionId/review` | 現在候補・期待revision/fingerprintを照合。共有公開版の確認解除は従来どおり拒否 |
| 採用・並替え | 既存採用API | 同一教材・一論理問題一版・候補所属を検証。競合409 |
| 改訂公開 | 既存公開APIの改訂分岐、既存expectedRevision/fingerprint | 新旧を同一transactionで確定。正確な再送は保存済み結果、異要求・古い状態409 |

改訂作成は公開履歴がある published または archived のセットに限定する。draft元は409。archivedからも修正できるが、元を再公開する操作はしない。既に公開済み後継がある元は409で後継IDを返し、後継からの改訂を促す。複数下書きの統合や自動付替えは行わない。

作成はIMMEDIATE transactionで管理者、同一キーの保存済み要求、元状態/revision、公開済み後継なしを順に検査する。元の採用版だけを候補と採用行へ同じ順序で複製する。未採用の生成候補は複製しない。変更なしの版は同じIDを参照し、確認・引用結果も保持する。空の元セット等の不整合は修復せず失敗させる。正確な再送は元の状態が後で変わっていても作成済みset IDを返す（新規作成や再公開はしない）。

新しい改訂下書きは draft → published → archived。公開済み元は公開時に archived へ、既にarchivedならそのまま。元の状態/revisionが作成後に変われば409とし、下書きの元revisionを黙って更新しない。新しい要求キーで最新元から作り直す。停止・不備は最新状態を別途検証する。

### 内容編集と確認

内容が同じ要求は既存の期待値検査後にno-op。内容が違い、対象版が他セット候補・公開履歴・演習・他版の `derived_from_version_id` から参照されている場合は、新行を作りその下書きの候補だけ交換する。派生版の `version_no` は同じquestionの `MAX(version_no)+1` をIMMEDIATE transaction内で採番し、既存一意制約を維持する。並行下書きで別の版番号が作られてもよい。公開順と版番号順の一致は要求しない。

新しい内容は形式検証・引用再照合を行い、管理者確認をNULLにする。採用済みなら同じ位置を新版へ交換するが、未確認のため公開できない。自分の下書きだけから参照される未公開・演習未参照版で、他版の派生元にもなっていない場合だけ、既存の同一行編集を継続できる。派生元として一度参照された版は、候補の共有が解消しても内容を固定し、編集時には新行へ分離する。派生元の来歴は不変。既存禁止条件を共通化し、旧版の本文・正解・確認を更新しない。

内容編集はrequest keyを追加しない。応答消失時はGETで候補と内容を再取得する。同じ旧ID/古い期待値での再送は409、新版を重複作成しない。確認・採用も既存の期待値による競合検出を維持する。

論理問題のstoppedは全版に作用し、新版作成で解除されない。不備確定は版ごとなので、派生元の不備記録を新しい内容へコピーしない。ただし新版は未確認であり再検証が必要。変更しない不備版は再利用されても公開条件を満たさない。引用不一致は既存どおり明示確認によって許容でき、一致だけで正しさを保証しない。

## 原子的な改訂公開

外部AI呼出しは伴わない。一つのIMMEDIATE transactionで次の順に実行する。

1. 管理者を検証し、保存済み公開要求と一致する再送を先に判定する。後にarchiveされた改訂でも同じ公開要求への再送は現在状態付きの保存済み成功として返し、再公開しない。この扱いは改訂公開に限定し、既存単体公開の再送契約を無断で変更しない。
2. 新setが未公開draftで、要求revision/fingerprintが一致することを確認する。fingerprintには候補・採用・内容・確認・停止/不備に加え、改訂元IDと保存された元revisionを含める。元の現在状態もこのtransactionで照合する。
3. 元が公開履歴を持つpublished/archivedで、同じ教材、保存したrevisionと一致し、公開済み後継がないことを検証する。自己参照・循環・別教材参照は作成時にも禁止する。
4. 採用が1問以上、形式・正解・引用照合済み・明示確認・候補所属・同一論理問題重複なし・停止/不備なし等、通常公開の全条件を同じ検証関数で確認する。
5. 新setに公開者/日時/要求revision/fingerprintを保存しrevisionを更新する。元がpublishedならarchiveしてrevisionを更新する。元がarchivedなら元の情報を変更しない。両更新成功後にcommitする。

並行する兄弟公開は元revisionと後継一意制約で一つだけ成功する。公開と単体archive、不備確定、論理問題停止はwrite transactionで直列化され、先に不備等が確定した場合は公開を拒否する。公開が先に完了した後の不備等は既存の除外処理を適用する。途中の制約違反・DB失敗で公開メタデータ、旧set状態、revisionをすべてrollbackする。公開要求の記録だけ残して成功扱いにしない。

旧setからの新規演習開始はarchive後拒否する。先に開始transactionが完了した演習は固定済みの版/順序を保持し、通常どおり続行する。既存回答・回答時正誤・選択肢は変更せず、改訂による再採点をしない。誤答復習も旧版を使い、新版へ自動置換しない。停止・不備による既存の除外だけを適用する。

## 移行と段階導入

生成Drizzle migrationを追加し、過去migrationを書き換えない。テーブル再構築が必要な場合は既存runnerのtransaction/FK整合性検査を使う。ID、version_no、生成run、公開記録、回答をそのまま移す。AUTOINCREMENTのhigh-waterも保持する。

候補は既存 version → generation_run.set_id をそのまま一度だけbackfillする。先に同一教材・一論理問題一版・全set_itemsが候補に含まれることを検証する。不一致は移行全体をrollbackし、推測で所属を直したり採用行を捨てたりしない。既存生成版はderived_from=NULL、既存setはsupersedes関連NULL。migration再適用で重複候補を作らない。

後続Issueは以下の順に直列実施する（番号は作成時に付与）。各段階で通常機能の全7品質ゲートと独立レビューを維持する。

1. **候補所属と改訂データ基盤**: 上記schema/生成migration/backfill。生成保存時に候補も原子的に登録。reviewの一覧件数・詳細・内容/確認とpublicationを明示所属に切替。既存生成来歴を保持。改訂元を持つsetは公開APIで必ず409にする暫定guardを同時導入し、HTTPで拒否を検証する。旧DB移行、再適用、途中失敗/FK不整合rollback、既存全回帰がAC。
2. **改訂下書き作成と版編集**（1依存）: 上記作成API、要求記録、派生版作成・採用位置維持、明示確認。同時再送は1下書き、異要求409、並行採番、旧版/回答不変、共有未公開版の分離、停止/不備と引用不一致を検証する。特に共有未公開版Aから別下書きでBを派生させた後、元の下書きでAを再編集してもAの内容とBの派生元参照が不変で、新しい版Cへ候補が切り替わることを回帰ACに含める。暫定公開guardは維持し、作成した改訂が既存publish経由でも公開不能なことがAC。
3. **改訂の原子的公開**（2依存）: 暫定guardを上記改訂分岐へ置換。兄弟競合、archive競合、開始/不備/停止との競合、二つ目の更新失敗rollback、正確な再送、全条件不成立時の非公開を実HTTP/DBで検証。旧演習続行・結果不変・旧版復習、学習一覧の旧非掲載/新掲載、未公開・正答非露出がAC。
4. **管理UI接続**（3依存、別Issue）: 既存の人によるデザイン確認を維持。元/改訂版、未確認、引用警告、競合と作り直しを明示する。API完成をUI完成と扱わない。

バックアップは現行 `app/server/db/backup.ts` のmigration履歴・exact-schema照合を維持する。schema更新後は旧schemaのバックアップを新アプリへ直接復元できないことを明記し、拒否テストを残す。更新前に旧バージョンで検証済みバックアップを取得し、コピーしたDBに移行して検証してから更新する。旧バックアップは対応する旧バージョンで復元したコピーへ正式migrationを適用する。復元処理に暗黙の移行やschemaチェック免除を追加しない。新schemaで候補・派生元・改訂受付・新旧公開状態・演習履歴が往復保持されるテストを各schema変更に含める。

本Issueではschema/APIの実行検証を行わない。後続実装・実HTTP検証・独立レビューが揃うまでは、改訂の利用可能性を報告しない。
