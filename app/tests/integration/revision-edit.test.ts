import { expect, it } from 'vitest';
import { revisionFixture } from '../fixtures/revision';
import {
  getSet,
  updateVersionContent,
} from '../../server/services/review/service';

it('freezes A/B ancestry, allocates C across drafts, keeps no-ops and rolls back each COW mutation', async () => {
  const f = await revisionFixture();
  try {
    const c = f.c.client;
    const edit = (setId: number, id: number, body = 'changed') => {
      const d = getSet(f.c, setId);
      const v = d.candidates.find((v) => v.id === id)!;
      return updateVersionContent(f.c, setId, id, {
        expectedRevision: d.revision,
        expectedFingerprint: v.fingerprint,
        body,
        choices: v.choices,
        answerIds: v.answerIds,
        explanation: v.explanation,
        quote: v.quote,
      });
    };
    const rows = () =>
      ['question_versions', 'set_candidates', 'set_items', 'question_sets'].map(
        (t) => c.prepare(`select * from ${t} order by id`).all(),
      );
    const before = rows();
    const v = getSet(f.c, f.run.setId).candidates.find(
      (v) => v.id === f.sharedId,
    )!;
    expect(edit(f.run.setId, v.id, v.body)).toMatchObject({
      changed: false,
      id: v.id,
      reviewedBy: 1,
    });
    expect(rows()).toEqual(before);
    for (const trigger of [
      'before insert on question_versions',
      'before update on set_candidates',
      'before update of revision on question_sets',
    ]) {
      c.exec(
        `create trigger fail_cow ${trigger} begin select raise(abort,'PRIVATE_SQL'); end`,
      );
      try {
        expect(() => edit(f.run.setId, v.id)).toThrow();
        expect(rows()).toEqual(before);
      } finally {
        c.exec('drop trigger fail_cow');
      }
    }
    const first = edit(f.targetId, f.sharedId);
    expect(first.versionNo).toBe(2);
    // A no longer has another candidate, but B now permanently refers to A.
    const second = edit(f.run.setId, f.sharedId);
    expect(second.versionNo).toBe(3);
    expect(
      c
        .prepare(
          'select derived_from_version_id from question_versions where id=?',
        )
        .get(second.id),
    ).toEqual({ derived_from_version_id: f.sharedId });
    expect(
      c
        .prepare('select body from question_versions where id=?')
        .get(f.sharedId),
    ).toEqual({ body: v.body });
    expect(
      c.prepare('select body from question_versions where id=?').get(first.id),
    ).toEqual({ body: 'changed' });
    const parent = edit(f.run.setId, f.parentId);
    expect(parent.versionNo).toBe(3);
    expect(
      c
        .prepare(
          'select derived_from_version_id from question_versions where id=?',
        )
        .get(f.derivedId),
    ).toEqual({ derived_from_version_id: f.parentId });
    // Invalidated no-op keeps the record; changed content creates a clean,
    // unconfirmed child and does not clear the old invalidation.
    c.prepare(
      "update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='reason' where id=?",
    ).run(second.id);
    expect(edit(f.run.setId, second.id, 'changed').changed).toBe(false);
    const repaired = edit(f.run.setId, second.id, 'repaired');
    expect(repaired.reviewedBy).toBeNull();
    expect(
      c
        .prepare(
          'select invalidated_at,invalidation_reason from question_versions where id=?',
        )
        .get(second.id),
    ).toEqual({ invalidated_at: 1, invalidation_reason: 'reason' });
    expect(
      c
        .prepare(
          'select invalidated_at,generation_run_id,derived_from_version_id from question_versions where id=?',
        )
        .get(repaired.id),
    ).toEqual({
      invalidated_at: null,
      generation_run_id: null,
      derived_from_version_id: second.id,
    });
    expect(getSet(f.c, f.run.setId).items).toEqual([]);
  } finally {
    f.close();
  }
});

it('rejects unsafe version and set revision increments without partial writes', async () => {
  const f = await revisionFixture();
  try {
    const c = f.c.client;
    const v = getSet(f.c, f.run.setId).candidates.find(
      (v) => v.id === f.sharedId,
    )!;
    const input = {
      expectedRevision: 0,
      expectedFingerprint: v.fingerprint,
      body: 'changed',
      choices: v.choices,
      answerIds: v.answerIds,
      explanation: v.explanation,
      quote: v.quote,
    };
    c.prepare('update question_versions set version_no=? where id=?').run(
      Number.MAX_SAFE_INTEGER,
      v.id,
    );
    expect(() => updateVersionContent(f.c, f.run.setId, v.id, input)).toThrow(
      'conflict',
    );
    c.prepare('update question_versions set version_no=1 where id=?').run(v.id);
    c.prepare('update question_sets set revision=? where id=?').run(
      Number.MAX_SAFE_INTEGER,
      f.run.setId,
    );
    expect(() =>
      updateVersionContent(f.c, f.run.setId, v.id, {
        ...input,
        expectedRevision: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow('conflict');
    expect(
      c.prepare('select count(*) as count from question_versions').get(),
    ).toEqual({ count: 7 });
  } finally {
    f.close();
  }
});
