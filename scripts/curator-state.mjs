// The curator layer: everything in db/atlas.db that did NOT come from the files in
// this repository, dumped to text so it can travel with them.
//
//   node scripts/curator-state.mjs export    # db/curator-state.json  <- database
//   node scripts/curator-state.mjs import    # db/curator-state.json  -> database
//
// WHY THIS EXISTS
//
// The Desk writes to the database and only to the database. The database is not in
// git, and the migrations re-seed content from the committed HTML page literals.
// So a fresh clone does not give you an empty desk that obviously needs restoring:
// it gives you a fully populated, plausible-looking desk showing the SHIPPED
// content, with every edit you made silently replaced by the original. Wrong in the
// quiet way, which is the only way this project treats as serious.
//
// WHAT IT WRITES
//
// Only the difference between what you have and what a fresh seed would produce.
// A dump of everything would be a second copy of the atlas, and its diffs would say
// nothing. Restricted to the delta, `git diff` reads as a sentence: this source was
// attached, this claim changed, this pair was marked verified.
//
// SOURCE IDENTITY
//
// sources.id is an autoincrement rowid and is NOT stable across a rebuild, so an
// edge recorded as "source 17" means nothing on another machine. Every reference
// here is by natural key (PMID, then DOI, then URL, then the citation itself),
// mirroring the dedupe migrate.js already does when it seeds shared papers.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { openDb } from '../db/index.js';
import { migrate } from './migrate.js';

export const STATE_FILE = new URL('../db/curator-state.json', import.meta.url);
const FORMAT = 1;

/** A reference that survives a rebuild. Prefers the identifiers that identify a
 *  paper in the world over the ones that identify a row in this database. */
export function sourceKey(s) {
  if (s.pmid) return `pmid:${String(s.pmid).trim()}`;
  if (s.doi) return `doi:${String(s.doi).trim().toLowerCase()}`;
  if (s.url) return `url:${String(s.url).trim()}`;
  return `cite:${[s.kind, s.authors, s.year, s.title].map(v => String(v ?? '').trim()).join('|')}`;
}

const SOURCE_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
const ARCHIVE_COLS = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption', 'body_json', 'tags_json'];
const CLINICAL_COLS = ['sys', 'name', 'cls', 'baseline', 'mech', 'over_json', 'under_json', 'stahl', 'agonists_json', 'antagonists_json'];
// Only the binding fields the Desk can actually write (see BINDING_FIELDS in router.js).
const BINDING_COLS = ['ki', 'ki_text', 'act', 'act_full', 'src', 'note'];

/** A pristine seed to diff against: what `npm run migrate` would produce on a fresh
 *  clone of exactly these files. Built once per process; the export runs on a save
 *  debounce and re-seeding on every keystroke would be absurd. */
let pristineDb = null;
function pristine() {
  if (!pristineDb) { pristineDb = openDb(':memory:'); migrate(pristineDb); }
  return pristineDb;
}
/** Test seam: drop the cached seed (used when a test seeds a different fixture). */
export function resetPristine() { if (pristineDb) { pristineDb.close(); pristineDb = null; } }

const rows = (db, sql) => db.prepare(sql).all();
const differs = (a, b, cols) => cols.some(c => (a[c] ?? null) !== (b[c] ?? null));
const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));

