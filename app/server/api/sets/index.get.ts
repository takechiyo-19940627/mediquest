import { catalogEndpoint } from '../../utils/catalog-http';
import { listPublishedSets } from '../../services/learning-catalog/service';
import { catalogPage } from '../../services/learning-catalog/input';
export default defineEventHandler((event) =>
  catalogEndpoint(event, (connection) =>
    listPublishedSets(connection, catalogPage(getQuery(event))),
  ),
);
