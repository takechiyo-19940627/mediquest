import { listSets } from '../../../services/review/service';
import { sourcePage } from '../../../services/source-input';
import { withSourceDatabase } from '../../../utils/source-http';
import { reviewEndpoint } from '../../../utils/review-http';
export default defineEventHandler((event) =>
  reviewEndpoint(event, () =>
    withSourceDatabase((connection) =>
      listSets(connection, sourcePage(getQuery(event))),
    ),
  ),
);
