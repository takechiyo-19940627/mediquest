import { stopQuestion } from '../../server/services/questions/service';
import {
  startSession,
  answerStudyItem,
  getSession,
  startReviewSession,
} from '../../server/services/study/service';
import {
  createReport,
  resolveReport,
} from '../../server/services/reports/service';
import { publicationState } from '../../server/services/publication/state';
import { questionSets } from '../../server/db/schema';
import { randomUUID, createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { publishedSourceFixture } from '../fixtures/published-revision';
import { createRevision } from '../../server/services/revisions/service';
import {
  getSet,
  updateVersionContent,
  confirmVersion,
} from '../../server/services/review/service';
import {
  publishSet,
  archiveSet,
} from '../../server/services/publication/service';

type Fixture = Awaited<ReturnType<typeof publishedSourceFixture>>;
const draft = (f: Fixture, id = f.run.setId) =>
  createRevision(f.c, id, {
    requestKey: randomUUID(),
    expectedRevision: getSet(f.c, id).revision,
    title: 'revision',
    description: '',
  });
const request = (f: Fixture, id: number) => {
  const d = getSet(f.c, id);
  return {
    expectedRevision: d.revision,
    publishFingerprint: d.publishFingerprint,
    confirmed: true,
  };
};
const row = (f: Fixture, id: number) =>
  f.c.client.prepare('select * from question_sets where id=?').get(id);
function snapshot(f: Fixture) {
  return (
    f.c.client
      .prepare(
        "select name from sqlite_master where type='table' order by name",
      )
      .all() as { name: string }[]
  ).map(({ name }) => [
    name,
    f.c.client.prepare('select * from "' + name + '" order by rowid').all(),
  ]);
}

it('atomically publishes, preserves unrelated history, and replays current state across archive and generations', async () => {
  const f = await publishedSourceFixture();
  try {
    const a = draft(f),
      sibling = draft(f);
    const source = row(f, f.run.setId) as Record<string, unknown>;
    const input = request(f, a.id);
    const before = snapshot(f).filter(([name]) => name !== 'question_sets');
    const first = publishSet(f.c, a.id, input);
    expect(first).toMatchObject({
      status: 'published',
      revision: 1,
      replayed: false,
      publishedBy: 1,
    });
    expect(row(f, f.run.setId)).toEqual({
      ...source,
      status: 'archived',
      revision: Number(source.revision) + 1,
    });
    expect(snapshot(f).filter(([name]) => name !== 'question_sets')).toEqual(
      before,
    );
    expect(publishSet(f.c, a.id, input)).toEqual({ ...first, replayed: true });
    expect(() => publishSet(f.c, sibling.id, request(f, sibling.id))).toThrow(
      'conflict',
    );
    archiveSet(f.c, a.id, {});
    expect(publishSet(f.c, a.id, input)).toMatchObject({
      status: 'archived',
      revision: 2,
      replayed: true,
    });
    expect(() => publishSet(f.c, sibling.id, request(f, sibling.id))).toThrow(
      'conflict',
    );
    const b = draft(f, a.id);
    const archived = row(f, a.id);
    publishSet(f.c, b.id, request(f, b.id));
    expect(row(f, a.id)).toEqual(archived);
    f.c.client.exec(
      "update questions set status='stopped'; update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='after publication'",
    );
    const saved = snapshot(f);
    expect(publishSet(f.c, a.id, input)).toMatchObject({
      status: 'archived',
      replayed: true,
    });
    expect(() =>
      publishSet(f.c, a.id, { ...input, expectedRevision: 1 }),
    ).toThrow('conflict');
    expect(() =>
      publishSet(f.c, a.id, { ...input, publishFingerprint: '0'.repeat(64) }),
    ).toThrow('conflict');
    expect(snapshot(f)).toEqual(saved);
  } finally {
    f.close();
  }
});

it('retains the ordinary fingerprint and fingerprints every revision candidate in stable order', async () => {
  const f = await publishedSourceFixture();
  try {
    const d = f.detail();
    const legacy = createHash('sha256')
      .update(
        JSON.stringify([
          d.id,
          d.sourceId,
          d.revision,
          d.items.map((i) => [
            i.position,
            i.versionId,
            i.questionId,
            i.fingerprint,
            i.invalidatedAt,
            i.reviewedBy,
            i.reviewedAt,
            i.questionStatus,
            i.generationStatus,
          ]),
        ]),
      )
      .digest('hex');
    expect(d.publishFingerprint).toBe(legacy);
    const a = draft(f);
    const original = request(f, a.id);
    f.c.client
      .prepare(
        'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
      )
      .run(a.id, f.ids[2]);
    const expanded = request(f, a.id);
    expect(expanded.publishFingerprint).not.toBe(original.publishFingerprint);
    const candidates = f.c.client
      .prepare(
        'select * from set_candidates where set_id=? order by question_id desc',
      )
      .all(a.id) as { question_id: number; question_version_id: number }[];
    f.c.client.pragma('foreign_keys=OFF');
    f.c.client.prepare('delete from set_candidates where set_id=?').run(a.id);
    for (const c of candidates)
      f.c.client
        .prepare(
          'insert into set_candidates(set_id,question_id,question_version_id) values(?,?,?)',
        )
        .run(a.id, c.question_id, c.question_version_id);
    f.c.client.pragma('foreign_keys=ON');
    expect(request(f, a.id)).toEqual(expanded);
    for (const sql of [
      "update question_versions set body='changed' where id=" + f.ids[2],
      'update question_versions set reviewed_at=reviewed_at+1 where id=' +
        f.ids[2],
      'update question_versions set generation_run_id=null,derived_from_version_id=' +
        f.ids[0] +
        ' where id=' +
        f.ids[2],
      'update question_sets set supersedes_set_id=id where id=' + a.id,
      "update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='candidate' where id=" +
        f.ids[2],
      "update questions set status='stopped' where id=(select question_id from question_versions where id=" +
        f.ids[2] +
        ')',
      'update question_sets set supersedes_revision=supersedes_revision+1 where id=' +
        a.id,
    ]) {
      f.c.client.exec('savepoint change');
      f.c.client.exec(sql);
      const set = f.c.db
        .select()
        .from(questionSets)
        .all()
        .find((s) => s.id === a.id)!;
      expect(publicationState(f.c.db, set).publishFingerprint).not.toBe(
        expanded.publishFingerprint,
      );
      expect(() => publishSet(f.c, a.id, expanded)).toThrow('conflict');
      f.c.client.exec('rollback to change; release change');
    }
    // Unadopted invalid candidates remain present and do not prevent publication.
    f.c.client
      .prepare(
        'update question_versions set reviewed_by=null,reviewed_at=null where id=?',
      )
      .run(f.ids[2]);
    expect(publishSet(f.c, a.id, request(f, a.id)).status).toBe('published');
  } finally {
    f.close();
  }
});

it('rejects corrupt links, stale sources, invalid selections and revision overflow without writes', async () => {
  const f = await publishedSourceFixture();
  try {
    const a = draft(f);
    const input = request(f, a.id);
    const c = f.c.client;
    c.pragma('foreign_keys=OFF');
    for (const sql of [
      `update question_sets set supersedes_set_id=id where id=${a.id}`,
      `update question_sets set supersedes_set_id=99999 where id=${a.id}`,
      `update question_sets set supersedes_set_id=0 where id=${a.id}`,
      `update question_sets set supersedes_set_id=9007199254740992 where id=${a.id}`,
      `update question_sets set supersedes_revision=-1 where id=${a.id}`,
      `update question_sets set supersedes_revision=9007199254740992 where id=${a.id}`,
      `update question_sets set supersedes_set_id=99999,supersedes_revision=0 where id=${f.run.setId}`,
      `update question_sets set supersedes_set_id=${a.id},supersedes_revision=0 where id=${f.run.setId}`,
      `update question_sets set source_id=999 where id=${f.run.setId}`,
      `update question_sets set published_by=null where id=${f.run.setId}`,
      `update question_sets set published_at=null where id=${f.run.setId}`,
      `update question_sets set status='draft' where id=${f.run.setId}`,
      `update question_sets set revision=revision+1 where id=${f.run.setId}`,
      `update question_sets set revision=9007199254740991 where id=${a.id}`,
      `update question_sets set revision=9007199254740991 where id=${f.run.setId}; update question_sets set supersedes_revision=9007199254740991 where id=${a.id}`,
      `update question_sets set publish_request_revision=0,publish_request_fingerprint='${input.publishFingerprint}' where id=${a.id}; delete from set_items where set_id=${a.id}`,
      `delete from set_items where set_id=${a.id}`,
      `update set_items set position=position+3 where set_id=${a.id}`,
      `delete from set_candidates where set_id=${a.id}`,
      `update question_versions set reviewed_at=null where id=${f.ids[0]}`,
      `update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='reason' where id=${f.ids[0]}`,
      `update questions set status='stopped'`,
      `update generation_runs set status='failed'`,
    ]) {
      c.exec('savepoint corrupt');
      c.exec(sql);
      const before = snapshot(f);
      expect(
        () =>
          publishSet(
            f.c,
            a.id,
            sql.includes('9007199254740991') ? request(f, a.id) : input,
          ),
        sql,
      ).toThrow('conflict');
      expect(snapshot(f)).toEqual(before);
      c.exec('rollback to corrupt; release corrupt');
    }
    c.pragma('foreign_keys=ON');
    archiveSet(f.c, f.run.setId, {});
    expect(() => publishSet(f.c, a.id, input)).toThrow('conflict');
  } finally {
    f.close();
  }
});

it('rolls back new publication, source archive and successor constraint failures and permits retry', async () => {
  for (const stage of ['new', 'old', 'unique']) {
    const f = await publishedSourceFixture();
    try {
      const a = draft(f),
        sibling = draft(f);
      const input = request(f, a.id);
      const before = snapshot(f);
      const trigger =
        stage === 'unique'
          ? `create trigger fail_publish before update of status on question_sets when new.id=${a.id} and new.status='published' begin update question_sets set published_at=1,published_by=1 where id=${sibling.id}; end`
          : `create trigger fail_publish before update of status on question_sets when new.id=${stage === 'new' ? a.id : f.run.setId} begin select raise(abort,'PRIVATE_SQL'); end`;
      f.c.client.exec(trigger);
      if (stage === 'unique')
        expect(() => publishSet(f.c, a.id, input)).toThrow('conflict');
      else expect(() => publishSet(f.c, a.id, input)).toThrow('PRIVATE_SQL');
      expect(snapshot(f)).toEqual(before);
      f.c.client.exec('drop trigger fail_publish');
      expect(publishSet(f.c, a.id, input).replayed).toBe(false);
      expect(publishSet(f.c, a.id, input).replayed).toBe(true);
    } finally {
      f.close();
    }
  }
});

for (const operation of [
  'archive',
  'start',
  'stop',
  'invalidate',
  'edit',
] as const) {
  for (const order of ['before', 'after'] as const) {
    it(`serializes ${operation} ${order} publication and keeps saved answers`, async () => {
      const f = await publishedSourceFixture();
      try {
        const started = startSession(
          f.c,
          { setId: f.run.setId },
          randomUUID(),
        ).session;
        for (const item of started.items)
          answerStudyItem(f.c, started.id, item.id, { selectedIds: ['b'] });
        const reviewKey = randomUUID();
        const review = startReviewSession(
          f.c,
          started.id,
          {},
          reviewKey,
        ).session;
        const saved = getSession(f.c, started.id);
        const a = draft(f),
          d = getSet(f.c, a.id),
          v = d.candidates[0]!;
        const body = request(f, a.id);
        const oldRevision = f.detail().revision;
        const mutate = () => {
          if (operation === 'archive') return archiveSet(f.c, f.run.setId, {});
          if (operation === 'start')
            return startSession(f.c, { setId: f.run.setId }, randomUUID());
          if (operation === 'stop') return stopQuestion(f.c, v.questionId, {});
          if (operation === 'invalidate') {
            const report = createReport(
              f.c,
              started.id,
              started.items.find((i) => i.position === 1)!.id,
              { message: 'report' },
            );
            return resolveReport(f.c, report.id, {
              decision: 'confirmed',
              note: 'invalid',
            });
          }
          return updateVersionContent(f.c, a.id, v.id, {
            expectedRevision: d.revision,
            expectedFingerprint: v.fingerprint,
            body: 'edited',
            choices: v.choices,
            answerIds: v.answerIds,
            explanation: v.explanation,
            quote: v.quote,
          });
        };
        if (order === 'before') {
          mutate();
          if (operation === 'start')
            expect(publishSet(f.c, a.id, body).status).toBe('published');
          else expect(() => publishSet(f.c, a.id, body)).toThrow('conflict');
        } else {
          expect(publishSet(f.c, a.id, body).status).toBe('published');
          if (operation === 'start') expect(mutate).toThrow('missing');
          else if (operation === 'edit') expect(mutate).toThrow('conflict');
          else mutate();
        }
        const published = getSet(f.c, a.id).status === 'published';
        expect(f.detail().revision).toBe(
          oldRevision + (published || operation === 'archive' ? 1 : 0),
        );
        if (operation !== 'invalidate')
          expect(getSession(f.c, started.id)).toEqual(saved);
        if (published) {
          expect(() =>
            startReviewSession(f.c, started.id, {}, randomUUID()),
          ).toThrow('conflict');
          expect(
            startReviewSession(f.c, started.id, {}, reviewKey).session.id,
          ).toBe(review.id);
          expect(() =>
            startSession(f.c, { setId: f.run.setId }, randomUUID()),
          ).toThrow('missing');
        }
      } finally {
        f.close();
      }
    });
  }
}

it('publishes a reviewed COW replacement of an invalid old version without changing the old history', async () => {
  const f = await publishedSourceFixture();
  try {
    const a = draft(f),
      d = getSet(f.c, a.id),
      v = d.candidates[0]!;
    const edited = updateVersionContent(f.c, a.id, v.id, {
      expectedRevision: d.revision,
      expectedFingerprint: v.fingerprint,
      body: 'replacement',
      choices: v.choices,
      answerIds: v.answerIds,
      explanation: v.explanation,
      quote: v.quote,
    });
    f.c.client
      .prepare(
        "update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='old only' where id=?",
      )
      .run(v.id);
    const old = f.c.client
      .prepare('select * from question_versions where id=?')
      .get(v.id);
    confirmVersion(f.c, a.id, edited.id, {
      fingerprint: edited.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: true,
    });
    expect(publishSet(f.c, a.id, request(f, a.id)).status).toBe('published');
    expect(
      f.c.client
        .prepare('select * from question_versions where id=?')
        .get(v.id),
    ).toEqual(old);
  } finally {
    f.close();
  }
});
