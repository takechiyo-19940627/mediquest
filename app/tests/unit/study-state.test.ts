import { describe, expect, it } from 'vitest';
import {
  initialAnswer,
  selectAnswer,
  submitAnswer,
  finishSaving,
  nextAnswer,
} from '../../app/utils/study-state';

describe('answer confirmation and mock persistence', () => {
  it('requires an explicit confirmation and permits changing one selection before confirmation', () => {
    let state = initialAnswer();
    expect(submitAnswer(state, 1)).toBe(state);
    state = selectAnswer(state, 'a', 1);
    state = selectAnswer(state, 'b', 1);
    expect(state).toEqual({ selected: ['b'], save: 'editing' });
    expect(submitAnswer(state, 1).save).toBe('saving');
  });
  it('requires two choices, prevents a third, and permits deselection', () => {
    let state = selectAnswer(initialAnswer(), 'a', 2);
    expect(submitAnswer(state, 2)).toBe(state);
    state = selectAnswer(state, 'b', 2);
    expect(selectAnswer(state, 'c', 2)).toBe(state);
    expect(selectAnswer(state, 'a', 2).selected).toEqual(['b']);
    expect(submitAnswer(state, 2).save).toBe('saving');
  });
  it('blocks repeat confirmation and selection while saving, keeps failed answers for retry', () => {
    const pending = submitAnswer(selectAnswer(initialAnswer(), 'a', 1), 1);
    expect(submitAnswer(pending, 1)).toBe(pending);
    expect(selectAnswer(pending, 'b', 1)).toBe(pending);
    expect(nextAnswer(pending)).toBe(pending);
    const failed = finishSaving(pending, false);
    expect(failed).toEqual({ selected: ['a'], save: 'failed' });
    expect(selectAnswer(failed, 'b', 1)).toBe(failed);
    expect(nextAnswer(failed)).toBe(failed);
    expect(submitAnswer(failed, 1)).toEqual(pending);
  });
  it('keeps confirmed answers immutable and only resets on explicit next', () => {
    const saved = finishSaving(
      submitAnswer(selectAnswer(initialAnswer(), 'a', 1), 1),
      true,
    );
    expect(selectAnswer(saved, 'b', 1)).toBe(saved);
    expect(submitAnswer(saved, 1)).toBe(saved);
    expect(finishSaving(saved, false)).toBe(saved);
    expect(saved.selected).toEqual(['a']);
    expect(nextAnswer(saved)).toEqual(initialAnswer());
  });
});
