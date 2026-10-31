import { catalogPage } from '../../../services/learning-catalog/input';
import { listPastExams } from '../../../services/past-exams/service';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      listPastExams(connection, true, catalogPage(getQuery(event))),
    ),
  ),
);
