import { getSession } from '../../services/study/service';
import { sourceId } from '../../services/source-input';
import { studyEndpoint, withStudyDatabase } from '../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, () =>
    withStudyDatabase((connection) =>
      getSession(connection, sourceId(getRouterParam(event, 'sessionId'))),
    ),
  ),
);
