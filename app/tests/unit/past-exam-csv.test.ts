import { describe, expect, it } from 'vitest';
import {
  parsePastExamCsv,
  serializePastExamCsv,
  pastExamCsvColumns,
  maxPastExamCsvBytes,
} from '../../shared/utils/past-exam-csv';
import { pastExamInputFixture } from '../fixtures/past-exams';
const fixture = () => {
  const { confirmed: _confirmed, ...exam } = pastExamInputFixture(2);
  return exam;
};
const mutate = (index: number, value: string) => {
  const cells = [
    '1',
    '試験',
    '2025',
    '科目',
    '',
    '1',
    '問題',
    'a',
    'A',
    'b',
    'B',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'a',
    '',
  ];
  cells[index] = value;
  return pastExamCsvColumns.join(',') + '\n' + cells.join(',');
};
describe('past exam CSV version 1', () => {
  it('round trips Japanese, commas, quotes, multiline text and multiple answers', () => {
    const exam = fixture();
    exam.questions[0]!.body = '日本語, "引用"\r\n改行\n次行';
    exam.questions[0]!.answerIds = ['a', 'b'];
    const csv = serializePastExamCsv(exam);
    expect(csv.startsWith('\uFEFFformat_version,')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(parsePastExamCsv(csv)).toEqual(exam);
    expect(parsePastExamCsv(csv.slice(1))).toEqual(exam);
  });
  it.each([
    '=SUM(A1)',
    '+1',
    '-1',
    '@formula',
    "'quote",
    "''=formula",
    ' =formula',
    '\t=1',
  ])('escapes formula-like cells reversibly: %j', (value) => {
    const exam = fixture();
    exam.questions[0]!.body = value;
    const csv = serializePastExamCsv(exam);
    expect(csv).toContain(`"'${value}"`);
    // Registration trims outer whitespace, just like manual entry.
    expect(parsePastExamCsv(csv).questions[0]!.body).toBe(value.trim());
  });
  it.each([
    [0, '2', 'バージョン'],
    [1, '', 'exam_name'],
    [7, 'a!', '選択肢ID'],
    [9, 'a', '重複'],
    [10, '', 'choice_2'],
    [19, 'c', '正解ID'],
    [19, 'a|a', '正解ID'],
    [6, 'x'.repeat(10001), 'body'],
  ])('rejects invalid field %i', (index, value, message) => {
    expect(() => parsePastExamCsv(mutate(index, value))).toThrow(`2行目:`);
    expect(() => parsePastExamCsv(mutate(index, value))).toThrow(message);
  });
  it('rejects mismatched metadata and duplicate question numbers with physical line numbers', () => {
    const exam = fixture();
    exam.questions[0]!.body = 'first\nsecond';
    exam.questions[1]!.questionNumber = '1';
    expect(() => parsePastExamCsv(serializePastExamCsv(exam))).toThrow(
      '4行目: 問題番号',
    );
    exam.questions[1]!.questionNumber = '2';
    const csv = serializePastExamCsv(exam);
    const last = csv.lastIndexOf('"テスト試験"');
    expect(() =>
      parsePastExamCsv(
        csv.slice(0, last) + csv.slice(last).replace('テスト試験', '別試験'),
      ),
    ).toThrow('4行目: 試験名');
  });
  it('rejects a single quoted header cell even with otherwise valid data', () => {
    const valid = serializePastExamCsv(fixture());
    const csv = `"${pastExamCsvColumns.join(',')}"${valid.slice(valid.indexOf('\r\n'))}`;
    expect(() => parsePastExamCsv(csv)).toThrow('1行目: CSVの列名');
  });
  it('round trips an accepted near-limit exam with maximum repeated Unicode metadata', () => {
    const exam = pastExamInputFixture(100);
    exam.examName = '😀'.repeat(100);
    exam.year = '😀'.repeat(40);
    exam.subject = '😀'.repeat(100);
    exam.sourceReference = '😀'.repeat(2000);
    for (const q of exam.questions) q.body = 'x'.repeat(2200);
    const { confirmed: _confirmed, ...content } = exam;
    expect(
      new TextEncoder().encode(JSON.stringify(content)).length,
    ).toBeLessThan(256 * 1024);
    const csv = serializePastExamCsv(content);
    expect(new TextEncoder().encode(csv).length).toBeGreaterThan(1024 * 1024);
    expect(parsePastExamCsv(csv)).toEqual(content);
  });
  it('rejects malformed quotes, columns, empty files and limits', () => {
    for (const text of [
      '',
      'wrong\n',
      `"${pastExamCsvColumns.join(',')}"\n`,
      pastExamCsvColumns.join(','),
      mutate(6, '"unterminated'),
      mutate(6, 'bad"quote'),
      mutate(6, '"closed"junk'),
      mutate(6, 'too,many'),
    ])
      expect(() => parsePastExamCsv(text)).toThrow();
    expect(() => parsePastExamCsv('x'.repeat(maxPastExamCsvBytes + 1))).toThrow(
      '2 MiB',
    );
    expect(() =>
      parsePastExamCsv(serializePastExamCsv(pastExamInputFixture(101))),
    ).toThrow('1〜100');
    const large = pastExamInputFixture(30);
    for (const q of large.questions) q.body = 'あ'.repeat(10000);
    expect(() => parsePastExamCsv(serializePastExamCsv(large))).toThrow(
      '256 KiB',
    );
  });
});
