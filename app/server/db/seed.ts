import { eq } from 'drizzle-orm';
import type { Connection } from './connection.ts';
import { users } from './schema.ts';

// ID 1 is reserved for the initial local administrator. Never promote an existing user.
export function seedAdministrator(connection: Connection) {
  return connection.db.transaction((tx) => {
    tx.insert(users)
      .values({
        id: 1,
        displayName: '管理者',
        role: 'admin',
        createdAt: Date.now(),
      })
      .onConflictDoNothing({ target: users.id })
      .run();
    const existing = tx.select().from(users).where(eq(users.id, 1)).get();
    if (!existing || existing.role !== 'admin') {
      throw new Error(
        'Initial user ID is already occupied by a non-admin user',
      );
    }
    return existing;
  });
}