/** Read the curator layer out of `db`. Pure: touches nothing. */
export function exportState(db) {
  const seed = pristine();

  // --- sources: added by the curator, or corrected since seeding -------------
  const seedSources = new Map(rows(seed, 'SELECT * FROM sources').map(s => [sourceKey(s), s]));
  const liveSources = rows(db, 'SELECT * FROM sources');
  const liveById = new Map(liveSources.map(s => [s.id, s]));
  const sources = [];
  for (const s of liveSources) {
    const k = sourceKey(s), was = seedSources.get(k);
    if (!was || differs(s, was, SOURCE_COLS)) sources.push({ key: k, ...pick(s, SOURCE_COLS) });
  }

  // --- receptor source edges, keyed by paper rather than by rowid -----------
  const seedEdge = new Map();
  for (const e of rows(seed, 'SELECT rs.*, s.pmid, s.doi, s.url, s.kind, s.authors, s.year, s.title FROM receptor_sources rs JOIN sources s ON s.id = rs.source_id'))
    seedEdge.set(`${e.receptor_id}|${sourceKey(e)}`, e);
  const receptorSources = [];
  for (const e of rows(db, 'SELECT * FROM receptor_sources')) {
    const s = liveById.get(e.source_id); if (!s) continue;
    const k = `${e.receptor_id}|${sourceKey(s)}`, was = seedEdge.get(k);
    if (!was || differs(e, was, ['status', 'is_primary', 'correction_note']))
      receptorSources.push({ receptor_id: e.receptor_id, source: sourceKey(s), status: e.status, is_primary: e.is_primary, correction_note: e.correction_note ?? null });
  }

  // --- binding source edges (729 at seed; only the moved ones travel) -------
  const seedBind = new Map();
  for (const e of rows(seed, 'SELECT bs.*, s.pmid, s.doi, s.url, s.kind, s.authors, s.year, s.title FROM binding_sources bs JOIN sources s ON s.id = bs.source_id'))
    seedBind.set(`${e.agent_name}|${e.target_alias}|${sourceKey(e)}`, e);
  const bindingSources = [];
  for (const e of rows(db, 'SELECT * FROM binding_sources')) {
    const s = liveById.get(e.source_id); if (!s) continue;
    const k = `${e.agent_name}|${e.target_alias}|${sourceKey(s)}`, was = seedBind.get(k);
    if (!was || was.status !== e.status)
      bindingSources.push({ agent_name: e.agent_name, target_alias: e.target_alias, source: sourceKey(s), status: e.status });
  }

  // --- review: only receptors the curator has actually touched --------------
  const review = {};
  for (const r of rows(db, 'SELECT * FROM review_state')) {
    if (!r.mechanism && !r.affinity && !r.clinical && !r.citation && !r.mastery && !r.note) continue;
    review[r.receptor_id] = { mechanism: r.mechanism | 0, affinity: r.affinity | 0, clinical: r.clinical | 0, citation: r.citation | 0, mastery: r.mastery | 0, note: r.note || '' };
  }
  const activity = rows(db, 'SELECT receptor_id, volume, last_edited_at, last_reviewed_at FROM section_activity');
  const bindingReview = rows(db, 'SELECT agent_name, target_alias, value_status FROM binding_review');

  // --- content the curator edited away from what the pages ship -------------
  const claims = {};
  const seedClaims = new Map(rows(seed, 'SELECT * FROM claims').map(c => [c.receptor_id, c.text]));
  for (const c of rows(db, 'SELECT * FROM claims'))
    if (seedClaims.get(c.receptor_id) !== c.text) claims[c.receptor_id] = c.text;

  const archive = {};
  const seedArchive = new Map(rows(seed, 'SELECT * FROM archive_entries').map(a => [a.receptor_id, a]));
  for (const a of rows(db, 'SELECT * FROM archive_entries')) {
    const was = seedArchive.get(a.receptor_id);
    if (!was) { archive[a.receptor_id] = pick(a, ARCHIVE_COLS); continue; }
    const d = {};
    for (const c of ARCHIVE_COLS) if ((a[c] ?? null) !== (was[c] ?? null)) d[c] = a[c] ?? null;
    if (Object.keys(d).length) archive[a.receptor_id] = d;
  }

  const clinical = {};
  const seedClinical = new Map(rows(seed, 'SELECT * FROM clinical_rows').map(c => [c.no, c]));
  for (const c of rows(db, 'SELECT * FROM clinical_rows')) {
    const was = seedClinical.get(c.no);
    if (!was) { clinical[c.no] = pick(c, CLINICAL_COLS); continue; }
    const d = {};
    for (const col of CLINICAL_COLS) if ((c[col] ?? null) !== (was[col] ?? null)) d[col] = c[col] ?? null;
    if (Object.keys(d).length) clinical[c.no] = d;
  }

  const bindings = [];
  const seedBv = new Map(rows(seed, 'SELECT * FROM binding_values').map(b => [`${b.agent_name}|${b.target_alias}`, b]));
  for (const b of rows(db, 'SELECT * FROM binding_values')) {
    const k = `${b.agent_name}|${b.target_alias}`, was = seedBv.get(k);
    if (!was) continue;                    // a whole new pair comes from a re-source, not the Desk
    const d = {};
    for (const c of BINDING_COLS) if ((b[c] ?? null) !== (was[c] ?? null)) d[c] = b[c] ?? null;
    if (Object.keys(d).length) bindings.push({ agent_name: b.agent_name, target_alias: b.target_alias, ...d });
  }

  return { format: FORMAT, review, activity, bindingReview, sources, receptorSources, bindingSources,
    content: { claims, archive, clinical, bindings } };
}

