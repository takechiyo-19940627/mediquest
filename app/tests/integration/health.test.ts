import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { $fetch, setup } from '@nuxt/test-utils/e2e';

describe('Nuxt HTTP server', async () => {
  await setup({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
    server: true,
  });

  it('serves the public liveness API through HTTP', async () => {
    expect(await $fetch('/api/health')).toEqual({
      status: 'ok',
      service: 'mediquest',
    });
  });

  it('server-renders the Japanese learner empty state', async () => {
    const html = await $fetch<string>('/');
    expect(html).toContain('学習できる問題はまだありません');
    expect(html).toContain('lang="ja"');
  });
});
