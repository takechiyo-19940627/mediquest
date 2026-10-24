import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import {
  startSession,
  getSession,
  getStudyItem,
  resumeSession,
} from '../../server/services/study/service';
import { openDatabase } from '../../server/db/connection';
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
it('persists fixed ids/order across connections and replays before rechecking archive status', async () => {
  const f = await fixture();
  const key = randomUUID();
  const initial = startSession(f.c, { setId: f.run.setId }, key);
  expect(initial.session.items.map((i) => i.position)).toEqual([0, 1]);
  expect(initial.session.currentItemId).toBe(initial.session.items[0]!.id);
  const other = openDatabase({ MEDIQUEST_DB_PATH: f.database });
  try {
    expect(getSession(other, initial.session.id)).toEqual(initial.session);
  } finally {
    other.close();
  }
  expect(startSession(f.c, { setId: f.run.setId }, key)).toEqual({
    ...initial,
    replayed: true,
  });
  expect(() => startSession(f.c, { setId: f.draftId }, key)).toThrow(
    'conflict',
  );
  const second = startSession(f.c, { setId: f.run.setId }, randomUUID());
  expect(second.session.id).not.toBe(initial.session.id);
  f.c.client
    .prepare("update question_sets set status='archived' where id=?")
    .run(f.run.setId);
  expect(getSession(f.c, initial.session.id)).toEqual(initial.session);
  expect(startSession(f.c, { setId: f.run.setId }, key).replayed).toBe(true);
  expect(() => startSession(f.c, { setId: f.run.setId }, randomUUID())).toThrow(
    'missing',
  );
  expect(
    f.c.client
      .prepare(
        'select selected_ids_json,is_correct,answered_at from study_items limit 1',
      )
      .get(),
  ).toEqual({ selected_ids_json: null, is_correct: null, answered_at: null });
});
it('projects stopped without writes then explicitly persists exclusions once, including all-excluded sessions', async () => {
  const f = await fixture();
  const { session } = startSession(f.c, { setId: f.run.setId }, randomUUID());
  const item = session.items[0]!;
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[0]!.questionId);
  const before = f.c.client.prepare('select * from study_items').all();
  expect(getSession(f.c, session.id).currentItemId).toBe(session.items[1]!.id);
  expect(getStudyItem(f.c, session.id, item.id)).toEqual({
    id: item.id,
    position: 0,
    state: 'excluded',
  });
  expect(f.c.client.prepare('select * from study_items').all()).toEqual(before);
  resumeSession(f.c, session.id);
  const saved = f.c.client
    .prepare('select excluded_reason,excluded_at from study_items where id=?')
    .get(item.id);
  resumeSession(f.c, session.id);
  expect(
    f.c.client
      .prepare('select excluded_reason,excluded_at from study_items where id=?')
      .get(item.id),
  ).toEqual(saved);
  f.c.client.exec("update questions set status='active'");
  expect(getStudyItem(f.c, session.id, item.id)).toMatchObject({
    state: 'excluded',
  });
  f.c.client.exec("update questions set status='stopped'");
  expect(resumeSession(f.c, session.id)).toMatchObject({
    status: 'completed',
    completedAt: expect.any(Number),
    currentItemId: null,
  });
  expect(
    f.c.client.prepare('select count(*) n from study_items').get(),
  ).toEqual({ n: 2 });
});
it('denies other ownership and cross-session item access and never exposes grading data', async () => {
  const f = await fixture();
  const a = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  const b = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  expect(() => getStudyItem(f.c, a.id, b.items[0]!.id)).toThrow('missing');
  const dto = getStudyItem(f.c, a.id, a.items[0]!.id);
  expect(Object.keys(dto).sort()).toEqual(
    ['id', 'position', 'body', 'choices', 'requiredSelectionCount'].sort(),
  );
  expect(dto).toMatchObject({ requiredSelectionCount: 1 });
  f.c.client.exec(
    "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
  );
  f.c.client
    .prepare('update study_sessions set user_id=2 where id=?')
    .run(b.id);
  for (const action of [
    () => getSession(f.c, b.id),
    () => getStudyItem(f.c, b.id, b.items[0]!.id),
    () => resumeSession(f.c, b.id),
  ])
    expect(action).toThrow('missing');
});
it('rolls back partial creation, rejects invalid/empty sets, and enforces study constraints', async () => {
  const f = await fixture();
  expect(() => startSession(f.c, { setId: f.draftId }, randomUUID())).toThrow(
    'missing',
  );
  f.c.client.exec(
    "create trigger fail_study after insert on study_items when new.position=1 begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() =>
    startSession(f.c, { setId: f.run.setId }, randomUUID()),
  ).toThrow();
  expect(
    f.c.client.prepare('select count(*) n from study_sessions').get(),
  ).toEqual({ n: 0 });
  expect(
    f.c.client.prepare('select count(*) n from study_items').get(),
  ).toEqual({ n: 0 });
  f.c.client.exec('drop trigger fail_study');
  f.c.client.exec("update question_versions set answer_ids_json='[]'");
  expect(() => startSession(f.c, { setId: f.run.setId }, randomUUID())).toThrow(
    'conflict',
  );
  f.c.client.exec(
    'update question_versions set answer_ids_json=\'["SECRET_ANSWER"]\'',
  );
  f.c.client.exec("update questions set status='stopped'");
  expect(() => startSession(f.c, { setId: f.run.setId }, randomUUID())).toThrow(
    'conflict',
  );
  f.c.client.exec("update questions set status='active'");
  const s = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  for (const sql of [
    "update study_sessions set status='bad'",
    "update study_sessions set mode='review'",
    'update study_items set position=-1',
    'update study_items set is_correct=3',
    'update study_items set excluded_at=1',
    'update study_items set session_id=999999',
  ])
    expect(() => f.c.client.exec(sql)).toThrow();
  expect(() =>
    f.c.client
      .prepare(
        'insert into study_items(session_id,question_version_id,position) values(?,?,?)',
      )
      .run(s.id, f.ids[0], 2),
  ).toThrow();
});

it('rolls back resume updates together and never overwrites answered or already excluded history', async () => {
  const f = await fixture();
  const session = startSession(
    f.c,
    { setId: f.run.setId },
    randomUUID(),
  ).session;
  f.c.client.exec(
    "update questions set status='stopped'; create trigger fail_resume after update on study_items when new.position=1 begin select raise(abort,'PRIVATE_SQL'); end",
  );
  expect(() => resumeSession(f.c, session.id)).toThrow();
  expect(
    f.c.client
      .prepare(
        'select count(*) n from study_items where excluded_at is not null',
      )
      .get(),
  ).toEqual({ n: 0 });
  f.c.client.exec('drop trigger fail_resume');
  f.c.client
    .prepare('update study_items set answered_at=12 where id=?')
    .run(session.items[0]!.id);
  resumeSession(f.c, session.id);
  expect(
    f.c.client
      .prepare('select answered_at,excluded_at from study_items where id=?')
      .get(session.items[0]!.id),
  ).toEqual({ answered_at: 12, excluded_at: null });
  const excluded = f.c.client
    .prepare('select excluded_at from study_items where id=?')
    .get(session.items[1]!.id);
  resumeSession(f.c, session.id);
  expect(
    f.c.client
      .prepare('select excluded_at from study_items where id=?')
      .get(session.items[1]!.id),
  ).toEqual(excluded);
});
