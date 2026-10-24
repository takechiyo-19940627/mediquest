import { generationStatus } from '../../../services/generation/service';
import { sourceId } from '../../../services/source-input';
import { generationEndpoint } from '../../../utils/generation-http';
export default defineEventHandler((event) =>
  generationEndpoint(event, () =>
    generationStatus(sourceId(getRouterParam(event, 'id'))),
  ),
);
