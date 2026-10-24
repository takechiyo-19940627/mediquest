import { confirmVersion } from '../../../../../../services/review/service';
import { reviewInput } from '../../../../../../services/review/input';
import { sourceId } from '../../../../../../services/source-input';
import {
  limitedSourceJson,
  withSourceDatabase,
} from '../../../../../../utils/source-http';
import { reviewEndpoint } from '../../../../../../utils/review-http';
export default defineEventHandler((event) =>
  reviewEndpoint(event, async () => {
    const setId = sourceId(getRouterParam(event, 'setId'));
    const versionId = sourceId(getRouterParam(event, 'versionId'));
    const input = reviewInput(await limitedSourceJson(event));
    return withSourceDatabase((connection) =>
      confirmVersion(connection, setId, versionId, input),
    );
  }),
);
