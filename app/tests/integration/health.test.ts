import { setupSharedHttpServer } from '../fixtures/http-server';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { $fetch } from '@nuxt/test-utils/e2e';

describe('Nuxt HTTP server', async () => {
  await setupSharedHttpServer({
    rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  });

  it('serves the public liveness API through HTTP', async () => {
    expect(await $fetch('/api/health')).toEqual({
      status: 'ok',
      service: 'mediquest',
    });
  });

  it('server-renders loading without claiming the catalog is empty', async () => {
    const html = await $fetch<string>('/');
    // AC-2.4: catalog requests run in the browser to retain the socket boundary.
    expect(html).toContain('過去問を読み込み中です。');
    expect(html).not.toContain('学習できる問題はまだありません');
    expect(html).toContain('lang="ja"');
  });
});
