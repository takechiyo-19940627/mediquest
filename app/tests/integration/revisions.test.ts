import { publishedSourceFixture } from '../fixtures/published-revision';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { publicationFixture } from '../fixtures/publication';
import { createRevision } from '../../server/services/revisions/service';
import {
  getSet,
  updateVersionContent,
  confirmVersion,
} from '../../server/services/review/service';
import {
  publishSet,
  replaceItems,
  archiveSet,
} from '../../server/services/publication/service';

const request = (revision: number) => ({
  requestKey: randomUUID(),
  expectedRevision: revision,
  title: ' revision ',
  description: ' description ',
});
function snapshot(f: Awaited<ReturnType<typeof publicationFixture>>) {
  return [
    'sources',
    'questions',
    'question_sets',
    'set_candidates',
    'set_items',
    'set_revision_requests',
    'question_versions',
    'generation_runs',
  ].map((table) =>
    f.c.client.prepare(`select * from ${table} order by id`).all(),
  );
}
it('copies only adopted versions in order, replays before source-state checks, separates edits and publishes the revision atomically', async () => {
  const f = await publishedSourceFixture();
  try {
    const source = f.detail();
    const input = request(source.revision);
    const created = createRevision(f.c, source.id, input);
    expect(created).toMatchObject({
      status: 'draft',
      revision: 0,
      supersedesSetId: source.id,
      supersedesRevision: source.revision,
      replayed: false,
    });
    expect(Object.keys(created).sort()).toEqual(
      [
        'id',
        'status',
        'revision',
        'sourceId',
        'supersedesSetId',
        'supersedesRevision',
        'replayed',
      ].sort(),
    );
    const draft = getSet(f.c, created.id);
    expect(draft.items.map((i) => i.versionId)).toEqual([f.ids[1], f.ids[0]]);
    expect(draft.candidates).toHaveLength(2);
    const v = draft.candidates[0]!;
    const edit = {
      expectedRevision: 0,
      expectedFingerprint: v.fingerprint,
      body: 'changed',
      choices: v.choices,
      answerIds: v.answerIds,
      explanation: v.explanation,
      quote: 'missing quote',
    };
    const old = f.c.client
      .prepare('select * from question_versions where id=?')
      .get(v.id);
    for (const stage of [
      'before delete on set_items',
      'before insert on set_items',
    ]) {
      const before = snapshot(f);
      f.c.client.exec(
        `create trigger fail_exchange ${stage} begin select raise(abort,'PRIVATE_SQL'); end`,
      );
      try {
        expect(() => updateVersionContent(f.c, draft.id, v.id, edit)).toThrow();
        expect(snapshot(f)).toEqual(before);
      } finally {
        f.c.client.exec('drop trigger fail_exchange');
      }
    }
    const result = updateVersionContent(f.c, draft.id, v.id, edit);
    expect(result).toMatchObject({
      versionNo: 2,
      reviewedBy: null,
      revision: 1,
      quoteVerified: false,
    });
    expect(result.id).not.toBe(v.id);
    expect(
      f.c.client
        .prepare('select * from question_versions where id=?')
        .get(v.id),
    ).toEqual(old);
    expect(
      getSet(f.c, draft.id).items.find((i) => i.versionId === result.id)
        ?.position,
    ).toBe(draft.items.find((i) => i.versionId === v.id)!.position);
    expect(() => updateVersionContent(f.c, draft.id, v.id, edit)).toThrow(
      'conflict',
    );
    const confirm = {
      fingerprint: result.fingerprint,
      confirmed: true,
      acknowledgeQuoteMismatch: false,
    };
    expect(() => confirmVersion(f.c, draft.id, result.id, confirm)).toThrow(
      'conflict',
    );
    confirmVersion(f.c, draft.id, result.id, {
      ...confirm,
      acknowledgeQuoteMismatch: true,
    });
    replaceItems(f.c, draft.id, {
      expectedRevision: 1,
      versionIds: [result.id],
    });
    const ready = getSet(f.c, draft.id);
    expect(
      publishSet(f.c, draft.id, {
        expectedRevision: ready.revision,
        publishFingerprint: ready.publishFingerprint,
        confirmed: true,
      }),
    ).toMatchObject({ status: 'published', revision: ready.revision + 1 });
    expect(f.detail()).toMatchObject({
      status: 'archived',
      revision: source.revision + 1,
    });
    archiveSet(f.c, source.id, {});
    expect(createRevision(f.c, source.id, input)).toMatchObject({
      id: draft.id,
      replayed: true,
    });
    expect(() =>
      createRevision(f.c, source.id, { ...input, title: 'different' }),
    ).toThrow('conflict');
    expect(() =>
      createRevision(f.c, source.id, request(f.detail().revision)),
    ).toThrow(expect.objectContaining({ successorId: draft.id }));
    expect(
      createRevision(f.c, draft.id, request(getSet(f.c, draft.id).revision))
        .status,
    ).toBe('draft');
  } finally {
    f.close();
  }
});
it('rolls back every creation stage and rejects stale, empty, misordered and already superseded sources', async () => {
  const f = await publishedSourceFixture();
  try {
    const input = request(f.detail().revision);
    for (const table of [
      'question_sets',
      'set_candidates',
      'set_items',
      'set_revision_requests',
    ]) {
      const before = snapshot(f);
      f.c.client.exec(
        `create trigger fail_revision before insert on ${table} begin select raise(abort,'PRIVATE_SQL'); end`,
      );
      expect(() => createRevision(f.c, f.run.setId, input)).toThrow();
      expect(snapshot(f)).toEqual(before);
      f.c.client.exec('drop trigger fail_revision');
    }
    expect(() => createRevision(f.c, 99999, input)).toThrow('missing');
    expect(() =>
      createRevision(f.c, f.run.setId, { ...input, expectedRevision: 0 }),
    ).toThrow('conflict');
    for (const sql of [
      `delete from set_items where set_id=${f.run.setId}`,
      `update set_items set position=position+2 where set_id=${f.run.setId}`,
    ]) {
      f.c.client.exec('savepoint corrupt');
      f.c.client.exec(sql);
      expect(() => createRevision(f.c, f.run.setId, input)).toThrow('conflict');
      f.c.client.exec('rollback to corrupt; release corrupt');
    }
    const successor = createRevision(f.c, f.run.setId, input);
    f.c.client
      .prepare(
        "update question_sets set status='archived',published_at=1,published_by=1 where id=?",
      )
      .run(successor.id);
    expect(() =>
      createRevision(f.c, f.run.setId, request(input.expectedRevision)),
    ).toThrow(expect.objectContaining({ successorId: successor.id }));
    expect(createRevision(f.c, f.run.setId, input).replayed).toBe(true);
  } finally {
    f.close();
  }
});

