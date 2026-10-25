import { stopQuestion } from '../../../../services/questions/service';
import { sourceId } from '../../../../services/source-input';
import {
  limitedSourceJson,
  withSourceDatabase,
} from '../../../../utils/source-http';
import { reviewEndpoint } from '../../../../utils/review-http';
// Issue #50: stops every version of one logical question. Both the first
// transition and a replay answer 200; nothing new is created.
export default defineEventHandler((event) =>
  reviewEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'questionId'));
    const input = await limitedSourceJson(event);
    return withSourceDatabase((connection) =>
      stopQuestion(connection, id, input),
    );
  }),
);
