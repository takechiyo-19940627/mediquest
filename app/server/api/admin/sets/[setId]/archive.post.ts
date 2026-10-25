import { archiveSet } from '../../../../services/publication/service';
import { sourceId } from '../../../../services/source-input';
import {
  limitedSourceJson,
  withSourceDatabase,
} from '../../../../utils/source-http';
import { reviewEndpoint } from '../../../../utils/review-http';
// Issue #46: both the first transition and a replay answer 200; nothing new is
// created, so the publish route's 201 does not apply.
export default defineEventHandler((event) =>
  reviewEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'setId'));
    const input = await limitedSourceJson(event);
    return withSourceDatabase((connection) =>
      archiveSet(connection, id, input),
    );
  }),
);
