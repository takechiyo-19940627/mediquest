import { defineNitroPlugin } from 'nitropack/runtime';
import { serverDatabase } from '../db/shared';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => serverDatabase.close());
});
