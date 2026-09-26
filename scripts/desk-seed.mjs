// Build desk/seed.json: what the Atlas currently is, for the editable surface, plus the
// pristine values that surface is a delta from, plus the edits file it was built from.
// Two in-memory databases, never db/atlas.db: one seeded exactly as the Actions runner
// does (migrate + import), one seeded with nothing imported.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { importState, readState, sourceKey, SOURCE_COLS, ARCHIVE_COLS, CLINICAL_COLS } from './curator-state.mjs';
import { archiveNarrative, ledgerClinical } from '../lib/queries.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SEED_FILE = join(HERE, '..', 'desk', 'seed.json');
const REVIEW_COLS = ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note'];
const pick = (row, cols) => Object.fromEntries(cols.map(c => [c, row[c] ?? null]));
const list = s => JSON.parse(s || '[]');

function freshDb(baseState) { const db = openDb(':memory:'); migrate(db); if (baseState) importState(db, baseState); return db; }

function receptorsOf(db) {
  const bySource = new Map(db.prepare('SELECT * FROM sources').all().map(s => [s.id, s]));
  const narrative = new Map(archiveNarrative(db).map(r => [r.receptor_id, r]));
  const clinical = new Map(ledgerClinical(db).map(r => [r.no, r]));
  const synd = new Map(db.prepare('SELECT no, onset, time_course, risk_factors_json, monitoring_json FROM clinical_rows').all().map(r => [r.no, r]));
  const clinicalNo = new Map(db.prepare('SELECT no, receptor_id FROM clinical_rows').all().map(r => [r.receptor_id, r.no]));
  const volumes = db.prepare('SELECT receptor_id, volume FROM receptor_volumes ORDER BY receptor_id, volume').all();
  const claims = new Map(db.prepare('SELECT receptor_id, text FROM claims').all().map(c => [c.receptor_id, c.text]));
  const reviews = new Map(db.prepare('SELECT * FROM review_state').all().map(r => [r.receptor_id, r]));
  const activity = db.prepare('SELECT receptor_id, volume, last_edited_at, last_reviewed_at FROM section_activity').all();
  const edges = db.prepare('SELECT * FROM receptor_sources ORDER BY rowid').all();
  return db.prepare('SELECT id, label, system, hall FROM receptors ORDER BY sort_order, id').all().map(r => {
    const n = narrative.get(r.id); const no = clinicalNo.get(r.id) ?? null; const c = no != null ? clinical.get(no) : null; const s = no != null ? synd.get(no) : null;
    const rv = reviews.get(r.id) || {};
    return {
      id: r.id, label: r.label, system: r.system, hall: r.hall,
      volumes: volumes.filter(v => v.receptor_id === r.id).map(v => v.volume),
      archiveAlias: n ? n.alias : null, clinicalNo: no,
      archive: n ? { abstract: n.abstract, presentation: n.presentation, effect: n.effect, receptor_class: n.receptor_class, ligand: n.ligand, figure_caption: n.figure_caption, body: n.body, tags: n.tags } : null,
      claim: claims.get(r.id) ?? null,
      clinical: c ? { no: c.no, sys: c.sys, name: c.name, cls: c.cls, baseline: c.baseline, mech: c.mech, stahl: c.stahl, over: c.over, under: c.under, agonists: c.agonists, antagonists: c.antagonists,
        onset: s.onset ?? null, time_course: s.time_course ?? null, risk_factors: list(s.risk_factors_json), monitoring: list(s.monitoring_json) } : null,
      sources: edges.filter(e => e.receptor_id === r.id).map(e => ({ key: sourceKey(bySource.get(e.source_id)), is_primary: e.is_primary ? 1 : 0, status: e.status, correction_note: e.correction_note ?? null })),
      review: { mechanism: rv.mechanism | 0, affinity: rv.affinity | 0, clinical: rv.clinical | 0, citation: rv.citation | 0, mastery: rv.mastery | 0, note: rv.note || '' },
      activity: activity.filter(a => a.receptor_id === r.id).map(a => ({ volume: a.volume, last_edited_at: a.last_edited_at, last_reviewed_at: a.last_reviewed_at })),
    };
  });
}

function pristineOf(db) {
  const bySource = new Map(db.prepare('SELECT * FROM sources').all().map(s => [s.id, s]));
  const archive = {}, clinical = {}, claims = {}, review = {}, receptorSources = {}, sources = {};
  for (const a of db.prepare('SELECT * FROM archive_entries').all()) archive[a.receptor_id] = pick(a, ARCHIVE_COLS);
  for (const c of db.prepare('SELECT * FROM clinical_rows').all()) clinical[c.no] = pick(c, CLINICAL_COLS);
  for (const c of db.prepare('SELECT * FROM claims').all()) claims[c.receptor_id] = c.text;
  for (const r of db.prepare('SELECT * FROM review_state').all()) review[r.receptor_id] = { mechanism: r.mechanism | 0, affinity: r.affinity | 0, clinical: r.clinical | 0, citation: r.citation | 0, mastery: r.mastery | 0, note: r.note || '' };
  for (const e of db.prepare('SELECT * FROM receptor_sources').all()) receptorSources[`${e.receptor_id}|${sourceKey(bySource.get(e.source_id))}`] = { status: e.status, is_primary: e.is_primary ? 1 : 0, correction_note: e.correction_note ?? null };
  for (const s of bySource.values()) sources[sourceKey(s)] = pick(s, SOURCE_COLS);
  return { archive, claims, clinical, review, receptorSources, sources };
}

export function buildSeed({ baseState, commit, builtAt = new Date().toISOString() }) {
  const current = freshDb(baseState), pristine = freshDb(null);
  const library = {};
  for (const s of current.prepare('SELECT * FROM sources').all()) library[sourceKey(s)] = pick(s, SOURCE_COLS);
  const seed = { format: 1, builtAt, commit, baseState, receptors: receptorsOf(current), pristine: pristineOf(pristine), sources: library };
  current.close(); pristine.close();
  return seed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseState = readState() || { format: 1, review: {}, activity: [], bindingReview: [], sources: [], receptorSources: [], bindingSources: [], content: { claims: {}, archive: {}, clinical: {}, bindings: [] } };
  let commit = 'uncommitted';
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: join(HERE, '..'), encoding: 'utf8' }).trim(); } catch {}
  const seed = buildSeed({ baseState, commit });
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 1) + '\n');
  console.log(`wrote desk/seed.json: ${seed.receptors.length} receptors, ${Object.keys(seed.sources).length} sources, from ${commit}`);
}