it('copies stopped and invalidated adopted versions unchanged and isolates receipt keys by administrator', async () => {
  const f = await publishedSourceFixture();
  try {
    const c = f.c.client;
    c.prepare(
      "update questions set status='stopped' where id=(select question_id from question_versions where id=?)",
    ).run(f.ids[0]);
    c.prepare(
      "update question_versions set invalidated_at=1,invalidated_by=1,invalidation_reason='reason' where id=?",
    ).run(f.ids[1]);
    const oldVersions = c
      .prepare('select * from question_versions order by id')
      .all();
    const oldSource = c
      .prepare('select * from question_sets where id=?')
      .get(f.run.setId);
    const input = request(f.detail().revision);
    c.exec(
      "insert into users(id,display_name,role,created_at) values(2,'second','admin',1)",
    );
    c.prepare(
      'insert into set_revision_requests(requested_by,request_key,source_set_id,source_revision,request_fingerprint,created_set_id,created_at) values(2,?,?,?,?,?,1)',
    ).run(
      input.requestKey,
      f.run.setId,
      input.expectedRevision,
      'other-user-fingerprint',
      f.run.setId,
    );
    const created = createRevision(f.c, f.run.setId, input);
    expect(created.replayed).toBe(false);
    expect(getSet(f.c, created.id).candidates).toHaveLength(2);
    expect(
      c.prepare('select * from question_versions order by id').all(),
    ).toEqual(oldVersions);
    expect(
      c.prepare('select * from question_sets where id=?').get(f.run.setId),
    ).toEqual(oldSource);
    const d = getSet(f.c, created.id);
    const stopped = d.candidates.find((v) => v.id === f.ids[0])!;
    expect(() =>
      updateVersionContent(f.c, d.id, stopped.id, {
        expectedRevision: 0,
        expectedFingerprint: stopped.fingerprint,
        body: 'changed',
        choices: stopped.choices,
        answerIds: stopped.answerIds,
        explanation: stopped.explanation,
        quote: stopped.quote,
      }),
    ).toThrow('conflict');
  } finally {
    f.close();
  }
});

it('rejects foreign-source, duplicate-question, noncandidate and oversized selections without writes', async () => {
  const f = await publishedSourceFixture();
  try {
    const c = f.c.client;
    // Build more than ten distinct, otherwise valid candidates from the same source.
    const extra: number[] = [];
    for (let i = 0; i < 3; i++) {
      const run = await f.generate();
      extra.push(...getSet(f.c, run.setId).candidates.map((v) => v.id));
    }
    const input = request(f.detail().revision);
    // Deliberately corrupt historical fixtures with FK enforcement disabled;
    // the service must detect these inconsistencies without repairing them.
    const cases = [
      () => {
        c.exec(
          "insert into sources(title,body,created_by,created_at) values('other','other',1,1)",
        );
        c.prepare(
          'update questions set source_id=(select max(id) from sources) where id=(select question_id from question_versions where id=?)',
        ).run(f.ids[0]);
      },
      () => {
        c.prepare(
          'update question_versions set question_id=(select question_id from question_versions where id=?),version_no=100 where id=?',
        ).run(f.ids[0], f.ids[1]);
      },
      () => {
        c.prepare(
          'delete from set_candidates where set_id=? and question_version_id=?',
        ).run(f.run.setId, f.ids[0]);
      },
      () => {
        for (const [index, id] of extra.entries()) {
          c.prepare(
            'insert into set_candidates(set_id,question_id,question_version_id) select ?,question_id,id from question_versions where id=?',
          ).run(f.run.setId, id);
          c.prepare(
            'insert into set_items(set_id,question_version_id,position) values(?,?,?)',
          ).run(f.run.setId, id, index + 2);
        }
      },
    ];
    for (const corrupt of cases) {
      c.pragma('foreign_keys = OFF');
      // Savepoints permit restoring even deliberately inconsistent old rows.
      c.exec('savepoint corrupt');
      corrupt();
      const before = snapshot(f);
      try {
        expect(() => createRevision(f.c, f.run.setId, input)).toThrow(
          'conflict',
        );
        expect(snapshot(f)).toEqual(before);
      } finally {
        c.exec('rollback to corrupt; release corrupt');
        c.pragma('foreign_keys = ON');
      }
    }
  } finally {
    f.close();
  }
});
