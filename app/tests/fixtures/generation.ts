export const sourceText = '教材の根拠です。';
export function candidate(body = '問題文') {
  return {
    body,
    choices: [
      { id: 'a', label: '選択肢A' },
      { id: 'b', label: '選択肢B' },
    ],
    answerIds: ['a'],
    explanation: '解説です。',
    quote: sourceText,
  };
}
export function output(count = 1) {
  return {
    questions: Array.from({ length: count }, (_, index) =>
      candidate(`問題${index + 1}`),
    ),
  };
}
