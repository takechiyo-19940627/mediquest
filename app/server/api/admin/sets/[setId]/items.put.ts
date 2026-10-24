import { replaceItems } from '../../../../services/publication/service';
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
    return withSourceDatabase((connection) =>
      replaceItems(connection, id, input),
    );
  }),
);
