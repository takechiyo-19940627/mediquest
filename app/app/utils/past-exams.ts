export interface PastQuestion {
  originalQuestionVersionId?: number;
  unavailable?: boolean;
  questionNumber: string;
  body: string;
  choices: { id: string; label: string }[];
  answerIds: string[];
  explanation: string;
}
export interface PastExam {
  id: number;
  title: string;
  examName: string;
  year: string;
  subject: string;
  sourceReference: string;
  questionCount: number;
  availableQuestionCount: number;
  revision: number;
  status: string;
  questions?: PastQuestion[];
}
