import { db } from './knex.js';
import { ensureSchema } from './schema.js';

ensureSchema()
  .then(() => console.log('Schema is up to date.'))
  .catch((e) => { console.error('Migration failed:', e); process.exitCode = 1; })
  .finally(() => db.destroy());
