import { getSource } from '../../../services/sources';
import { sourceId } from '../../../services/source-input';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';

export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      getSource(connection, sourceId(getRouterParam(event, 'id'))),
    ),
  ),
);
