import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.js';

// Each of the 17 binding `src` tags resolves to one of: a source TEMPLATE (real record),
// an ALIAS to another tag, or UNATTRIBUTED (no source — the binding is needs-source).
// Article shells intentionally leave authors/title blank for the curator to backfill via
// the Desk; dedup survives that backfill because binding_source_tags maps by tag, not by
// the source's mutable fields.
const SOURCE_TEMPLATES = {
  'PDSP Ki DB':      { kind: 'database', authors: 'NIMH PDSP', title: 'Ki Database (PDSP)', url: 'https://pdsp.unc.edu/databases/kidb.php' },
  'IUPHAR/BPS':      { kind: 'database', authors: 'IUPHAR/BPS', title: 'Guide to PHARMACOLOGY', url: 'https://www.guidetopharmacology.org/' },
  'StatPearls':      { kind: 'database', authors: 'StatPearls Publishing', title: 'StatPearls', url: 'https://www.ncbi.nlm.nih.gov/books/NBK430685/' },
  'Proudman 2020':   { kind: 'article', authors: 'Proudman et al.', year: 2020, notes: 'imported from binding tag "Proudman 2020" — verify & complete' },
  'Neuropsychopharmacology 2009': { kind: 'article', journal: 'Neuropsychopharmacology', year: 2009, notes: 'imported from binding tag — verify & complete' },
  'J Neural Transm 2003':         { kind: 'article', journal: 'J Neural Transm', year: 2003, notes: 'imported from binding tag — verify & complete' },
  'Biol Psychiatry 2001':         { kind: 'article', journal: 'Biol Psychiatry', year: 2001, notes: 'imported from binding tag — verify & complete' },
  'Eur Neuropsychopharmacol 2020':{ kind: 'article', journal: 'Eur Neuropsychopharmacol', year: 2020, notes: 'imported from binding tag — verify & complete' },
  'eLife 2020':      { kind: 'article', journal: 'eLife', year: 2020, notes: 'imported from binding tag — verify & complete' },
  'PMC5756147':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5756147/', notes: 'PMCID PMC5756147 — verify & complete' },
  'PMC4662164':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4662164/', notes: 'PMCID PMC4662164 — verify & complete' },
  'PMC5437659':      { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5437659/', notes: 'PMCID PMC5437659 — verify & complete' },
  'PMC10851641':     { kind: 'article', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10851641/', notes: 'PMCID PMC10851641 — verify & complete' },
};
const TAG_ALIAS = { 'PDSP / literature': 'PDSP Ki DB' };
const UNATTRIBUTED = new Set(['literature', 'literature (tier)', 'qualitative']);

const SRC_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];

/**
 * Seed binding_sources + binding_source_tags from each binding's `src` tag. Runs on every
 * migrate, so it must stay idempotent. Non-destructive: INSERT OR IGNORE edges, and reuse
 * the tag→source_id map so a re-run neither duplicates sources nor resets a curator's edge
 * status. binding_review is never touched here (pure user data).
 * Returns { sources, edges, needs }.
 */
export function migrateBindingSources(db) {
  const bindings = db.prepare('SELECT agent_name, target_alias, src FROM binding_values').all();
  const getTag = db.prepare('SELECT source_id FROM binding_source_tags WHERE tag = ?');
  const putTag = db.prepare('INSERT OR IGNORE INTO binding_source_tags (tag, source_id) VALUES (?, ?)');
  const insSource = db.prepare(`
    INSERT INTO sources (kind, authors, year, title, journal, pmid, doi, url, notes)
    VALUES (@kind, @authors, @year, @title, @journal, @pmid, @doi, @url, @notes)
  `);
  const insEdge = db.prepare(`
    INSERT OR IGNORE INTO binding_sources (agent_name, target_alias, source_id, status)
    VALUES (?, ?, ?, 'provided')
  `);

  let needs = 0;
  const tx = db.transaction(() => {
    for (const b of bindings) {
      const raw = b.src;
      if (raw == null || UNATTRIBUTED.has(raw)) { needs++; continue; }
      const tag = TAG_ALIAS[raw] ?? raw;
      const tpl = SOURCE_TEMPLATES[tag];
      if (!tpl) { needs++; continue; }   // unknown tag → needs-source, never crash

      let sid = getTag.get(tag)?.source_id;
      if (sid == null) {
        const row = {};
        for (const c of SRC_COLS) row[c] = tpl[c] ?? null;
        sid = insSource.run(row).lastInsertRowid;
        putTag.run(tag, sid);
      }
      insEdge.run(b.agent_name, b.target_alias, sid);
    }
  });
  tx();

  return {
    sources: db.prepare('SELECT COUNT(*) c FROM binding_source_tags').get().c,
    edges: db.prepare('SELECT COUNT(*) c FROM binding_sources').get().c,
    needs,
  };
}

// Run directly with `node scripts/migrate-binding-sources.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const r = migrateBindingSources(db);
  console.log(`binding provenance: ${r.sources} sources, ${r.edges} edges, ${r.needs} needs-source`);
}
