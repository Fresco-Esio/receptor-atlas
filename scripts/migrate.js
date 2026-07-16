import { openDb } from '../db/index.js';
import { RX, HALLS, ALIASES, STAHL_CHAPTERS } from './seed-data.js';
import { migrateStructured } from './migrate-structured.js';
import { migrateArchive } from './migrate-archive.js';
import { migrateBindingSources } from './migrate-binding-sources.js';
import { pathToFileURL } from 'node:url';

/**
 * Load the structured volume data (binding_values, clinical_rows). Best-effort:
 * wrapped so a missing/unreadable volume file can never break the core seed that
 * the rest of the app depends on. Depends on aliases being seeded first.
 */
function structuredBestEffort(db) {
  try { return migrateStructured(db); }
  catch (e) { return { binding: 0, clinical: 0, error: e.message }; }
}

function archiveBestEffort(db) {
  try { return migrateArchive(db); }
  catch (e) { return { archive: 0, error: e.message }; }
}

function bindingSourcesBestEffort(db) {
  try { return migrateBindingSources(db); }
  catch (e) { return { sources: 0, edges: 0, needs: 0, error: e.message }; }
}

/**
 * Seed the cross-volume id aliases (Task 13). Pure reference data, so this runs
 * INSERT OR IGNORE every migrate — it adds aliases to an already-seeded DB without
 * touching content or user data, and never duplicates (PRIMARY KEY (volume, alias)).
 */
export function seedAliases(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO receptor_aliases (volume, alias, receptor_id) VALUES (?,?,?)');
  const tx = db.transaction(() => { for (const [vol, alias, id] of ALIASES) ins.run(vol, alias, id); });
  tx();
  return ALIASES.length;
}

/**
 * Seed the database from the Conservator's Desk's `RX` content.
 *
 * Idempotent by design: if the DB already holds receptors, this is a no-op.
 * That keeps a re-run (`npm run migrate`) safe — it never duplicates content
 * and never touches user data (review_state, section_activity). To rebuild from
 * scratch, delete db/atlas.db and run again (start.bat does this when the file
 * is absent).
 *
 * Returns { skipped, receptors }.
 *
 * Citation/verification redesign: a receptor's citations are now a list, not a
 * single slot. Each `RX` entry's peer-reviewed `ref` becomes its primary
 * article-source edge (is_primary=1); each Stahl chapter in `RX.stahl` becomes a
 * kind='book' source attached as an ordinary, non-primary edge — Stahl is no
 * longer modeled as a separate citation type. A receptor with no `ref` (the old
 * "needs-source" receptors) simply gets no article edge; it may still carry
 * Stahl-chapter edges, so "needs-source" is no longer implied by their presence
 * — it now means literally zero attached sources (see lib/queries.js rollup).
 */
export function migrate(db) {
  const existing = db.prepare('SELECT COUNT(*) c FROM receptors').get().c;
  if (existing > 0) { seedAliases(db); structuredBestEffort(db); bindingSourcesBestEffort(db); archiveBestEffort(db); return { skipped: true, receptors: existing }; }

  const tx = db.transaction(() => {
    const rcpt = db.prepare('INSERT INTO receptors (id,label,system,hall,sort_order,stahl_note,search_query) VALUES (?,?,?,?,?,?,?)');
    const vol  = db.prepare('INSERT OR IGNORE INTO receptor_volumes (receptor_id,volume) VALUES (?,?)');
    const src  = db.prepare('INSERT INTO sources (kind,authors,year,title,journal,pmid,doi,url,notes) VALUES (?,?,?,?,?,?,?,?,?)');
    const link = db.prepare('INSERT INTO receptor_sources (receptor_id,source_id,status,is_primary,correction_note) VALUES (?,?,?,?,?)');
    const clm  = db.prepare('INSERT INTO claims (receptor_id,text) VALUES (?,?)');
    const qz   = db.prepare('INSERT INTO quizzes (receptor_id,prompt) VALUES (?,?)');
    const rev  = db.prepare('INSERT INTO review_state (receptor_id) VALUES (?)');

    // Dedupe shared papers: the same article cited by multiple receptors (e.g.
    // Kruse 2014 by both M1 and M3) becomes ONE sources row, so "fix the source
    // once" updates every receptor that cites it. Same idea for Stahl chapters:
    // the same chapter cited by many receptors becomes ONE book source row.
    const sourceByPmidKey = new Map();
    const sourceByChapter = new Map();

    RX.forEach((r, i) => {
      rcpt.run(r.id, r.nm, r.hall, r.hall, i, r.note ?? null, r.search ?? null);
      (r.vols || []).forEach(v => vol.run(r.id, v.toLowerCase()));
      if (r.claim) clm.run(r.id, r.claim);
      if (r.quiz)  qz.run(r.id, r.quiz);
      rev.run(r.id);

      if (r.ref) {
        const e = r.ref;
        const key = e.pmid ? `pmid:${e.pmid}` : (e.doi ? `doi:${e.doi}` : null);
        let sourceId;
        if (key && sourceByPmidKey.has(key)) {
          sourceId = sourceByPmidKey.get(key);
        } else {
          sourceId = src.run('article', e.a, e.y, e.t, e.journal ?? null, e.pmid ?? null, e.doi ?? null, null, null).lastInsertRowid;
          if (key) sourceByPmidKey.set(key, sourceId);
        }
        const status = (r.cs && r.cs !== 'needs-source') ? r.cs : 'provided';
        link.run(r.id, sourceId, status, 1, r.note2 ?? null);
      }

      (r.stahl || []).forEach(arr => {
        const c = arr[0];
        let sourceId = sourceByChapter.get(c);
        if (sourceId == null) {
          const ch = STAHL_CHAPTERS[c];
          sourceId = src.run('book', 'Stahl SM', 2021, `Stahl 5e — Ch ${c}: ${ch.t}`, null, null, null, ch.u, `pp ${ch.p}`).lastInsertRowid;
          sourceByChapter.set(c, sourceId);
        }
        link.run(r.id, sourceId, 'provided', 0, null);
      });
    });
  });
  tx();
  seedAliases(db);
  structuredBestEffort(db);
  bindingSourcesBestEffort(db);
  archiveBestEffort(db);
  return { skipped: false, receptors: RX.length };
}

// Run directly with `node scripts/migrate.js` (but not when imported by tests).
// pathToFileURL keeps this comparison correct on Windows (backslashes/drive letters).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const r = migrate(db);
  console.log(r.skipped
    ? `already seeded (${r.receptors} receptors); delete db/atlas.db to rebuild`
    : `migrated ${r.receptors} receptors`);
}
