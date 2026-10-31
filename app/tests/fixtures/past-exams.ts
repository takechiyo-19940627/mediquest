export const pastQuestionInput = (questionNumber = '1') => ({
  questionNumber,
  body: 'テスト用の過去問',
  choices: [
    { id: 'a', label: '選択肢 A' },
    { id: 'b', label: '選択肢 B' },
  ],
  answerIds: ['a'],
  explanation: '',
});
export const pastExamInputFixture = (count = 1) => ({
  examName: 'テスト試験',
  year: '2025年度',
  subject: '情報',
  sourceReference: '',
  confirmed: true,
  questions: Array.from({ length: count }, (_, i) =>
    pastQuestionInput(String(i + 1)),
  ),
});
