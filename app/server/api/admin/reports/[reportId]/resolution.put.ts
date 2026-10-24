import { resolveReport } from '../../../../services/reports/service';
import { sourceId } from '../../../../services/source-input';
import {
  sourceEndpoint,
  withSourceDatabase,
  limitedSourceJson,
} from '../../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'reportId'));
    const body = await limitedSourceJson(event);
    return withSourceDatabase((connection) =>
      resolveReport(connection, id, body),
    );
  }),
);
