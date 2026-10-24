import { listSessions } from '../../services/study/history';
import { historyQuery } from '../../services/study/input';
import { studyEndpoint, withStudyDatabase } from '../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, () =>
    withStudyDatabase((connection) =>
      listSessions(connection, historyQuery(getQuery(event))),
    ),
  ),
);
