Issueの全ACを実際の差分と照合する。権限、回答前の正解漏洩、DBの版管理と履歴、二重送信、中断再開、両テーマ・画面幅・エラー状態を該当範囲で確認する。テストが仕様を検証しているか、削除・skip・期待値弱体化で通していないかを確認する。品質ゲート・CI・TAKTの変更は特に確認する。指摘があれば根拠と修正条件を記載。重大な未確認事項を承認扱いしない。コードは編集しない。

直前のhost検証証拠 `.takt/quality/latest.json` とそこに記載のlogを読む。worktree、snapshot、attemptId、実行時刻、status=passed、全7checksを確認し、attemptIdをレビュー報告へ記載する。implementerの自己申告や過去の証拠のみで承認しない。readonly工程でコマンド再実行を要求せず、差分とテスト内容を独立評価する。証拠が欠ける/失敗/古い疑いは承認しない。finalizeのhost verifierがsnapshotとlog改変を再検査する。
