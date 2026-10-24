import { createReport } from '../../../../../services/reports/service';
import { sourceId } from '../../../../../services/source-input';
import { limitedSourceJson } from '../../../../../utils/source-http';
import {
  studyEndpoint,
  withStudyDatabase,
} from '../../../../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, async () => {
    const sessionId = sourceId(getRouterParam(event, 'sessionId'));
    const itemId = sourceId(getRouterParam(event, 'itemId'));
    const body = await limitedSourceJson(event);
    const result = withStudyDatabase((connection) =>
      createReport(connection, sessionId, itemId, body),
    );
    setResponseStatus(event, result.replayed ? 200 : 201);
    return result;
  }),
);
