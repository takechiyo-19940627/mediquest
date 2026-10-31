import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { manualFixture } from '../fixtures/manual';
import { pastExamInputFixture } from '../fixtures/past-exams';
import {
  savePastExam,
  getPastExam,
  listPastExams,
} from '../../server/services/past-exams/service';
import {
  startSession,
  getStudyItem,
  answerStudyItem,
  startReviewSession,
} from '../../server/services/study/service';
import { createRevision } from '../../server/services/revisions/service';
import {
  archiveSet,
  replaceItems,
  publishSet,
} from '../../server/services/publication/service';
import {
  confirmVersion,
  updateVersionContent,
} from '../../server/services/review/service';
const tables = [
  'sources',
  'question_sets',
  'questions',
  'question_versions',
  'past_exams',
  'past_exam_questions',
  'past_exam_requests',
  'set_candidates',
  'set_items',
];
it('registers 100 confirmed questions without AI, quotes or explanations and grades fixed versions', () => {
  const f = manualFixture();
  try {
    const input = pastExamInputFixture(100);
    const key = randomUUID();
    const saved = savePastExam(f.c, input, key);
    expect(savePastExam(f.c, input, key.toUpperCase())).toEqual({
      ...saved,
      replayed: true,
    });
    expect(() => savePastExam(f.c, { ...input, year: '別' }, key)).toThrow(
      'conflict',
    );
    expect(getPastExam(f.c, saved.setId, true).questions).toHaveLength(100);
    expect(getPastExam(f.c, saved.setId)).toMatchObject({
      questionCount: 100,
      availableQuestionCount: 100,
      canStart: true,
    });
    expect(JSON.stringify(getPastExam(f.c, saved.setId))).not.toContain(
      'answerIds',
    );
    expect(
      f.c.client.prepare('select count(*) as n from generation_runs').get(),
    ).toEqual({ n: 0 });
    expect(
      f.c.client
        .prepare(
          'select quote,explanation,reviewed_by from question_versions limit 1',
        )
        .get(),
    ).toEqual({ quote: '', explanation: '', reviewed_by: 1 });
    const { session } = startSession(f.c, { setId: saved.setId }, randomUUID());
    expect(session.items).toHaveLength(100);
    const itemId = session.items[0]!.id;
    const unanswered = getStudyItem(f.c, session.id, itemId);
    expect(unanswered).toMatchObject({ questionNumber: '1' });
    expect(unanswered).not.toHaveProperty('feedback');
    expect(unanswered).not.toHaveProperty('answerIds');
    const answered = answerStudyItem(f.c, session.id, itemId, {
      selectedIds: ['a'],
    });
    expect(answered.item).toMatchObject({
      feedback: { isCorrect: true, explanation: '', quote: '' },
    });
  } finally {
    f.close();
  }
});
it('creates a new edition atomically, preserves saved answers and question numbers, rejects stale/legacy mutations', () => {
  const f = manualFixture();
  try {
    const input = pastExamInputFixture();
    const first = savePastExam(f.c, input, randomUUID());
    const { session } = startSession(f.c, { setId: first.setId }, randomUUID());
    answerStudyItem(f.c, session.id, session.items[0]!.id, {
      selectedIds: ['b'],
    });
    const history = getStudyItem(f.c, session.id, session.items[0]!.id);
    const review = startReviewSession(f.c, session.id, {}, randomUUID());
    expect(review.session.items).toHaveLength(1);
    const key = randomUUID();
    const revision = {
      ...input,
      revision: 0,
      questions: [
        {
          ...input.questions[0]!,
          questionNumber: '訂正1',
          answerIds: ['b'],
          body: '訂正本文',
        },
      ],
    };
    const second = savePastExam(f.c, revision, key, first.setId);
    expect(second.setId).not.toBe(first.setId);
    expect(savePastExam(f.c, revision, key, first.setId)).toEqual({
      ...second,
      replayed: true,
    });
    expect(() =>
      savePastExam(f.c, revision, randomUUID(), first.setId),
    ).toThrow('conflict');
    expect(getPastExam(f.c, first.setId, true)).toMatchObject({
      status: 'archived',
      revision: 1,
    });
    expect(listPastExams(f.c).items.map((i) => i.id)).toEqual([second.setId]);
    expect(getStudyItem(f.c, session.id, session.items[0]!.id)).toEqual(
      history,
    );
    const oldReview = startReviewSession(f.c, session.id, {}, randomUUID());
    expect(
      getStudyItem(f.c, oldReview.session.id, oldReview.session.items[0]!.id),
    ).toMatchObject({ questionNumber: '1', body: input.questions[0]!.body });
    expect(
      getStudyItem(f.c, review.session.id, review.session.items[0]!.id),
    ).toMatchObject({ questionNumber: '1', body: input.questions[0]!.body });
    expect(() =>
      startSession(f.c, { setId: first.setId }, randomUUID()),
    ).toThrow('missing');
    expect(() => createRevision(f.c, second.setId, {})).toThrow('conflict');
    expect(() => archiveSet(f.c, second.setId, {})).toThrow('conflict');
    expect(() => replaceItems(f.c, second.setId, {})).toThrow('conflict');
    expect(() => publishSet(f.c, second.setId, {})).toThrow('conflict');
    expect(() =>
      confirmVersion(f.c, second.setId, 1, {
        fingerprint: 'unused',
        confirmed: true,
        acknowledgeQuoteMismatch: false,
      }),
    ).toThrow('conflict');
    expect(() => updateVersionContent(f.c, second.setId, 1, {})).toThrow(
      'conflict',
    );
    const next = startSession(f.c, { setId: second.setId }, randomUUID());
    expect(
      getStudyItem(f.c, next.session.id, next.session.items[0]!.id),
    ).toMatchObject({ questionNumber: '訂正1', body: '訂正本文' });
  } finally {
    f.close();
  }
});
it('rolls back every registration stage and archives only after a complete successful revision', () => {
  const f = manualFixture();
  try {
    const input = pastExamInputFixture();
    const first = savePastExam(f.c, input, randomUUID());
    for (const table of tables) {
      const before = tables.map((name) =>
        f.c.client.prepare(`select * from ${name}`).all(),
      );
      f.c.client.exec(
        `create trigger fail_past before insert on ${table} begin select raise(abort,'PRIVATE'); end`,
      );
      try {
        expect(() =>
          savePastExam(
            f.c,
            table === 'sources' ? input : { ...input, revision: 0 },
            randomUUID(),
            table === 'sources' ? undefined : first.setId,
          ),
        ).toThrow();
        expect(
          tables.map((name) =>
            f.c.client.prepare(`select * from ${name}`).all(),
          ),
        ).toEqual(before);
      } finally {
        f.c.client.exec('drop trigger fail_past');
      }
    }
  } finally {
    f.close();
  }
});
it('paginates current papers and counts only obtainable questions', () => {
  const f = manualFixture();
  try {
    const a = savePastExam(f.c, pastExamInputFixture(), randomUUID());
    const b = savePastExam(f.c, pastExamInputFixture(), randomUUID());
    const page = listPastExams(f.c, false, { limit: 1, before: undefined });
    expect(page.items.map((i) => i.id)).toEqual([b.setId]);
    expect(page.nextCursor).toMatch(/^published:/);
    const last = page.items[0]!;
    expect(
      listPastExams(f.c, false, {
        limit: 1,
        before: { publishedAt: last.publishedAt!, id: last.id },
      }).items.map((i) => i.id),
    ).toEqual([a.setId]);
    f.c.client
      .prepare(
        "update questions set status='stopped' where source_id=(select source_id from question_sets where id=?)",
      )
      .run(b.setId);
    expect(getPastExam(f.c, b.setId)).toMatchObject({
      questionCount: 1,
      availableQuestionCount: 0,
      canStart: false,
    });
  } finally {
    f.close();
  }
});
it('retains stopped and invalidated identities when an edition is edited, including concurrent safety changes', () => {
  const f = manualFixture();
  try {
    const input = pastExamInputFixture(3);
    const first = savePastExam(f.c, input, randomUUID());
    const loaded = getPastExam(f.c, first.setId, true);
    const ids = loaded.questions.map((q) => q.originalQuestionVersionId);
    // Safety actions occurring after the editor loaded must survive the save.
    f.c.client
      .prepare(
        "update questions set status='stopped' where id=(select question_id from question_versions where id=?)",
      )
      .run(ids[0]!);
    f.c.client
      .prepare(
        "update question_versions set invalidated_at=1, invalidated_by=1, invalidation_reason='不備' where id=?",
      )
      .run(ids[1]!);
    const revision = {
      ...input,
      revision: loaded.revision,
      questions: loaded.questions.map((q, i) => ({
        originalQuestionVersionId: q.originalQuestionVersionId,
        questionNumber: `訂正${i + 1}`,
        body: q.body,
        choices: q.choices,
        answerIds: q.answerIds,
        explanation: '説明の追記',
      })),
    };
    const second = savePastExam(f.c, revision, randomUUID(), first.setId);
    expect(getPastExam(f.c, second.setId)).toMatchObject({
      questionCount: 3,
      availableQuestionCount: 1,
    });
    expect(
      getPastExam(f.c, second.setId, true).questions.map((q) => q.unavailable),
    ).toEqual([true, true, false]);
    const { session } = startSession(
      f.c,
      { setId: second.setId },
      randomUUID(),
    );
    expect(session.items).toHaveLength(1);
    expect(getStudyItem(f.c, session.id, session.items[0]!.id)).toMatchObject({
      questionNumber: '訂正3',
    });
    const newest = getPastExam(f.c, second.setId, true).questions;
    const oldIdentity = f.c.client
      .prepare('select question_id from question_versions where id=?')
      .get(ids[0]!);
    expect(
      f.c.client
        .prepare('select question_id from question_versions where id=?')
        .get(newest[0]!.originalQuestionVersionId),
    ).toEqual(oldIdentity);
    const foreign = savePastExam(f.c, input, randomUUID());
    expect(() =>
      savePastExam(
        f.c,
        {
          ...input,
          revision: 0,
          questions: [
            { ...input.questions[0]!, originalQuestionVersionId: ids[0] },
          ],
        },
        randomUUID(),
        foreign.setId,
      ),
    ).toThrow('conflict');
  } finally {
    f.close();
  }
});
