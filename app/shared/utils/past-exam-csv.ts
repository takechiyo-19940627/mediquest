/** Version 1 escapes apostrophes and formula-like text with one leading apostrophe. */
export const maxPastExamCsvBytes = 2 * 1024 * 1024;
export const pastExamCsvColumns = [
  'format_version',
  'exam_name',
  'year',
  'subject',
  'source_reference',
  'question_number',
  'body',
  ...Array.from({ length: 6 }, (_, i) => [
    `choice_${i + 1}_id`,
    `choice_${i + 1}`,
  ]).flat(),
  'answer_ids',
  'explanation',
];
export interface PastExamCsvInput {
  examName: string;
  year: string;
  subject: string;
  sourceReference: string;
  questions: {
    questionNumber: string;
    body: string;
    choices: { id: string; label: string }[];
    answerIds: string[];
    explanation: string;
  }[];
}
export class PastExamCsvError extends Error {
  constructor(
    public line: number,
    message: string,
  ) {
    super(`${line}行目: ${message}`);
  }
}
const dangerous = /^(?:'|[\s\p{Cc}]*[=+\-@]|[\t\r\n])/u;
function encode(value: string) {
  const safe = dangerous.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
function decode(value: string) {
  return value.startsWith("'") && dangerous.test(value.slice(1))
    ? value.slice(1)
    : value;
}
function rows(text: string) {
  const result: { cells: string[]; line: number }[] = [];
  let cells: string[] = [],
    cell = '',
    quoted = false,
    closed = false;
  let line = 1,
    startLine = 1;
  const fail = () => {
    throw new PastExamCsvError(line, 'CSVの引用符が正しくありません。');
  };
  const endCell = () => {
    cells.push(cell);
    cell = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += ch;
        if (ch === '\n' || (ch === '\r' && text[i + 1] !== '\n')) line++;
      }
    } else if (ch === ',') endCell();
    else if (ch === '\r' || ch === '\n') {
      endCell();
      result.push({ cells, line: startLine });
      cells = [];
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
      startLine = line;
    } else if (ch === '"') {
      if (cell || closed) fail();
      quoted = true;
    } else {
      if (closed) fail();
      cell += ch;
    }
  }
  if (quoted) fail();
  if (cell || cells.length || closed) {
    endCell();
    result.push({ cells, line: startLine });
  }
  return result;
}
export function parsePastExamCsv(text: string): PastExamCsvInput {
  if (new TextEncoder().encode(text).length > maxPastExamCsvBytes)
    throw new PastExamCsvError(1, 'CSVは2 MiB以下にしてください。');
  const parsed = rows(text.replace(/^\uFEFF/, ''));
  const header = parsed.shift();
  if (
    !header ||
    header.cells.length !== pastExamCsvColumns.length ||
    header.cells.some((cell, i) => cell !== pastExamCsvColumns[i])
  )
    throw new PastExamCsvError(1, 'CSVの列名または列順が正しくありません。');
  if (parsed.length < 1 || parsed.length > 100)
    throw new PastExamCsvError(2, '問題数は1〜100問にしてください。');
  let metadata: string[] | undefined;
  const numbers = new Set<string>();
  const questions = parsed.map(({ cells, line }) => {
    const fail = (message: string): never => {
      throw new PastExamCsvError(line, message);
    };
    if (cells.length !== pastExamCsvColumns.length)
      fail('列数が正しくありません。');
    const values = cells.map(decode);
    if (values[0] !== '1') fail('対応していないCSV形式のバージョンです。');
    const field = (index: number, max: number, optional = false) => {
      const value = values[index]!;
      if (
        (!optional && !value.trim()) ||
        [...value].length > max ||
        value.includes('\u0000')
      )
        fail(
          `${pastExamCsvColumns[index]}の入力内容を確認してください（上限${max}文字）。`,
        );
      return value.trim();
    };
    const current = [
      field(1, 100),
      field(2, 40),
      field(3, 100),
      field(4, 2000, true),
    ];
    if (metadata && current.some((v, i) => v !== metadata![i]))
      fail('試験名・年度・科目・出典は全行で統一してください。');
    metadata = current;
    const questionNumber = field(5, 40);
    if (numbers.has(questionNumber)) fail('問題番号が重複しています。');
    numbers.add(questionNumber);
    const choices: { id: string; label: string }[] = [];
    let gap = false;
    for (let i = 7; i < 19; i += 2) {
      if (!values[i] && !values[i + 1]) {
        gap = true;
        continue;
      }
      if (gap) fail('選択肢は途中を空けずに入力してください。');
      const id = field(i, 40),
        label = field(i + 1, 2000);
      if (!/^[A-Za-z0-9_-]+$/.test(id) || choices.some((c) => c.id === id))
        fail('選択肢IDが不正または重複しています。');
      choices.push({ id, label });
    }
    if (choices.length < 2) fail('選択肢は2〜6個必要です。');
    const answerIds = field(19, 245).split('|');
    if (
      new Set(answerIds).size !== answerIds.length ||
      answerIds.some((id) => !choices.some((c) => c.id === id))
    )
      fail('正解IDは選択肢IDを「|」で区切り、重複なく指定してください。');
    return {
      questionNumber,
      body: field(6, 10000),
      choices,
      answerIds: answerIds.sort(),
      explanation: field(20, 10000, true),
    };
  });
  const [examName, year, subject, sourceReference] = metadata!;
  const result = {
    examName: examName!,
    year: year!,
    subject: subject!,
    sourceReference: sourceReference!,
    questions,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024)
    throw new PastExamCsvError(
      2,
      '取り込む問題データは256 KiB以下にしてください。',
    );
  return result;
}
export function serializePastExamCsv(exam: PastExamCsvInput): string {
  const data = exam.questions.map((q) =>
    [
      '1',
      exam.examName,
      exam.year,
      exam.subject,
      exam.sourceReference,
      q.questionNumber,
      q.body,
      ...Array.from({ length: 6 }, (_, i) => [
        q.choices[i]?.id ?? '',
        q.choices[i]?.label ?? '',
      ]).flat(),
      q.answerIds.join('|'),
      q.explanation,
    ]
      .map(encode)
      .join(','),
  );
  return `\uFEFF${[pastExamCsvColumns.join(','), ...data].join('\r\n')}\r\n`;
}
