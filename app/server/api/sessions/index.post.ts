import { startSession } from '../../services/study/service';
import { limitedSourceJson } from '../../utils/source-http';
import { studyEndpoint, withStudyDatabase } from '../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, async () => {
    const body = await limitedSourceJson(event);
    const result = withStudyDatabase((connection) =>
      startSession(connection, body, getHeader(event, 'idempotency-key')),
    );
    setResponseStatus(event, result.replayed ? 200 : 201);
    return result;
  }),
);
