import { withE2eDatabase } from '../../scripts/e2e-database';
import { expect, it } from 'vitest';
import {
  database,
  emptyCatalog,
  initialize,
  seedCatalog,
} from '../e2e/fixtures/catalog-db';
import {
  getPublishedSet,
  listPublishedSets,
} from '../../server/services/learning-catalog/service';
it('browser fixture resets a real database with public pages, zero questions and private sets', async () => {
  const previous = process.env.MEDIQUEST_E2E_SESSION;
  await withE2eDatabase(async (env) => {
    process.env.MEDIQUEST_E2E_SESSION = env.MEDIQUEST_E2E_SESSION;
    try {
      initialize();
      for (let i = 0; i < 2; i++) {
        const f = await seedCatalog();
        const c = database();
        try {
          const first = listPublishedSets(c, { limit: 20, before: undefined });
          expect(first.items).toHaveLength(20);
          expect(first.items[0]!.availableQuestionCount).toBe(0);
          expect(getPublishedSet(c, f.ids[0]!).canStart).toBe(true);
          expect(() => getPublishedSet(c, f.draftId)).toThrow();
          expect(() => getPublishedSet(c, f.archivedId)).toThrow();
        } finally {
          c.close();
        }
        emptyCatalog();
        const empty = database();
        try {
          expect(
            listPublishedSets(empty, { limit: 20, before: undefined }).items,
          ).toEqual([]);
        } finally {
          empty.close();
        }
      }
    } finally {
      if (previous === undefined) delete process.env.MEDIQUEST_E2E_SESSION;
      else process.env.MEDIQUEST_E2E_SESSION = previous;
    }
  });
});
