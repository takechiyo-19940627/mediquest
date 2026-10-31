import { getPastExam } from '../../services/past-exams/service';
import { sourceId } from '../../services/source-input';
import { catalogEndpoint } from '../../utils/catalog-http';
export default defineEventHandler((event) =>
  catalogEndpoint(event, (connection) =>
    getPastExam(connection, sourceId(getRouterParam(event, 'id')), false),
  ),
);
