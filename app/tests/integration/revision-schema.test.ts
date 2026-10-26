import { expect, it } from 'vitest';
import { revisionFixture } from '../fixtures/revision';

it('enforces candidate identity, selection membership, provenance, revision pairs and one historical successor', async () => {
  const f = await revisionFixture();
  const c = f.c.client;
  try {
    for (const sql of [
      'insert into set_candidates(set_id,question_id,question_version_id) values(999999,1,1)',
      `insert into set_candidates(set_id,question_id,question_version_id) values(${f.run.setId},999999,1)`,
      `insert into set_candidates(set_id,question_id,question_version_id) values(${f.run.setId},2,1)`,
      `insert into set_candidates(set_id,question_id,question_version_id) select ${f.run.setId},question_id,id from question_versions where id=${f.derivedId}`,
      `insert into set_items(set_id,question_version_id,position) values(${f.run.setId},${f.derivedId},0)`,
      `update question_versions set generation_run_id=null where id=${f.sharedId}`,
      `update question_versions set derived_from_version_id=${f.parentId} where id=${f.sharedId}`,
      `update question_versions set derived_from_version_id=999999 where id=${f.derivedId}`,
      `update question_sets set supersedes_set_id=${f.run.setId} where id=${f.targetId}`,
      `update question_sets set supersedes_revision=0 where id=${f.targetId}`,
      `update question_sets set supersedes_set_id=999999,supersedes_revision=0 where id=${f.targetId}`,
    ])
      expect(() => c.exec(sql), sql).toThrow();
    const sibling = await f.generate();
    c.prepare(
      'update question_sets set supersedes_set_id=?,supersedes_revision=0 where id in (?,?)',
    ).run(f.run.setId, f.targetId, sibling.setId);
    // Unpublished siblings coexist; archived successors still reserve the slot.
    c.prepare(
      "update question_sets set status='archived',published_at=10,published_by=1 where id=?",
    ).run(f.targetId);
    expect(() =>
      c
        .prepare('update question_sets set published_at=11 where id=?')
        .run(sibling.setId),
    ).toThrow();
    const insert = c.prepare(
      'insert into set_revision_requests(requested_by,request_key,source_set_id,source_revision,request_fingerprint,created_set_id,created_at) values(?,?,?,?,?,?,1)',
    );
    insert.run(1, 'key', f.run.setId, 0, 'hash', f.targetId);
    expect(() =>
      insert.run(1, 'key', f.run.setId, 0, 'hash', sibling.setId),
    ).toThrow();
    for (const row of [
      [999999, 'user', f.run.setId, 0, 'hash', f.targetId],
      [1, 'source', 999999, 0, 'hash', f.targetId],
      [1, 'created', f.run.setId, 0, 'hash', 999999],
    ])
      expect(() => insert.run(...row)).toThrow();
    for (const sql of [
      `delete from question_sets where id=${f.run.setId}`,
      `delete from question_versions where id=${f.parentId}`,
      'delete from users where id=1',
    ])
      expect(() => c.exec(sql)).toThrow();
    expect(c.pragma('foreign_key_check')).toEqual([]);
  } finally {
    f.close();
  }
});
