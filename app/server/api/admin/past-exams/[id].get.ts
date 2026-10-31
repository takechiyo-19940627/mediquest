import { getPastExam } from '../../../services/past-exams/service';
import { sourceId } from '../../../services/source-input';
import { sourceEndpoint, withSourceDatabase } from '../../../utils/source-http';
export default defineEventHandler((event) =>
  sourceEndpoint(event, () =>
    withSourceDatabase((connection) =>
      getPastExam(connection, sourceId(getRouterParam(event, 'id')), true),
    ),
  ),
);
