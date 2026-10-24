import { getReport } from '../../../services/reports/service';
import { sourceId } from '../../../services/source-input';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      getReport(connection, sourceId(getRouterParam(event, 'reportId'))),
    ),
  ),
);
