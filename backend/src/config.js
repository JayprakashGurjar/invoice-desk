import 'dotenv/config';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export const config = {
  port: Number(process.env.PORT || 4000),
  root,
  maxConcurrent: Number(process.env.MAX_CONCURRENT_EXTRACTIONS || 2),
  reviewThreshold: Number(process.env.REVIEW_CONFIDENCE_THRESHOLD || 0.75),
  // knex = SQLite / SQL Server through Knex; asmx = InvoiceDesk ASMX web services
  dataBackend: (process.env.DATA_BACKEND || 'knex').trim().toLowerCase(),
  asmx: {
    url: (process.env.ASMX_URL || 'https://accountancy.docusoftweb.com/PracticeServices.asmx').trim(),
    agrno: process.env.ASMX_AGRNO || '',
    email: process.env.ASMX_EMAIL || '',
    password: process.env.ASMX_PASSWORD || '',
    timeoutMs: Number(process.env.ASMX_TIMEOUT_MS || 60000),
    // Extraction calls AI services from the web service; allow longer.
    extractionTimeoutMs: Number(process.env.ASMX_EXTRACTION_TIMEOUT_MS || 240000),
  },
  dbClient: (process.env.DB_CLIENT || 'sqlite').toLowerCase(),
  sqlitePath: path.resolve(root, process.env.SQLITE_PATH || './data/invoicedesk.db'),
  mssql: {
    server: process.env.MSSQL_SERVER || 'localhost',
    port: Number(process.env.MSSQL_PORT || 1433),
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DATABASE || 'InvoiceDesk',
    encrypt: process.env.MSSQL_ENCRYPT === 'true',
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== 'false',
  },
  uploadDir: path.resolve(root, process.env.UPLOAD_DIR || './uploads'),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 20),
};
