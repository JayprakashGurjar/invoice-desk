import fs from 'node:fs';
import path from 'node:path';
import knexLib from 'knex';
import { config } from '../config.js';

function buildConfig() {
  if (config.dbClient === 'mssql') {
    return {
      client: 'mssql',
      connection: {
        server: config.mssql.server,
        port: config.mssql.port,
        user: config.mssql.user,
        password: config.mssql.password,
        database: config.mssql.database,
        options: {
          encrypt: config.mssql.encrypt,
          trustServerCertificate: config.mssql.trustServerCertificate,
        },
      },
      pool: { min: 0, max: 10 },
    };
  }
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  return {
    client: 'better-sqlite3',
    connection: { filename: config.sqlitePath },
    useNullAsDefault: true,
    pool: {
      afterCreate: (conn, done) => {
        conn.pragma('foreign_keys = ON');
        conn.pragma('journal_mode = WAL');
        done();
      },
    },
  };
}

export const db = knexLib(buildConfig());

/** Knex returns [id] on some drivers and [{ id }] with .returning() on others — normalise. */
export function insertedId(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return typeof first === 'object' && first !== null ? first.id : first;
}