/** Lay the curator layer back over a seeded database. Idempotent: applying the same
 *  dump twice leaves the same state, so `npm run migrate` can run it every time. */
export function importState(db, state) {
  if (!state || state.format !== FORMAT) throw new Error(`unsupported curator-state format: ${state && state.format}`);
  const n = { review: 0, activity: 0, sources: 0, receptorSources: 0, bindingSources: 0, bindingReview: 0, content: 0 };

  const byKey = new Map(rows(db, 'SELECT * FROM sources').map(s => [sourceKey(s), s.id]));
  const insSource = db.prepare(`INSERT INTO sources (kind, authors, year, title, journal, pmid, doi, url, notes)
    VALUES (@kind, @authors, @year, @title, @journal, @pmid, @doi, @url, @notes)`);
  const updSource = db.prepare(`UPDATE sources SET kind=@kind, authors=@authors, year=@year, title=@title,
    journal=@journal, pmid=@pmid, doi=@doi, url=@url, notes=@notes WHERE id=@id`);

  db.transaction(() => {
    for (const s of state.sources || []) {
      const body = pick(s, SOURCE_COLS);
      const id = byKey.get(s.key);
      if (id == null) byKey.set(s.key, insSource.run(body).lastInsertRowid);
      else updSource.run({ ...body, id });
      n.sources++;
    }

    const rsStmt = db.prepare(`INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary, correction_note)
      VALUES (?,?,?,?,?) ON CONFLICT(receptor_id, source_id) DO UPDATE SET
      status = excluded.status, is_primary = excluded.is_primary, correction_note = excluded.correction_note`);
    for (const e of state.receptorSources || []) {
      const sid = byKey.get(e.source); if (sid == null) continue;   // source we cannot resolve: skip, never guess
      rsStmt.run(e.receptor_id, sid, e.status, e.is_primary ? 1 : 0, e.correction_note ?? null); n.receptorSources++;
    }

    const bsStmt = db.prepare(`INSERT INTO binding_sources (agent_name, target_alias, source_id, status)
      VALUES (?,?,?,?) ON CONFLICT(agent_name, target_alias, source_id) DO UPDATE SET status = excluded.status`);
    for (const e of state.bindingSources || []) {
      const sid = byKey.get(e.source); if (sid == null) continue;
      bsStmt.run(e.agent_name, e.target_alias, sid, e.status); n.bindingSources++;
    }

    const rvStmt = db.prepare(`INSERT INTO review_state (receptor_id, mechanism, affinity, clinical, citation, mastery, note)
      VALUES (@id,@mechanism,@affinity,@clinical,@citation,@mastery,@note) ON CONFLICT(receptor_id) DO UPDATE SET
      mechanism=excluded.mechanism, affinity=excluded.affinity, clinical=excluded.clinical,
      citation=excluded.citation, mastery=excluded.mastery, note=excluded.note`);
    for (const [id, r] of Object.entries(state.review || {})) { rvStmt.run({ id, ...r }); n.review++; }

    const saStmt = db.prepare(`INSERT INTO section_activity (receptor_id, volume, last_edited_at, last_reviewed_at)
      VALUES (?,?,?,?) ON CONFLICT(receptor_id, volume) DO UPDATE SET
      last_edited_at = excluded.last_edited_at, last_reviewed_at = excluded.last_reviewed_at`);
    for (const a of state.activity || []) { saStmt.run(a.receptor_id, a.volume, a.last_edited_at, a.last_reviewed_at); n.activity++; }

    const brStmt = db.prepare(`INSERT INTO binding_review (agent_name, target_alias, value_status)
      VALUES (?,?,?) ON CONFLICT(agent_name, target_alias) DO UPDATE SET value_status = excluded.value_status`);
    for (const b of state.bindingReview || []) { brStmt.run(b.agent_name, b.target_alias, b.value_status); n.bindingReview++; }

    const c = state.content || {};
    const clmStmt = db.prepare(`INSERT INTO claims (receptor_id, text) VALUES (?,?)
      ON CONFLICT(receptor_id) DO UPDATE SET text = excluded.text`);
    for (const [id, text] of Object.entries(c.claims || {})) { clmStmt.run(id, text); n.content++; }

    for (const [id, d] of Object.entries(c.archive || {})) {
      const cols = Object.keys(d).filter(k => ARCHIVE_COLS.includes(k)); if (!cols.length) continue;
      db.prepare(`UPDATE archive_entries SET ${cols.map(k => `${k}=@${k}`).join(', ')} WHERE receptor_id=@id`).run({ ...d, id });
      n.content++;
    }
    for (const [no, d] of Object.entries(c.clinical || {})) {
      const cols = Object.keys(d).filter(k => CLINICAL_COLS.includes(k)); if (!cols.length) continue;
      db.prepare(`UPDATE clinical_rows SET ${cols.map(k => `${k}=@${k}`).join(', ')} WHERE no=@no`).run({ ...d, no: Number(no) });
      n.content++;
    }
    for (const b of c.bindings || []) {
      const cols = Object.keys(b).filter(k => BINDING_COLS.includes(k)); if (!cols.length) continue;
      db.prepare(`UPDATE binding_values SET ${cols.map(k => `${k}=@${k}`).join(', ')}
        WHERE agent_name=@agent_name AND target_alias=@target_alias`).run({ ...b });
      n.content++;
    }
  })();

  return n;
}

