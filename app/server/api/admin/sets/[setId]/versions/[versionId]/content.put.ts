import { updateVersionContent } from '../../../../../../services/review/service';
import { sourceId } from '../../../../../../services/source-input';
import {
  limitedSourceJson,
  withSourceDatabase,
} from '../../../../../../utils/source-http';
import { reviewEndpoint } from '../../../../../../utils/review-http';
// Issue #48: full content replacement of one unpublished draft candidate.
export default defineEventHandler((event) =>
  reviewEndpoint(event, async () => {
    const setId = sourceId(getRouterParam(event, 'setId'));
    const versionId = sourceId(getRouterParam(event, 'versionId'));
    const input = await limitedSourceJson(event);
    return withSourceDatabase((connection) =>
      updateVersionContent(connection, setId, versionId, input),
    );
  }),
);
