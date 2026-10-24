import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import {
  startSession,
  answerStudyItem,
  getSession,
  getStudyItem,
  resumeSession,
} from '../../server/services/study/service';
import {
  createReport,
  resolveReport,
  getReport,
} from '../../server/services/reports/service';
import { getPublishedSet } from '../../server/services/learning-catalog/service';
import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
import { getSet } from '../../server/services/review/service';
it('invalidates a fixed version for all histories while preserving answers and projecting without writes', async () => {
  const f = await catalogFixture();
  try {
    const start = () =>
      startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
    const answered = start(),
      pending = start(),
      stopped = start();
    for (const item of answered.items)
      answerStudyItem(f.c, answered.id, item.id, {
        selectedIds: ['SECRET_ANSWER'],
      });
    f.c.client
      .prepare(
        "update study_items set excluded_reason='stopped',excluded_at=1 where session_id=?",
      )
      .run(stopped.id);
    const report = createReport(f.c, pending.id, pending.items[0]!.id, {
      message: '不備',
    });
    const saved = f.c.client.prepare('select * from study_items').all();
    const completed = getSession(f.c, answered.id).completedAt;
    const untouched = f.c.client.prepare('select * from set_items').all();
    const resolution = resolveReport(f.c, report.id, {
      decision: 'confirmed',
      note: ' 根拠不正 ',
    });
    expect(resolution).toMatchObject({
      status: 'confirmed',
      resolutionNote: '根拠不正',
      replayed: false,
    });
    expect(
      resolveReport(f.c, report.id, {
        decision: 'confirmed',
        note: '根拠不正',
      }),
    ).toEqual({ ...resolution, replayed: true });
    expect(() =>
      resolveReport(f.c, report.id, {
        decision: 'dismissed',
        note: '根拠不正',
      }),
    ).toThrow('conflict');
    const state = getSession(f.c, answered.id);
    expect(state.statistics).toMatchObject({
      eligibleCount: 1,
      correctEligibleCount: 1,
      excludedCount: 1,
      accuracy: 1,
    });
    expect(state.completedAt).toBe(completed);
    for (const s of [answered, pending, stopped])
      expect(getStudyItem(f.c, s.id, s.items[0]!.id)).toEqual({
        id: s.items[0]!.id,
        position: 0,
        state: 'excluded',
        excludedReason: 'invalidated',
      });
    expect(f.c.client.prepare('select * from study_items').all()).toEqual(
      saved,
    );
    expect(
      answerStudyItem(f.c, answered.id, answered.items[0]!.id, {
        selectedIds: ['SECRET_ANSWER'],
      }).item,
    ).toMatchObject({ state: 'excluded', excludedReason: 'invalidated' });
    expect(() =>
      answerStudyItem(f.c, pending.id, pending.items[0]!.id, {
        selectedIds: ['SECRET_ANSWER'],
      }),
    ).toThrow('conflict');
    expect(() =>
      answerStudyItem(f.c, answered.id, answered.items[0]!.id, {
        selectedIds: ['b'],
      }),
    ).toThrow('conflict');
    expect(getPublishedSet(f.c, f.run.setId).availableQuestionCount).toBe(1);
    expect(start().items.map((i) => i.position)).toEqual([1]);
    const next = createReport(f.c, pending.id, pending.items[1]!.id, {
      message: '別の不備',
    });
    resolveReport(f.c, next.id, { decision: 'confirmed', note: '別の根拠' });
    expect(getSession(f.c, pending.id)).toMatchObject({
      status: 'in_progress',
      statistics: { accuracy: null, accuracyStatus: 'no_eligible_items' },
    });
    expect(getPublishedSet(f.c, f.run.setId)).toMatchObject({
      canStart: false,
      availableQuestionCount: 0,
    });
    expect(() => start()).toThrow('conflict');
    expect(resumeSession(f.c, pending.id).status).toBe('completed');
    expect(resumeSession(f.c, answered.id).completedAt).toBe(completed);
    resumeSession(f.c, stopped.id);
    const after = f.c.client
      .prepare(
        'select selected_ids_json,is_correct,answered_at from study_items where session_id=?',
      )
      .all(answered.id);
    expect(after).toEqual(
      (saved as Record<string, unknown>[])
        .filter((r) => r.session_id === answered.id)
        .map((r) => ({
          selected_ids_json: r.selected_ids_json,
          is_correct: r.is_correct,
          answered_at: r.answered_at,
        })),
    );
    expect(f.c.client.prepare('select * from set_items').all()).toEqual(
      untouched,
    );
    expect(
      f.c.client
        .prepare("select count(*) n from questions where status!='active'")
        .get(),
    ).toEqual({ n: 0 });
    expect(
      f.c.client
        .prepare(
          'select excluded_reason,excluded_at from study_items where id=?',
        )
        .get(stopped.items[0]!.id),
    ).toEqual({
      excluded_reason: 'invalidated',
      excluded_at: resolution.resolvedAt,
    });
  } finally {
    f.close();
  }
});
it('keeps the first invalidation and other reports independent; dismissal does not undo invalidation', async () => {
  const f = await catalogFixture();
  try {
    const s = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
    const a = createReport(f.c, s.id, s.items[0]!.id, { message: 'first' });
    f.c.client.exec(
      "insert into users(id,display_name,role,created_at) values(2,'other','learner',1)",
    );
    const otherSession = f.c.client
      .prepare(
        "insert into study_sessions(user_id,set_id,status,mode,start_request_key,started_at) values(2,?,'in_progress','normal','other',1) returning id",
      )
      .get(f.run.setId) as { id: number };
    const otherItem = f.c.client
      .prepare(
        'insert into study_items(session_id,question_version_id,position) values(?,?,0) returning id',
      )
      .get(otherSession.id, f.ids[0]) as { id: number };
    const b = f.c.client
      .prepare(
        "insert into issue_reports(reported_by,question_version_id,study_item_id,message,status,created_at) values(2,?,?,'other','open',1) returning id",
      )
      .get(f.ids[0], otherItem.id) as { id: number };
    resolveReport(f.c, a.id, { decision: 'confirmed', note: 'first reason' });
    const before = getReport(f.c, a.id).version;
    expect(getReport(f.c, b.id).status).toBe('open');
    resolveReport(f.c, b.id, { decision: 'confirmed', note: 'second reason' });
    expect(getReport(f.c, a.id).version).toEqual(before);
    const c = createReport(f.c, s.id, s.items[0]!.id, { message: 'again' });
    resolveReport(f.c, c.id, {
      decision: 'dismissed',
      note: 'already handled',
    });
    expect(getReport(f.c, a.id).version).toEqual(before);
  } finally {
    f.close();
  }
});
it('rolls back both records on invalidation failure and rejects adoption/publication of invalidated versions', async () => {
  const f = await catalogFixture();
  try {
    const s = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
    const report = createReport(f.c, s.id, s.items[0]!.id, { message: 'x' });
    f.c.client.exec(
      "create trigger fail_invalidation before update of invalidated_at on question_versions begin select raise(abort,'PRIVATE_SQL'); end",
    );
    expect(() =>
      resolveReport(f.c, report.id, { decision: 'confirmed', note: 'x' }),
    ).toThrow();
    expect(getReport(f.c, report.id)).toMatchObject({
      status: 'open',
      resolvedAt: null,
      version: { invalidatedAt: null },
    });
    f.c.client.exec('drop trigger fail_invalidation');
    // Model a prepared draft that references the encountered version; production editing remains unavailable.
    f.c.client
      .prepare(
        "update question_sets set status='draft',published_at=null,published_by=null where id=?",
      )
      .run(f.run.setId);
    const before = getSet(f.c, f.run.setId);
    resolveReport(f.c, report.id, { decision: 'confirmed', note: 'x' });
    expect(() =>
      replaceItems(f.c, f.run.setId, {
        expectedRevision: before.revision,
        versionIds: [f.ids[0]],
      }),
    ).toThrow('conflict');
    expect(() =>
      publishSet(f.c, f.run.setId, {
        expectedRevision: before.revision,
        publishFingerprint: before.publishFingerprint,
        confirmed: true,
      }),
    ).toThrow('conflict');
  } finally {
    f.close();
  }
});
