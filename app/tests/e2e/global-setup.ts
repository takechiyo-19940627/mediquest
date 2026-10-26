import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { initialize } from './fixtures/catalog-db';
export default function setup() {
  const directory = dirname(process.env.MEDIQUEST_E2E_DB!);
  mkdirSync(directory, { recursive: true });
  try {
    initialize();
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return () =>
    rmSync(dirname(process.env.MEDIQUEST_E2E_DB!), {
      recursive: true,
      force: true,
    });
}
