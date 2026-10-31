import { createManualSet } from '../../../../services/manual/service';
import { sourceId, requestKey } from '../../../../services/source-input';
import {
  limitedSourceJson,
  sourceEndpoint,
  withSourceDatabase,
} from '../../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'id'));
    const key = requestKey(getHeader(event, 'idempotency-key'));
    const body = await limitedSourceJson(event);
    const receipt = withSourceDatabase((connection) =>
      createManualSet(connection, id, body, key),
    );
    setResponseStatus(event, receipt.replayed ? 200 : 201);
    return receipt;
  }),
);
