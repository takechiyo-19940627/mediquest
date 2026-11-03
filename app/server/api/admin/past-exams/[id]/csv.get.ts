import { serializePastExamCsv } from '../../../../../shared/utils/past-exam-csv';
import { getPastExam } from '../../../../services/past-exams/service';
import { SourceError } from '../../../../services/source-errors';
import { sourceId } from '../../../../services/source-input';
import {
  sourceEndpoint,
  withSourceDatabase,
} from '../../../../utils/source-http';

export default defineEventHandler((event) =>
  sourceEndpoint(event, () => {
    const id = sourceId(getRouterParam(event, 'id'));
    const exam = withSourceDatabase((connection) =>
      getPastExam(connection, id, true),
    );
    if (exam.questions.some((q) => q.unavailable))
      throw new SourceError('csv_unavailable');
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8');
    setHeader(
      event,
      'Content-Disposition',
      `attachment; filename="past-exam-${id}.csv"`,
    );
    setHeader(event, 'X-Content-Type-Options', 'nosniff');
    return serializePastExamCsv(exam);
  }),
);
