import { createSource } from '../../../services/sources';
import { sourceInput, requestKey } from '../../../services/source-input';
import {
  withSourceDatabase,
  limitedSourceJson,
  sourceEndpoint,
} from '../../../utils/source-http';

export default defineEventHandler((event) =>
  sourceEndpoint(event, async () => {
    const key = requestKey(getHeader(event, 'idempotency-key'));
    const input = sourceInput(await limitedSourceJson(event));
    const result = withSourceDatabase((connection) =>
      createSource(connection, input, key),
    );
    setResponseStatus(event, result.replayed ? 200 : 201);
    return { id: result.id };
  }),
);
