import { answerStudyItem } from '../../../../../services/study/service';
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
    return withStudyDatabase((connection) =>
      answerStudyItem(connection, sessionId, itemId, body),
    );
  }),
);
