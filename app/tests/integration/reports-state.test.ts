import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import {
  startSession,
  getSession,
  getStudyItem,
} from '../../server/services/study/service';
import { createReport } from '../../server/services/reports/service';
it('creates first reports from answered, completed, stopped-unanswered and excluded items without modifying their DB or DTO state', async () => {
  const f = await catalogFixture();
  try {
    const sessions = Array.from(
      { length: 4 },
      () => startSession(f.c, { setId: f.run.setId }, randomUUID()).session,
    );
    f.c.client
      .prepare(
        'update study_items set selected_ids_json=\'["b"]\',is_correct=0,answered_at=19 where session_id in (?,?)',
      )
      .run(sessions[0]!.id, sessions[1]!.id);
    f.c.client
      .prepare(
        "update study_sessions set status='completed',completed_at=20 where id=?",
      )
      .run(sessions[1]!.id);
    f.c.client
      .prepare(
        "update study_items set excluded_reason='stopped',excluded_at=21 where session_id=?",
      )
      .run(sessions[3]!.id);
    f.c.client.exec("update questions set status='stopped'");
    for (const s of sessions) {
      f.c.client.exec("update issue_reports set status='dismissed'");
      const tables = [
        'study_sessions',
        'study_items',
        'questions',
        'question_versions',
        'question_sets',
        'set_items',
      ];
      const snap = () =>
        tables.map((t) => f.c.client.prepare(`select * from ${t}`).all());
      const before = snap(),
        summary = getSession(f.c, s.id),
        item = getStudyItem(f.c, s.id, s.items[0]!.id);
      expect(
        createReport(f.c, s.id, s.items[0]!.id, { message: '指摘' }).replayed,
      ).toBe(false);
      expect(snap()).toEqual(before);
      expect(getSession(f.c, s.id)).toEqual(summary);
      expect(getStudyItem(f.c, s.id, s.items[0]!.id)).toEqual(item);
    }
  } finally {
    f.close();
  }
});
