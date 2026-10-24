import { resumeSession } from '../../../services/study/service';
import { resumeInput } from '../../../services/study/input';
import { sourceId } from '../../../services/source-input';
import { limitedSourceJson } from '../../../utils/source-http';
import { studyEndpoint, withStudyDatabase } from '../../../utils/study-http';
export default defineEventHandler((event) =>
  studyEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'sessionId'));
    resumeInput(await limitedSourceJson(event));
    return withStudyDatabase((connection) => resumeSession(connection, id));
  }),
);
