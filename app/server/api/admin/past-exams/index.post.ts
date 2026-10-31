import { savePastExam } from '../../../services/past-exams/service';
import { requestKey } from '../../../services/source-input';
import {
  limitedSourceJson,
  sourceEndpoint,
  withSourceDatabase,
} from '../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, async () => {
    const key = requestKey(getHeader(event, 'idempotency-key'));

    const body = await limitedSourceJson(event);
    const receipt = withSourceDatabase((connection) =>
      savePastExam(connection, body, key),
    );
    setResponseStatus(event, receipt.replayed ? 200 : 201);
    return receipt;
  }),
);
