import { expect, it } from 'vitest';
import {
  contentValid,
  selectionPublishable,
  setError,
} from '../../app/utils/admin-sets';
import type { AdminSetDetail } from '../../app/utils/admin-sets';
it('accepts 2–6 choices and a variable nonempty correct subset', () => {
  const content = {
    body: '問題',
    explanation: '解説',
    quote: '引用',
    choices: Array.from({ length: 6 }, (_, index) => ({
      id: `a${index}`,
      label: `選択肢${index}`,
    })),
    answerIds: ['a0', 'a2', 'a5'],
  };
  expect(contentValid(content)).toBe(true);
  for (const invalid of [
    { ...content, choices: content.choices.slice(0, 1) },
    { ...content, answerIds: [] },
    { ...content, answerIds: ['missing'] },
    { ...content, answerIds: ['a0', 'a0'] },
    { ...content, quote: ' ' },
    {
      ...content,
      choices: [...content.choices, { id: 'a7', label: 'too many' }],
    },
  ])
    expect(contentValid(invalid)).toBe(false);
});
it('does not offer publication for empty, unsaved, unreviewed or stopped selection', () => {
  const set = {
    status: 'draft',
    items: [
      {
        versionId: 1,
        position: 0,
        reviewedBy: 1,
        reviewedAt: 1,
        invalidatedAt: null,
        questionStatus: 'active',
        generationStatus: 'succeeded',
      },
    ],
  } as AdminSetDetail;
  expect(selectionPublishable(set, [1])).toBe(true);
  expect(selectionPublishable(set, [])).toBe(false);
  expect(selectionPublishable(set, [2])).toBe(false);
  expect(selectionPublishable({ ...set, status: 'published' }, [1])).toBe(
    false,
  );
  for (const change of [
    { reviewedAt: null },
    { invalidatedAt: 1 },
    { questionStatus: 'stopped' },
    { generationStatus: 'failed' },
  ])
    expect(
      selectionPublishable(
        { ...set, items: [{ ...set.items[0]!, ...change }] },
        [1],
      ),
    ).toBe(false);
  expect(setError({ statusCode: 409, message: 'SECRET' })).toContain(
    '最新状態',
  );
  expect(setError({ statusCode: 500, stack: 'SECRET' })).not.toContain(
    'SECRET',
  );
});
