import { createProvider } from '#generation-provider';
import { GenerationError } from '../../../../services/generation/contract';
import { generateQuestionsWithReceipt } from '../../../../services/generation/service';
import { generationSettings } from '../../../../services/generation/settings';
import { sourceId, requestKey } from '../../../../services/source-input';
import { limitedSourceJson } from '../../../../utils/source-http';
import {
  generationEndpoint,
  responseCancellation,
} from '../../../../utils/generation-http';

export default defineEventHandler((event) =>
  generationEndpoint(event, async () => {
    const id = sourceId(getRouterParam(event, 'id'));
    const key = requestKey(getHeader(event, 'idempotency-key'));
    const body = await limitedSourceJson(event);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) => !['title', 'requestedCount'].includes(key),
      )
    )
      throw new GenerationError('invalid');
    const cancel = responseCancellation(event);
    let settings: ReturnType<typeof generationSettings> | undefined;
    try {
      const run = await generateQuestionsWithReceipt(
        { ...body, sourceId: id, requestKey: key },
        () => {
          settings = generationSettings();
          return settings;
        },
        (input) => {
          if (!settings) throw new GenerationError('unavailable');
          return createProvider(
            settings.apiKey,
            cancel.signal,
            settings.workspaceId,
          )(input);
        },
      );
      setResponseStatus(
        event,
        run.status === 'running' ? 202 : run.replayed ? 200 : 201,
      );
      return { ...run, statusUrl: `/api/admin/generations/${run.id}` };
    } finally {
      cancel.dispose();
    }
  }),
);
