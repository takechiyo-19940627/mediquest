import { getSet } from '../../../services/review/service';
import { sourceId } from '../../../services/source-input';
import { withSourceDatabase } from '../../../utils/source-http';
import { reviewEndpoint } from '../../../utils/review-http';
export default defineEventHandler((event) =>
  reviewEndpoint(event, () =>
    withSourceDatabase((connection) =>
      getSet(connection, sourceId(getRouterParam(event, 'id'))),
    ),
  ),
);
