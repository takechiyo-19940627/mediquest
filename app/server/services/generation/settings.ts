import { GenerationError } from './contract';
import { promptVersion } from './anthropic';
export function generationSettings(
  env: Record<string, string | undefined> = process.env,
) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.MEDIQUEST_ANTHROPIC_MODEL?.trim();
  const workspaceId = env.MEDIQUEST_ANTHROPIC_WORKSPACE_ID?.trim();
  if (
    env.MEDIQUEST_GENERATION_ENABLED !== 'true' ||
    !apiKey ||
    !model ||
    apiKey.length > 1024 ||
    model.length > 200 ||
    /[\r\n]/.test(apiKey + model) ||
    (workspaceId && (workspaceId.length > 200 || /[\r\n]/.test(workspaceId)))
  )
    throw new GenerationError('unavailable');
  return { apiKey, model, promptVersion, workspaceId };
}
