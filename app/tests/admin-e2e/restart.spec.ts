import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

// Only this test's child and mkdtemp directory are stopped/removed.
// It never uses the user's DB or the shared Playwright webServer's DB.
test('fresh CLI setup and backup/restore restart preserve browser progress', async ({
  page,
  playwright,
}) => {
  test.setTimeout(90_000);
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'mediquest-restart-')),
  );
  const original = join(directory, 'original.sqlite');
  const backup = join(directory, 'snapshot.sqlite');
  const restored = join(directory, 'restored.sqlite');
  const origin = 'http://127.0.0.1:3310';
  let child: ReturnType<typeof spawn> | undefined;
  const client = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { Origin: origin },
  });
  function cli(script: string, db: string, args: string[] = []) {
    const result = spawnSync(
      process.execPath,
      [`scripts/db-${script}.ts`, ...args],
      {
        env: { ...process.env, MEDIQUEST_DB_PATH: db },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  }
  async function stop() {
    const owned = child;
    if (!owned) return;
    child = undefined;
    if (owned.exitCode !== null || owned.signalCode !== null) return;
    const closed = once(owned, 'close');
    owned.kill('SIGTERM');
    await closed;
  }
  async function start(db: string) {
    let output = '';
    child = spawn(
      process.execPath,
      ['.nuxt/admin-e2e-output/server/index.mjs'],
      {
        env: {
          ...process.env,
          NITRO_HOST: '127.0.0.1',
          NITRO_PORT: '3310',
          MEDIQUEST_DB_PATH: db,
          MEDIQUEST_LOCAL_MODE: 'true',
          MEDIQUEST_LOCAL_ORIGIN: origin,
          MEDIQUEST_GENERATION_ENABLED: 'true',
          ANTHROPIC_API_KEY: 'TEST_ONLY_KEY',
          MEDIQUEST_ANTHROPIC_MODEL: 'test-model',
          TEST_GENERATION_EVENTS: join(directory, 'events'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    child.stdout?.on('data', (data) => (output += String(data)));
    child.stderr?.on('data', (data) => (output += String(data)));
    await expect
      .poll(() => {
        if (child?.exitCode !== null)
          throw new Error(`Owned server failed: ${output}`);
        return output.includes('Listening on');
      })
      .toBe(true);
    await expect
      .poll(async () => (await client.get('/api/sets')).status())
      .toBe(200);
  }
  try {
    for (let i = 0; i < 2; i++) {
      cli('migrate', original);
      cli('seed', original);
    }
    await start(original);
    const sourceResponse = await client.post('/api/admin/sources', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: { title: '復元確認教材', body: '教材の根拠です。' },
    });
    expect(sourceResponse.status()).toBe(201);
    const source = await sourceResponse.json();
    const generation = await client.post(
      `/api/admin/sources/${source.id}/generations`,
      {
        headers: { 'Idempotency-Key': randomUUID() },
        data: { title: '復元確認セット', requestedCount: 2 },
      },
    );
    expect(generation.status()).toBe(201);
    const { setId } = await generation.json();
    const detail = await (await client.get(`/api/admin/sets/${setId}`)).json();
    for (const version of detail.candidates) {
      const response = await client.put(
        `/api/admin/sets/${setId}/versions/${version.id}/review`,
        {
          data: {
            fingerprint: version.fingerprint,
            confirmed: true,
            acknowledgeQuoteMismatch: true,
          },
        },
      );
      expect(response.status()).toBe(200);
    }
    const adoption = await client.put(`/api/admin/sets/${setId}/items`, {
      data: {
        expectedRevision: detail.revision,
        versionIds: detail.candidates.map((v: { id: number }) => v.id),
      },
    });
    expect(adoption.status()).toBe(200);
    const ready = await (await client.get(`/api/admin/sets/${setId}`)).json();
    expect(
      (
        await client.post(`/api/admin/sets/${setId}/publish`, {
          data: {
            expectedRevision: ready.revision,
            publishFingerprint: ready.publishFingerprint,
            confirmed: true,
          },
        })
      ).status(),
    ).toBe(201);
    await page.goto(`${origin}/sets/${setId}`);
    await page
      .getByRole('button', { name: '演習を始める', exact: true })
      .click();
    await expect(page).toHaveURL(/\/sessions\/\d+$/);
    const sessionPath = new URL(page.url()).pathname;
    await page.getByRole('radio', { name: '選択肢A', exact: true }).check();
    await page.getByRole('button', { name: '回答する', exact: true }).click();
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: '問題2', exact: true }),
    ).toBeVisible();
    const before = await (await client.get(`/api${sessionPath}`)).json();
    await stop();
    const bytes = readFileSync(original);
    cli('backup', original, [backup]);
    const snapshot = readFileSync(backup);
    cli('restore', original, [backup, restored]);
    expect(readFileSync(original)).toEqual(bytes);
    expect(readFileSync(backup)).toEqual(snapshot);
    expect(statSync(restored).mode & 0o777).toBe(0o600);
    await start(restored);
    expect(await (await client.get(`/api${sessionPath}`)).json()).toEqual(
      before,
    );
    await page.goto(`${origin}/`);
    await page.locator(`a[href="${sessionPath}"]`).first().click();
    await expect(
      page.getByRole('heading', { name: '問題2', exact: true }),
    ).toBeVisible();
    await page.goto(`${origin}${sessionPath}/result`);
    await expect(page.getByText('1 / 2問', { exact: true })).toBeVisible();
    await page.goto(`${origin}/history`);
    await expect(page.getByRole('link', { name: /を再開する$/ })).toHaveCount(
      1,
    );
  } finally {
    await stop();
    await client.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
