export type SaveState = 'editing' | 'saving' | 'failed' | 'saved';
export interface AnswerState {
  selected: string[];
  save: SaveState;
}
export const initialAnswer = (): AnswerState => ({
  selected: [],
  save: 'editing',
});
export function selectAnswer(
  state: AnswerState,
  id: string,
  required: number,
): AnswerState {
  if (state.save !== 'editing') return state;
  if (state.selected.includes(id))
    return {
      ...state,
      selected: state.selected.filter((value) => value !== id),
    };
  if (required === 1) return { ...state, selected: [id] };
  if (state.selected.length >= required) return state;
  return { ...state, selected: [...state.selected, id] };
}
export function submitAnswer(
  state: AnswerState,
  required: number,
): AnswerState {
  if (
    !['editing', 'failed'].includes(state.save) ||
    state.selected.length !== required
  )
    return state;
  return { ...state, save: 'saving' };
}
export function finishSaving(
  state: AnswerState,
  success: boolean,
): AnswerState {
  if (state.save !== 'saving') return state;
  return { ...state, save: success ? 'saved' : 'failed' };
}
export function nextAnswer(state: AnswerState): AnswerState {
  return state.save === 'saved' ? initialAnswer() : state;
}
export interface StudyQuestionData {
  title: string;
  required: number;
  choices: { id: string; label: string }[];
}
