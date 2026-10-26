import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { revisionFixture } from '../fixtures/revision';
import {
  getSet,
  listSets,
  confirmVersion,
  updateVersionContent,
} from '../../server/services/review/service';
import {
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
import { getPublishedSet } from '../../server/services/learning-catalog/service';
import {
  startSession,
  getStudyItem,
  answerStudyItem,
  resumeSession,
} from '../../server/services/study/service';

it('reads, reviews, adopts, publishes and studies shared and derived candidates without changing their provenance', async () => {
  const f = await revisionFixture();
  try {
    f.c.client
      .prepare(
        'update question_versions set reviewed_by=null,reviewed_at=null where id=?',
      )
      .run(f.sharedId);
    const d = getSet(f.c, f.targetId);
    expect(d.candidates).toHaveLength(5);
    const derived = d.candidates.find((v) => v.id === f.derivedId)!;
    expect(derived).toMatchObject({
      generationRunId: null,
      derivedFromVersionId: f.parentId,
      reviewedBy: null,
    });
    expect(d.candidates.find((v) => v.id === f.sharedId)).toMatchObject({
      generationRunId: f.run.id,
      derivedFromVersionId: null,
    });
    expect(
      listSets(f.c, { limit: 20, before: undefined }).items.find(
        (s) => s.id === f.targetId,
      ),
    ).toMatchObject({ candidateCount: 5, reviewedCount: 0 });
    expect(() =>
      replaceItems(f.c, f.targetId, {
        expectedRevision: 0,
        versionIds: [f.derivedId],
      }),
    ).toThrow('conflict');
    confirmVersion(f.c, f.targetId, f.derivedId, {
      fingerprint: derived.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    });
    const shared = d.candidates.find((v) => v.id === f.sharedId)!;
    confirmVersion(f.c, f.targetId, f.sharedId, {
      fingerprint: shared.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    });
    const rows = f.c.client
      .prepare('select * from question_versions order by id')
      .all();
    replaceItems(f.c, f.targetId, {
      expectedRevision: 0,
      versionIds: [f.sharedId, f.derivedId],
    });
    const detail = getSet(f.c, f.targetId);
    expect(detail.items.map((i) => i.generationStatus)).toEqual([
      'succeeded',
      null,
    ]);
    const request = {
      expectedRevision: detail.revision,
      publishFingerprint: detail.publishFingerprint,
      confirmed: true,
    };
    expect(publishSet(f.c, f.targetId, request).replayed).toBe(false);
    expect(publishSet(f.c, f.targetId, request).replayed).toBe(true);
    expect(getPublishedSet(f.c, f.targetId).availableQuestionCount).toBe(2);
    const s = startSession(f.c, { setId: f.targetId }, randomUUID()).session;
    expect(s.items).toHaveLength(2);
    expect(JSON.stringify(s)).not.toContain('answerIds');
    const item = s.items[0]!;
    expect(JSON.stringify(getStudyItem(f.c, s.id, item.id))).not.toContain(
      'answerIds',
    );
    answerStudyItem(f.c, s.id, item.id, { selectedIds: ['a'] });
    expect(resumeSession(f.c, s.id).id).toBe(s.id);
    expect(
      f.c.client.prepare('select * from question_versions order by id').all(),
    ).toEqual(rows);
  } finally {
    f.close();
  }
});

it('rejects nonmembers, material mismatches, invalid ancestry and failed generated runs, while preserving immutable shared/parent contents', async () => {
  const f = await revisionFixture();
  try {
    const c = f.c.client;
    const detail = getSet(f.c, f.targetId);
    const edit = (setId: number, id: number) => {
      const v = getSet(f.c, setId).candidates.find((v) => v.id === id)!;
      return updateVersionContent(f.c, setId, id, {
        expectedRevision: 0,
        expectedFingerprint: v.fingerprint,
        body: 'changed',
        choices: v.choices,
        answerIds: v.answerIds,
        explanation: v.explanation,
        quote: v.quote,
      });
    };
    for (const [setId, id] of [[f.run.setId, f.parentId]]) {
      const v = getSet(f.c, setId!).candidates.find((v) => v.id === id)!;
      expect(() =>
        confirmVersion(f.c, setId!, id!, {
          fingerprint: v.fingerprint,
          confirmed: true,
          acknowledgeQuoteMismatch: false,
        }),
      ).toThrow('conflict');
    }
    const before = c
      .prepare('select * from question_versions order by id')
      .all();
    const assertCopy = (setId: number, id: number) => {
      c.exec('savepoint test_copy');
      try {
        const result = edit(setId, id);
        expect(result.id).not.toBe(id);
        expect(
          c
            .prepare(
              'select * from question_versions where id <= ? order by id',
            )
            .all(f.derivedId),
        ).toEqual(before);
      } finally {
        c.exec('rollback to test_copy; release test_copy');
      }
    };
    assertCopy(f.run.setId, f.sharedId);
    assertCopy(f.targetId, f.sharedId);
    assertCopy(f.run.setId, f.parentId);
    c.prepare(
      'delete from set_candidates where set_id=? and question_version_id=?',
    ).run(f.targetId, f.sharedId);
    // Removing sharing never makes a parent mutable.
    assertCopy(f.run.setId, f.parentId);
    expect(() =>
      replaceItems(f.c, f.targetId, {
        expectedRevision: 0,
        versionIds: [f.sharedId],
      }),
    ).toThrow('missing');
    expect(() =>
      confirmVersion(f.c, f.targetId, f.sharedId, {
        fingerprint: detail.candidates[0]!.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: false,
      }),
    ).toThrow('missing');
    expect(
      c.prepare('select * from question_versions order by id').all(),
    ).toEqual(before);
    const other = await f.generate();
    c.exec(
      "insert into sources(title,body,created_by,created_at) values('other','other',1,1)",
    );
    c.prepare('update question_sets set source_id=2 where id=?').run(
      other.setId,
    );
    expect(() => getSet(f.c, other.setId)).toThrow('conflict');
    expect(() =>
      replaceItems(f.c, other.setId, {
        expectedRevision: 0,
        versionIds: [getSet(f.c, f.run.setId).candidates[0]!.id],
      }),
    ).toThrow('missing');
    c.prepare(
      'update question_versions set derived_from_version_id=? where id=?',
    ).run(f.sharedId, f.derivedId);
    expect(() => getSet(f.c, f.targetId)).toThrow('conflict');
    c.prepare(
      'update question_versions set derived_from_version_id=? where id=?',
    ).run(f.parentId, f.derivedId);
    c.prepare("update generation_runs set status='failed' where id=?").run(
      f.run.id,
    );
    expect(() =>
      replaceItems(f.c, f.run.setId, {
        expectedRevision: 0,
        versionIds: [f.sharedId],
      }),
    ).toThrow('conflict');
    const v = getSet(f.c, f.run.setId).candidates.find(
      (v) => v.id === f.sharedId,
    )!;
    expect(() =>
      confirmVersion(f.c, f.run.setId, f.sharedId, {
        fingerprint: v.fingerprint,
        confirmed: true,
        acknowledgeQuoteMismatch: false,
      }),
    ).toThrow('conflict');
  } finally {
    f.close();
  }
});
