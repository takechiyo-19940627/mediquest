import { startReviewSession } from '../../../services/study/service';
import { sourceId } from '../../../services/source-input';
import { limitedSourceJson } from '../../../utils/source-http';
import { studyEndpoint, withStudyDatabase } from '../../../utils/study-http';
// Issue #44: start a review session from the owner's completed session.
export default defineEventHandler((event) =>
  studyEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'sessionId'));
    const body = await limitedSourceJson(event);
    const result = withStudyDatabase((connection) =>
      startReviewSession(
        connection,
        id,
        body,
        getHeader(event, 'idempotency-key'),
      ),
    );
    setResponseStatus(event, result.replayed ? 200 : 201);
    return result;
  }),
);
