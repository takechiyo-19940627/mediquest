import { getStudyItem } from '../../../../services/study/service';
import { sourceId } from '../../../../services/source-input';
import { studyEndpoint, withStudyDatabase } from '../../../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, () =>
    withStudyDatabase((connection) =>
      getStudyItem(
        connection,
        sourceId(getRouterParam(event, 'sessionId')),
        sourceId(getRouterParam(event, 'itemId')),
      ),
    ),
  ),
);
