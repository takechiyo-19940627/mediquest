import { catalogEndpoint } from '../../utils/catalog-http';
import { getPublishedSet } from '../../services/learning-catalog/service';
import { sourceId } from '../../services/source-input';
export default defineEventHandler((event) =>
  catalogEndpoint(event, (connection) =>
    getPublishedSet(connection, sourceId(getRouterParam(event, 'id'))),
  ),
);
