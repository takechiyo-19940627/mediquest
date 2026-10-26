import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, inject, it } from 'vitest';

it('uses a fresh normal artifact without generation test transport or key', () => {
  const output = inject('mediquestNuxtOutputDir');
  expect(output).toMatch(/[/\\]shared-[^/\\]+[/\\]output$/);
  expect(existsSync(join(output, 'server/index.mjs'))).toBe(true);
  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (/\.(m?js|json|html|map)$/.test(entry.name)) {
        const content = readFileSync(path, 'utf8');
        for (const marker of [
          'TEST_ONLY_GENERATION_TRANSPORT_MARKER',
          'TEST_GENERATION_EVENTS',
          'SCENARIO_PENDING',
          'TEST_ONLY_KEY',
        ])
          expect(content, path).not.toContain(marker);
      }
    }
  }
  inspect(output);
});
