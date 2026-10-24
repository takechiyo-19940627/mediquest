import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { catalogFixture } from '../fixtures/catalog';
import {
  startSession,
  answerStudyItem,
  getStudyItem,
  getSession,
  resumeSession,
} from '../../server/services/study/service';
const cleanups: (() => void)[] = [];
afterEach(() => {
  const errors: unknown[] = [];
  for (const fn of cleanups.splice(0))
    try {
      fn();
    } catch (e) {
      errors.push(e);
    }
  if (errors.length) throw new AggregateError(errors);
});
async function fixture() {
  const f = await catalogFixture();
  cleanups.push(f.close);
  return {
    ...f,
    session: startSession(f.c, { setId: f.run.setId }, randomUUID()).session,
  };
}
it('records once, advances fixed order and completes with stable timestamps and exact ratios', async () => {
  const f = await fixture();
  const [a, b] = f.session.items;
  const first = answerStudyItem(f.c, f.session.id, a!.id, {
    selectedIds: ['SECRET_ANSWER'],
  });
  expect(first.session).toMatchObject({
    currentItemId: b!.id,
    status: 'in_progress',
    statistics: { accuracy: 0.5, answeredEligibleCount: 1 },
  });
  expect(first.item).toMatchObject({
    feedback: {
      isCorrect: true,
      selectedIds: ['SECRET_ANSWER'],
      answerIds: ['SECRET_ANSWER'],
      explanation: 'SECRET_EXPLANATION',
      quote: 'SECRET_QUOTE',
    },
  });
  expect(
    answerStudyItem(f.c, f.session.id, a!.id, {
      selectedIds: ['SECRET_ANSWER'],
    }),
  ).toEqual({ ...first, replayed: true });
  expect(() =>
    answerStudyItem(f.c, f.session.id, a!.id, { selectedIds: ['b'] }),
  ).toThrow('conflict');
  const final = answerStudyItem(f.c, f.session.id, b!.id, {
    selectedIds: ['b'],
  });
  expect(final.session).toMatchObject({
    status: 'completed',
    currentItemId: null,
    statistics: { eligibleCount: 2, correctEligibleCount: 1, accuracy: 0.5 },
  });
  expect(final.session.completedAt).toEqual(expect.any(Number));
  expect(resumeSession(f.c, f.session.id).completedAt).toBe(
    final.session.completedAt,
  );
  expect(getStudyItem(f.c, f.session.id, a!.id)).toEqual(first.item);
});
it('allows archived sessions and saved feedback after ordinary stops without regrading', async () => {
  const f = await fixture();
  const a = f.session.items[0]!;
  f.c.client
    .prepare("update question_sets set status='archived' where id=?")
    .run(f.run.setId);
  const result = answerStudyItem(f.c, f.session.id, a.id, {
    selectedIds: ['b'],
  });
  f.c.client.exec("update questions set status='stopped'");
  expect(getStudyItem(f.c, f.session.id, a.id)).toEqual(result.item);
  const resumed = resumeSession(f.c, f.session.id);
  expect(resumed).toMatchObject({
    status: 'completed',
    statistics: {
      eligibleCount: 1,
      excludedCount: 1,
      answeredEligibleCount: 1,
      accuracy: 0,
    },
  });
  expect(
    answerStudyItem(f.c, f.session.id, a.id, { selectedIds: ['b'] }).item,
  ).toEqual(result.item);
});
it('rejects unanswered stopped items without saving exclusions and completes all-excluded only on resume', async () => {
  const f = await fixture();
  f.c.client.exec("update questions set status='stopped'");
  expect(() =>
    answerStudyItem(f.c, f.session.id, f.session.items[0]!.id, {
      selectedIds: ['SECRET_ANSWER'],
    }),
  ).toThrow('conflict');
  expect(
    f.c.client
      .prepare(
        'select count(*) n from study_items where excluded_at is not null or answered_at is not null',
      )
      .get(),
  ).toEqual({ n: 0 });
  expect(getSession(f.c, f.session.id)).toMatchObject({
    status: 'in_progress',
    statistics: { accuracy: null, accuracyStatus: 'no_eligible_items' },
  });
  const final = resumeSession(f.c, f.session.id);
  expect(final).toMatchObject({
    status: 'completed',
    statistics: {
      eligibleCount: 0,
      accuracy: null,
      accuracyStatus: 'no_eligible_items',
    },
  });
  expect(resumeSession(f.c, f.session.id)).toEqual(final);
  expect(() =>
    answerStudyItem(f.c, f.session.id, f.session.items[0]!.id, {
      selectedIds: ['b'],
    }),
  ).toThrow('conflict');
});
it('rolls back answer, exclusion and completion together on later update failure', async () => {
  const f = await fixture();
  const a = f.session.items[0]!;
  f.c.client
    .prepare("update questions set status='stopped' where id=?")
    .run(f.detail().candidates[1]!.questionId);
  for (const trigger of [
    "create trigger fail_answer_progress after update on study_items when new.position=1 begin select raise(abort,'PRIVATE_SQL'); end",
    "create trigger fail_answer_progress after update on study_sessions begin select raise(abort,'PRIVATE_SQL'); end",
  ]) {
    f.c.client.exec(trigger);
    expect(() =>
      answerStudyItem(f.c, f.session.id, a.id, {
        selectedIds: ['SECRET_ANSWER'],
      }),
    ).toThrow();
    expect(
      f.c.client
        .prepare(
          'select count(*) n from study_items where answered_at is not null or excluded_at is not null',
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(getSession(f.c, f.session.id)).toMatchObject({
      status: 'in_progress',
      completedAt: null,
    });
    f.c.client.exec('drop trigger fail_answer_progress');
  }
  expect(
    answerStudyItem(f.c, f.session.id, a.id, { selectedIds: ['SECRET_ANSWER'] })
      .session.status,
  ).toBe('completed');
});
it('treats reversed multi-answer order as replay and rejects cross-session ownership', async () => {
  const f = await fixture();
  f.c.client
    .prepare('update question_versions set answer_ids_json=? where id=?')
    .run('["SECRET_ANSWER","b"]', f.ids[0]);
  const a = f.session.items[0]!;
  const first = answerStudyItem(f.c, f.session.id, a.id, {
    selectedIds: ['b', 'SECRET_ANSWER'],
  });
  expect(first.item).toMatchObject({ feedback: { isCorrect: true } });
  expect(
    answerStudyItem(f.c, f.session.id, a.id, {
      selectedIds: ['SECRET_ANSWER', 'b'],
    }),
  ).toEqual({ ...first, replayed: true });
  const other = startSession(f.c, { setId: f.run.setId }, randomUUID()).session;
  expect(() =>
    answerStudyItem(f.c, f.session.id, other.items[0]!.id, {
      selectedIds: ['b'],
    }),
  ).toThrow('missing');
  f.c.client.exec(
    "insert into users(id,display_name,role,created_at) values(2,'他人','learner',1)",
  );
  f.c.client
    .prepare('update study_sessions set user_id=2 where id=?')
    .run(other.id);
  expect(() =>
    answerStudyItem(f.c, other.id, other.items[0]!.id, { selectedIds: ['b'] }),
  ).toThrow('missing');
});