/** True when the dump on disk already matches the database, so a no-op save does
 *  not rewrite the file and show up as a phantom change in `git status`. */
export function writeState(db, file = STATE_FILE) {
  const state = exportState(db);
  const text = JSON.stringify(state, null, 1) + '\n';
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return { written: false, state };
  writeFileSync(file, text);
  return { written: true, state };
}
export function readState(file = STATE_FILE) {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

const count = s => Object.values(s).reduce((a, b) => a + b, 0);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (mode === 'export') {
    const { written, state } = writeState(openDb());
    const parts = [
      `${Object.keys(state.review).length} reviewed`,
      `${state.receptorSources.length} receptor citations`,
      `${state.bindingSources.length} binding citations`,
      `${state.sources.length} sources`,
      `${Object.keys(state.content.claims).length + Object.keys(state.content.archive).length
        + Object.keys(state.content.clinical).length + state.content.bindings.length} content edits`,
    ];
    console.log(written ? `wrote db/curator-state.json: ${parts.join(', ')}` : 'db/curator-state.json already matches the database');
  } else if (mode === 'import') {
    const state = readState();
    if (!state) { console.log('no db/curator-state.json to import'); process.exit(0); }
    const db = openDb();

    // This runs on every `npm run migrate`, including against a database that
    // already holds work. Overwriting live edits with a dump that happens to be
    // older is the one way this feature could destroy the thing it exists to
    // protect, so it only applies to a database with nothing of its own to lose.
    const live = exportState(db);
    const hasWork = count({
      r: Object.keys(live.review).length, s: live.sources.length,
      rs: live.receptorSources.length, bs: live.bindingSources.length,
      br: live.bindingReview.length,
      c: Object.keys(live.content.claims).length + Object.keys(live.content.archive).length
        + Object.keys(live.content.clinical).length + live.content.bindings.length,
    }) > 0;
    const force = process.argv.includes('--force');
    if (hasWork && !force && JSON.stringify(live) !== JSON.stringify(state)) {
      console.log('db/atlas.db already holds curator work that differs from the dump; leaving it alone.');
      console.log('  to overwrite the database from the file:  node scripts/curator-state.mjs import --force');
      console.log('  to overwrite the file from the database:  node scripts/curator-state.mjs export');
      process.exit(0);
    }
    const n = importState(db, state);
    console.log(`applied ${count(n)} curator records: ${JSON.stringify(n)}`);
  } else {
    console.error('usage: curator-state.mjs <export|import>');
    process.exit(1);
  }
}
