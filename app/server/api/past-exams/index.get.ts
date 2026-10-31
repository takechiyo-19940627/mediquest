import { catalogPage } from '../../services/learning-catalog/input';
import { listPastExams } from '../../services/past-exams/service';
import { catalogEndpoint } from '../../utils/catalog-http';
export default defineEventHandler((event) =>
  catalogEndpoint(event, (connection) =>
    listPastExams(connection, false, catalogPage(getQuery(event))),
  ),
);
