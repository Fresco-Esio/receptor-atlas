import { openDb } from '../db/index.js';
import { RX, HALLS, ALIASES } from './seed-data.js';
import { migrateStructured } from './migrate-structured.js';
import { migrateArchive } from './migrate-archive.js';
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
 * Note: some `RX` fields are intentionally NOT migrated yet — `note`/`note2`
 * (provenance/correction notes) and `search` (PubMed search recipe for
 * needs-source receptors). They stay in seed-data.js until a later task gives
 * them a home (e.g. sources.notes). This omission is deliberate, not a bug.
 */
export function migrate(db) {
  const existing = db.prepare('SELECT COUNT(*) c FROM receptors').get().c;
  if (existing > 0) { seedAliases(db); structuredBestEffort(db); archiveBestEffort(db); return { skipped: true, receptors: existing }; }

  const tx = db.transaction(() => {
    const rcpt = db.prepare('INSERT INTO receptors (id,label,system,hall,sort_order,stahl_note) VALUES (?,?,?,?,?,?)');
    const vol  = db.prepare('INSERT OR IGNORE INTO receptor_volumes (receptor_id,volume) VALUES (?,?)');
    const src  = db.prepare('INSERT INTO sources (authors,year,title,journal,pmid,doi) VALUES (?,?,?,?,?,?)');
    const link = db.prepare('INSERT INTO receptor_sources (receptor_id,source_id,status,correction_note,search_query) VALUES (?,?,?,?,?)');
    const st   = db.prepare('INSERT INTO stahl_loci (receptor_id,chapter) VALUES (?,?)');
    const clm  = db.prepare('INSERT INTO claims (receptor_id,text) VALUES (?,?)');
    const qz   = db.prepare('INSERT INTO quizzes (receptor_id,prompt) VALUES (?,?)');
    const rev  = db.prepare('INSERT INTO review_state (receptor_id) VALUES (?)');

    // Dedupe shared papers: the same source cited by multiple receptors (e.g.
    // Kruse 2014 by both M1 and M3) becomes ONE sources row, so "fix the source
    // once" updates every receptor that cites it.
    const sourceByKey = new Map();

    RX.forEach((r, i) => {
      rcpt.run(r.id, r.nm, r.hall, r.hall, i, r.note ?? null);
      (r.vols || []).forEach(v => vol.run(r.id, v.toLowerCase()));
      (r.stahl || []).forEach(arr => st.run(r.id, arr[0]));
      if (r.claim) clm.run(r.id, r.claim);
      if (r.quiz)  qz.run(r.id, r.quiz);
      rev.run(r.id);

      let sourceId = null;
      if (r.ref) {
        const e = r.ref;
        const key = e.pmid ? `pmid:${e.pmid}` : (e.doi ? `doi:${e.doi}` : null);
        if (key && sourceByKey.has(key)) {
          sourceId = sourceByKey.get(key);
        } else {
          sourceId = src.run(e.a, e.y, e.t, e.journal ?? null, e.pmid, e.doi).lastInsertRowid;
          if (key) sourceByKey.set(key, sourceId);
        }
      }
      link.run(r.id, sourceId, r.cs || 'needs-source', r.note2 ?? null, r.search ?? null);
    });
  });
  tx();
  seedAliases(db);
  structuredBestEffort(db);
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
