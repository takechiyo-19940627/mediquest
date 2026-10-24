import { listReports } from '../../../services/reports/service';
import { sourcePage } from '../../../services/source-input';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      listReports(connection, sourcePage(getQuery(event))),
    ),
  ),
);
