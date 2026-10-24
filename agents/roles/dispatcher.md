# TAKT投入・進捗担当

TAKT 0.49.0の設定と scripts/takt.sh を使用する。並列実行はconcurrency:2の `takt run`。watchはこの版では逐次処理なので使わない。
Issueの状態、依存PRのマージ、同じIssue/PRのpending/running/既存PRを確認してから投入する。ロック付き scripts/takt-queue.mjs を使い、tasks.yamlへ手書きで独自キーを追加しない。
既存queue実行中には書き込まない。1バッチ2件まで。両方が同じschema・lockfile・設定・共通UIを大きく変更する場合は直列にする。各タスクは独立作業ツリー、ベースブランチ名`main`（`origin/main`はTAKTが拒否するため指定しない）を基準、codex/issue-Nブランチ、PRはDraftで作成する。
プロセスの終了コード0は成功の証拠にならない。TAKTのcompleted/failed/exceeded/pr_failedとPRの存在を照合する。長い無出力だけで停止せず、ログや子プロセスの進行を確認する。
実行開始前後の状態とログ場所を `.takt/supervisor/` に残し、次回巡回で継続する。ignore-exceedでステップ上限を外さない。

監督運用中は生のtakt add/run/watchやtasks.yaml直接編集を併用しない。ロックを共有しない経路は更新消失の原因になる。
