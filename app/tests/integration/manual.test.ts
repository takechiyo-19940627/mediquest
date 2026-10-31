import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
import { createRevision } from '../../server/services/revisions/service';
import {
  startSession,
  answerStudyItem,
  getStudyItem,
} from '../../server/services/study/service';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { manualFixture } from '../fixtures/manual';
import { candidate } from '../fixtures/generation';
import { createManualSet } from '../../server/services/manual/service';
import {
  getSet,
  confirmVersion,
  updateVersionContent,
} from '../../server/services/review/service';
it('saves unconfirmed manual provenance without AI runs and replays atomically with conflict detection', () => {
  const f = manualFixture();
  try {
    const key = randomUUID();
    const body = {
      title: '手動',
      questions: [
        candidate(),
        { ...candidate('二問'), quote: '教材にない引用' },
      ],
    };
    const first = createManualSet(f.c, 1, body, key);
    expect(first.replayed).toBe(false);
    expect(createManualSet(f.c, 1, body, key.toUpperCase())).toEqual({
      ...first,
      replayed: true,
    });
    expect(() =>
      createManualSet(f.c, 1, { ...body, title: '違う' }, key),
    ).toThrow('conflict');
    const d = getSet(f.c, first.setId);
    expect(d.candidates).toHaveLength(2);
    expect(
      d.candidates.map((q) => [
        q.manualCreatedBy,
        q.generationRunId,
        q.derivedFromVersionId,
        q.reviewedBy,
        q.quoteVerified,
      ]),
    ).toEqual([
      [1, null, null, null, true],
      [1, null, null, null, false],
    ]);
    expect(
      f.c.client.prepare('select count(*) as n from generation_runs').get(),
    ).toEqual({ n: 0 });
    for (const table of [
      'question_sets',
      'questions',
      'question_versions',
      'set_candidates',
      'manual_set_requests',
    ]) {
      const before = [
        'question_sets',
        'questions',
        'question_versions',
        'set_candidates',
        'manual_set_requests',
      ].map((t) => f.c.client.prepare(`select * from ${t}`).all());
      f.c.client.exec(
        `create trigger fail_manual before insert on ${table} begin select raise(abort,'PRIVATE'); end`,
      );
      expect(() => createManualSet(f.c, 1, body, randomUUID())).toThrow();
      expect(
        [
          'question_sets',
          'questions',
          'question_versions',
          'set_candidates',
          'manual_set_requests',
        ].map((t) => f.c.client.prepare(`select * from ${t}`).all()),
      ).toEqual(before);
      f.c.client.exec('drop trigger fail_manual');
    }
  } finally {
    f.close();
  }
});
it('keeps manual ancestry frozen under copy-on-write and requires confirmation after editing', () => {
  const f = manualFixture();
  try {
    const { setId } = createManualSet(
      f.c,
      1,
      { title: '手動', questions: [candidate()] },
      randomUUID(),
    );
    const v = getSet(f.c, setId).candidates[0]!;
    confirmVersion(f.c, setId, v.id, {
      fingerprint: v.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    });
    // A second draft references the same immutable candidate, forcing COW.
    const target = createManualSet(
      f.c,
      1,
      { title: '別', questions: [candidate()] },
      randomUUID(),
    );
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) values(?,?,?)',
      )
      .run(target.setId, v.questionId, v.id);
    const d = getSet(f.c, setId);
    const q = d.candidates[0]!;
    const edited = updateVersionContent(f.c, setId, q.id, {
      expectedRevision: d.revision,
      expectedFingerprint: q.fingerprint,
      body: '訂正',
      choices: q.choices,
      answerIds: q.answerIds,
      explanation: q.explanation,
      quote: q.quote,
    });
    expect(edited.id).not.toBe(q.id);
    expect(edited.reviewedBy).toBeNull();
    expect(
      f.c.client
        .prepare(
          'select body,manual_created_by,derived_from_version_id from question_versions where id=?',
        )
        .get(q.id),
    ).toEqual({
      body: q.body,
      manual_created_by: 1,
      derived_from_version_id: null,
    });
    expect(
      f.c.client
        .prepare(
          'select manual_created_by,generation_run_id,derived_from_version_id from question_versions where id=?',
        )
        .get(edited.id),
    ).toEqual({
      manual_created_by: null,
      generation_run_id: null,
      derived_from_version_id: q.id,
    });
    expect(() =>
      f.c.client
        .prepare('update question_versions set manual_created_by=1 where id=?')
        .run(edited.id),
    ).toThrow();
    expect(() =>
      f.c.client
        .prepare(
          'update question_versions set manual_created_by=null where id=?',
        )
        .run(q.id),
    ).toThrow();
  } finally {
    f.close();
  }
});
it('publishes manual questions, grades multiple answers, and preserves history through revision publication', () => {
  const f = manualFixture();
  try {
    const { setId } = createManualSet(
      f.c,
      1,
      {
        title: '複数正解',
        questions: [{ ...candidate(), answerIds: ['a', 'b'] }],
      },
      randomUUID(),
    );
    const publish = (id: number) => {
      let d = getSet(f.c, id);
      for (const q of d.candidates)
        confirmVersion(f.c, id, q.id, {
          fingerprint: q.fingerprint,
          confirmed: true,
          acknowledgeQuoteMismatch: false,
        });
      d = getSet(f.c, id);
      replaceItems(f.c, id, {
        expectedRevision: d.revision,
        versionIds: d.candidates.map((q) => q.id),
      });
      d = getSet(f.c, id);
      publishSet(f.c, id, {
        expectedRevision: d.revision,
        publishFingerprint: d.publishFingerprint,
        confirmed: true,
      });
    };
    expect(() =>
      replaceItems(f.c, setId, {
        expectedRevision: 0,
        versionIds: getSet(f.c, setId).candidates.map((q) => q.id),
      }),
    ).toThrow('conflict');
    publish(setId);
    const { session } = startSession(f.c, { setId }, randomUUID());
    answerStudyItem(f.c, session.id, session.items[0]!.id, {
      selectedIds: ['a', 'b'],
    });
    const history = getStudyItem(f.c, session.id, session.items[0]!.id);
    expect(history).toMatchObject({ feedback: { isCorrect: true } });
    const draft = createRevision(f.c, setId, {
      requestKey: randomUUID(),
      expectedRevision: getSet(f.c, setId).revision,
      title: '改訂',
      description: '',
    });
    const d = getSet(f.c, draft.id);
    const q = d.candidates[0]!;
    updateVersionContent(f.c, draft.id, q.id, {
      expectedRevision: d.revision,
      expectedFingerprint: q.fingerprint,
      body: '改訂問題',
      choices: q.choices,
      answerIds: ['b'],
      explanation: '改訂解説',
      quote: q.quote,
    });
    publish(draft.id);
    expect(getStudyItem(f.c, session.id, session.items[0]!.id)).toEqual(
      history,
    );
    expect(
      f.c.client.prepare('select count(*) as n from generation_runs').get(),
    ).toEqual({ n: 0 });
  } finally {
    f.close();
  }
});
