import { listSources } from '../../../services/sources';
import { sourcePage } from '../../../services/source-input';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';

export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      listSources(connection, sourcePage(getQuery(event))),
    ),
  ),
);
