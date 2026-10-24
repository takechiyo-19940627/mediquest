import { afterEach, expect, it } from 'vitest';
import { catalogFixture, privateMarkers } from '../fixtures/catalog';
import {
  getPublishedSet,
  listPublishedSets,
} from '../../server/services/learning-catalog/service';
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const close of cleanups.splice(0))
    try {
      close();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors);
});
async function fixture() {
  const f = await catalogFixture();
  cleanups.push(f.close);
  return f;
}
it('returns only explicit public metadata and excludes unpublished states and unselected candidates', async () => {
  const f = await fixture();
  const result = listPublishedSets(f.c, { limit: 20, before: undefined });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]!.availableQuestionCount).toBe(2);
  expect(Object.keys(result.items[0]!).sort()).toEqual(
    [
      'id',
      'title',
      'description',
      'publishedAt',
      'availableQuestionCount',
    ].sort(),
  );
  expect(Object.keys(getPublishedSet(f.c, f.run.setId)).sort()).toEqual(
    [
      'id',
      'title',
      'description',
      'publishedAt',
      'availableQuestionCount',
      'canStart',
    ].sort(),
  );
  for (const id of [f.draftId, f.archivedId, 999999])
    expect(() => getPublishedSet(f.c, id)).toThrow();
  for (const marker of privateMarkers)
    expect(JSON.stringify(result)).not.toContain(marker);
});
it('counts only active reviewed and source-consistent selected versions and preserves zero-count published sets', async () => {
  const f = await fixture();
  const count = () => getPublishedSet(f.c, f.run.setId).availableQuestionCount;
  const question = f.detail().candidates[0]!.questionId;
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(question);
  expect(count()).toBe(1);
  f.c.client
    .prepare("update questions set status='active' where id=?")
    .run(question);
  for (const column of ['reviewed_by', 'reviewed_at']) {
    const old = f.c.client
      .prepare(`select ${column} value from question_versions where id=?`)
      .get(f.ids[0]) as { value: number };
    f.c.client
      .prepare(`update question_versions set ${column}=null where id=?`)
      .run(f.ids[0]);
    expect(count()).toBe(1);
    f.c.client
      .prepare(`update question_versions set ${column}=? where id=?`)
      .run(old.value, f.ids[0]);
  }
  f.c.client.exec(
    "insert into sources(id,title,body,created_by,created_at) values(999,'別','別',1,1)",
  );
  f.c.client
    .prepare('update questions set source_id=999 where id=?')
    .run(question);
  expect(count()).toBe(1);
  f.c.client.exec("update questions set status='stopped'");
  expect(getPublishedSet(f.c, f.run.setId)).toMatchObject({
    availableQuestionCount: 0,
    canStart: false,
  });
  expect(
    listPublishedSets(f.c, { limit: 20, before: undefined }).items,
  ).toHaveLength(1);
});
it('pages stably by published time and id and suppresses incomplete publication records', async () => {
  const f = await fixture();
  f.c.client.exec(
    "update question_sets set status='published',published_at=100,published_by=1",
  );
  const first = listPublishedSets(f.c, { limit: 1, before: undefined });
  expect(first.items[0]!.id).toBe(f.archivedId);
  expect(first.nextCursor).toBe(`published:100:${f.archivedId}`);
  const next = listPublishedSets(f.c, {
    limit: 1,
    before: { publishedAt: 100, id: f.archivedId },
  });
  expect(next.items[0]!.id).toBe(f.draftId);
  f.c.client
    .prepare('update question_sets set published_by=null where id=?')
    .run(f.draftId);
  f.c.client
    .prepare('update question_sets set published_at=null where id=?')
    .run(f.archivedId);
  expect(
    listPublishedSets(f.c, { limit: 100, before: undefined }).items.map(
      (i) => i.id,
    ),
  ).toEqual([f.run.setId]);
  f.c.client.exec("update question_sets set status='archived'");
  expect(
    listPublishedSets(f.c, { limit: 100, before: undefined }).items,
  ).toEqual([]);
});
