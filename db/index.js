import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Columns added after the table shipped. schema.sql is CREATE TABLE IF NOT EXISTS, so a
// new column there never reaches an existing database; this does, idempotently. The
// Ledger's four syndromic columns were reachable from the Desk since 1.2.0 but existed
// only on the machine where they had been added by hand.
const LATE_COLUMNS = {
  clinical_rows: [
    ['onset', 'TEXT'], ['time_course', 'TEXT'],
    ['risk_factors_json', 'TEXT'], ['monitoring_json', 'TEXT'],
  ],
};
export function ensureColumns(db) {
  for (const [table, cols] of Object.entries(LATE_COLUMNS)) {
    const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
    for (const [name, type] of cols) if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

export function openDb(path = join(HERE, 'atlas.db')) {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(HERE, 'schema.sql'), 'utf8'));
  ensureColumns(db);
  return db;
}
