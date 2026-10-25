import { skipStudyItem } from '../../../../../services/study/service';
import { skipInput } from '../../../../../services/study/input';
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
    skipInput(await limitedSourceJson(event));
    return withStudyDatabase((connection) =>
      skipStudyItem(connection, sessionId, itemId),
    );
  }),
);
