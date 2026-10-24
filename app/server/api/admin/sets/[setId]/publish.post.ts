import { publishSet } from '../../../../services/publication/service';
import { sourceId } from '../../../../services/source-input';
import {
  limitedSourceJson,
  withSourceDatabase,
} from '../../../../utils/source-http';
import { reviewEndpoint } from '../../../../utils/review-http';
export default defineEventHandler((event) =>
  reviewEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'setId'));
    const input = await limitedSourceJson(event);
    const result = withSourceDatabase((connection) =>
      publishSet(connection, id, input),
    );
    setResponseStatus(event, result.replayed ? 200 : 201);
    return result;
  }),
);
