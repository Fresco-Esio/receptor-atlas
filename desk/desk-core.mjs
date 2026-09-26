// The Desk's logic with nothing attached to it: no DOM, no node: imports, so the same
// file runs in the page and in scripts/desk-pull.mjs. Everything here is a pure function
// over plain objects; the page and the scripts own the side effects.
export const FORMAT = 1;
export const ARCHIVE_SCALAR = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption'];
export const ARCHIVE_LIST = { body: 'body_json', tags: 'tags_json' };
export const ARCHIVE_COLS = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption', 'body_json', 'tags_json'];
export const CLINICAL_SCALAR = ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'onset', 'time_course'];
export const CLINICAL_LIST = { over: 'over_json', under: 'under_json', agonists: 'agonists_json', antagonists: 'antagonists_json', risk_factors: 'risk_factors_json', monitoring: 'monitoring_json' };
export const CLINICAL_COLS = ['sys', 'name', 'cls', 'baseline', 'mech', 'over_json', 'under_json', 'stahl', 'agonists_json', 'antagonists_json', 'onset', 'time_course', 'risk_factors_json', 'monitoring_json'];
export const SOURCE_COLS = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
export const REVIEW_COLS = ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note'];
export const REVIEW_MARKS = ['mechanism', 'affinity', 'clinical'];
const VOLUMES = ['archive', 'cabinet', 'ledger'];

const clone = o => JSON.parse(JSON.stringify(o));

/** Same rule as scripts/curator-state.mjs sourceKey(): identify a paper by what identifies it in the world. */
export function sourceKey(s) {
  if (s.pmid) return `pmid:${String(s.pmid).trim()}`;
  if (s.doi) return `doi:${String(s.doi).trim().toLowerCase()}`;
  if (s.url) return `url:${String(s.url).trim()}`;
  return `cite:${[s.kind, s.authors, s.year, s.title].map(v => String(v ?? '').trim()).join('|')}`;
}

export function emptyChanges(receptorId, seedCommit) {
  return { receptorId, seedCommit, fields: {}, sources: { add: [], remove: [], set: {} }, library: {}, spans: [], review: null };
}

export function setField(changes, path, value, at) {
  if (path !== 'claim' && !path.startsWith('archive.') && !path.startsWith('clinical.')) throw new Error('unknown field path: ' + path);
  const c = clone(changes);
  c.fields[path] = { value: Array.isArray(value) ? [...value] : value, at, publishedAs: null };
  return c;
}

/** Drop a field's change record (the page's "back to the seed value") and any spans on that field. */
export function clearField(changes, path) {
  const c = clone(changes);
  delete c.fields[path];
  c.spans = (c.spans || []).filter(sp => !(sp.field === path || (typeof sp.field === 'string' && sp.field.startsWith(path + '.'))));
  return c;
}

const seededSource = (seedReceptor, key) => (seedReceptor.sources || []).some(s => s.key === key);
const seedReceptorOf = (seed, id) => seed.receptors.find(r => r.id === id);
/** Was this key explicitly passed? Distinguishes "clear it to null" from "leave it alone" —
 *  `??` treats an explicit null the same as absent, which silently un-does a cleared flag. */
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** meta: SOURCE_COLS object for a new paper (the library row). flags: { is_primary, conflicting, correction_note }. */
export function attachSource(changes, seed, meta, flags, at) {
  const c = clone(changes); const key = sourceKey(meta);
  const r = seedReceptorOf(seed, c.receptorId);
  if (seededSource(r, key) || c.sources.add.some(s => s.key === key)) throw new Error('already attached');
  if (!seed.sources[key]) c.library[key] = Object.fromEntries(SOURCE_COLS.map(k => [k, meta[k] ?? null]));
  c.sources.add.push({ key, is_primary: flags.is_primary ? 1 : 0, conflicting: !!flags.conflicting, correction_note: flags.correction_note ?? null, at, publishedAs: null });
  return c;
}

export function detachSource(changes, seed, key, at) {
  const c = clone(changes);
  const i = c.sources.add.findIndex(s => s.key === key);
  if (i < 0) {
    const r = seedReceptorOf(seed, c.receptorId);
    if (r && seededSource(r, key)) throw new Error('seeded source: flag it as conflicting instead');
    throw new Error('unknown source: ' + key);
  }
  c.sources.add.splice(i, 1); delete c.library[key]; delete c.sources.set[key];
  c.spans = c.spans.filter(sp => sp.sourceKey !== key);
  return c;
}

/** A flag counts as "set by the caller" only when it isn't undefined — `{ is_primary: undefined }`
 *  leaves the stored value alone, while an explicit `null` (correction_note) still clears it. */
const given = (flags, k) => flags[k] !== undefined;

export function setSourceFlags(changes, seed, key, flags, at) {
  const c = clone(changes);
  const added = c.sources.add.find(s => s.key === key);
  if (added) { Object.assign(added, { is_primary: given(flags, 'is_primary') ? flags.is_primary : added.is_primary, conflicting: given(flags, 'conflicting') ? flags.conflicting : added.conflicting, correction_note: given(flags, 'correction_note') ? flags.correction_note : added.correction_note, at, publishedAs: null }); return c; }
  const r = seedReceptorOf(seed, c.receptorId);
  const seeded = (r.sources || []).find(s => s.key === key);
  if (!seeded) throw new Error('unknown source');
  // conflicting stays undefined until the caller gives it: an untouched flag keeps the seed's own status (see edgeStatus)
  const prev = c.sources.set[key] || { is_primary: seeded.is_primary, conflicting: undefined, correction_note: seeded.correction_note };
  c.sources.set[key] = { is_primary: given(flags, 'is_primary') ? flags.is_primary : prev.is_primary, conflicting: given(flags, 'conflicting') ? flags.conflicting : prev.conflicting, correction_note: given(flags, 'correction_note') ? flags.correction_note : prev.correction_note, at, publishedAs: null };
  return c;
}

/** The status of a SEEDED edge under a sources.set record: conflicting given true → 'conflicting'; given false
 *  on an edge the seed has as 'conflicting' → 'verified' (clearing a conflict asserts the source agrees);
 *  never given (undefined), or false on any other edge → the seed's own status ('provided' stays 'provided'). */
export function edgeStatus(seedStatus, set) {
  if (!set || set.conflicting === undefined || set.conflicting === null) return seedStatus;
  if (set.conflicting) return 'conflicting';
  return seedStatus === 'conflicting' ? 'verified' : seedStatus;
}

/** Stores only the keys the caller passed (plus at/publishedAs), merged over any previously
 *  stored partial — a partial update must not erase marks or the note set earlier. */
export function setReview(changes, marks, at) {
  const c = clone(changes);
  c.review = { ...(c.review || {}), ...marks, at, publishedAs: null };
  return c;
}

/** The receptor as the page should show it: seed with every change laid over it. */
export function viewOf(seedReceptor, changes) {
  const v = clone(seedReceptor);
  for (const [path, f] of Object.entries(changes.fields)) {
    const val = Array.isArray(f.value) ? [...f.value] : f.value;
    if (path === 'claim') v.claim = val;
    else { const [vol, field] = path.split('.'); if (!v[vol]) v[vol] = {}; v[vol][field] = val; }
  }
  const sources = (v.sources || []).map(s => {
    const set = changes.sources.set[s.key];
    return set ? { ...s, is_primary: set.is_primary, status: edgeStatus(s.status, set), correction_note: set.correction_note } : s;
  });
  for (const a of changes.sources.add) sources.push({ key: a.key, is_primary: a.is_primary, status: a.conflicting ? 'conflicting' : 'verified', correction_note: a.correction_note, added: true });
  v.sources = sources;
  if (changes.review) {
    const base = v.review || { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' };
    v.review = {
      ...base,
      mechanism: has(changes.review, 'mechanism') ? changes.review.mechanism : base.mechanism,
      affinity: has(changes.review, 'affinity') ? changes.review.affinity : base.affinity,
      clinical: has(changes.review, 'clinical') ? changes.review.clinical : base.clinical,
      note: has(changes.review, 'note') ? changes.review.note : base.note,
    };
  }
  return v;
}

const eq = (a, b) => (a ?? null) === (b ?? null);
/** A list column: the router writes '[]' for an empty list, and a pristine null is also "no items". */
const eqList = (raw, pristine) => eq(raw, pristine) || (raw === '[]' && pristine == null);
const pickOrdered = (obj, cols) => Object.fromEntries(cols.filter(k => k in obj).map(k => [k, obj[k]]));

/** changes (one per receptor) → a format-1 edits file, a delta from the pristine seed. */
export function toCuratorState(seed, changesList) {
  const out = clone(seed.baseState);
  out.content = out.content || { claims: {}, archive: {}, clinical: {}, bindings: [] };
  const P = seed.pristine;
  const upsertEdge = (edge) => { const i = out.receptorSources.findIndex(e => e.receptor_id === edge.receptor_id && e.source === edge.source); if (i < 0) out.receptorSources.push(edge); else out.receptorSources[i] = edge; };
  const dropEdge = (id, key) => { out.receptorSources = out.receptorSources.filter(e => !(e.receptor_id === id && e.source === key)); };
  const upsertSource = (key, meta) => { const row = { key, ...pickOrdered(meta, SOURCE_COLS) }; const i = out.sources.findIndex(s => s.key === key); if (i < 0) out.sources.push(row); else out.sources[i] = row; };
  const dropSource = key => { out.sources = out.sources.filter(s => s.key !== key); };
  const stamp = (id, vol, edited, reviewed) => {
    let a = out.activity.find(x => x.receptor_id === id && x.volume === vol);
    if (!a) { a = { receptor_id: id, volume: vol, last_edited_at: null, last_reviewed_at: null }; out.activity.push(a); }
    if (edited && (!a.last_edited_at || edited > a.last_edited_at)) a.last_edited_at = edited;
    if (reviewed && (!a.last_reviewed_at || reviewed > a.last_reviewed_at)) a.last_reviewed_at = reviewed;
  };

  for (const c of changesList) {
    const id = c.receptorId; const r = seedReceptorOf(seed, id);
    if (!r) throw new Error('unknown receptor: ' + id);
    const no = r.clinicalNo;
    // --- content fields ---
    const arch = { ...(out.content.archive[id] || {}) }, clin = { ...(no != null ? out.content.clinical[no] || {} : {}) };
    for (const [path, f] of Object.entries(c.fields)) {
      if (path === 'claim') { if (eq(f.value, P.claims[id])) delete out.content.claims[id]; else out.content.claims[id] = f.value; stamp(id, 'cabinet', f.at); continue; }
      const [vol, field] = path.split('.');
      if (vol === 'archive') {
        const col = ARCHIVE_LIST[field] || field; const raw = ARCHIVE_LIST[field] ? JSON.stringify(f.value ?? []) : f.value;
        if ((ARCHIVE_LIST[field] ? eqList : eq)(raw, (P.archive[id] || {})[col])) delete arch[col]; else arch[col] = raw;
        stamp(id, 'archive', f.at);
      } else {
        if (no == null) throw new Error('receptor has no Ledger row: ' + id);
        const col = CLINICAL_LIST[field] || field; const raw = CLINICAL_LIST[field] ? JSON.stringify(f.value ?? []) : f.value;
        if ((CLINICAL_LIST[field] ? eqList : eq)(raw, (P.clinical[no] || {})[col])) delete clin[col]; else clin[col] = raw;
        stamp(id, 'ledger', f.at);
      }
    }
    if (Object.keys(arch).length) out.content.archive[id] = pickOrdered(arch, ARCHIVE_COLS); else delete out.content.archive[id];
    if (no != null) { if (Object.keys(clin).length) out.content.clinical[no] = pickOrdered(clin, CLINICAL_COLS); else delete out.content.clinical[no]; }
    // --- sources ---
    for (const [key, meta] of Object.entries(c.library)) { const pr = P.sources[key]; if (pr && SOURCE_COLS.every(k => eq(meta[k], pr[k]))) dropSource(key); else upsertSource(key, meta); }
    for (const a of c.sources.add) { upsertEdge({ receptor_id: id, source: a.key, status: a.conflicting ? 'conflicting' : 'verified', is_primary: a.is_primary ? 1 : 0, correction_note: a.correction_note ?? null }); stamp(id, 'archive', a.at); }
    for (const [key, s] of Object.entries(c.sources.set)) {
      const pr = P.receptorSources[`${id}|${key}`];
      const seeded = (r.sources || []).find(x => x.key === key);
      const edge = { receptor_id: id, source: key, status: edgeStatus(seeded ? seeded.status : (pr ? pr.status : 'verified'), s), is_primary: s.is_primary ? 1 : 0, correction_note: s.correction_note ?? null };
      if (pr && pr.status === edge.status && (pr.is_primary ? 1 : 0) === edge.is_primary && eq(pr.correction_note, edge.correction_note)) dropEdge(id, key); else upsertEdge(edge);
      stamp(id, 'archive', s.at);
    }
    // --- review: only the keys the caller actually set override the base; citation/mastery
    // are Desk-only fields with no setter here, so they always come from the base. ---
    if (c.review) {
      const base = out.review[id] || P.review[id] || { mechanism: 0, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: '' };
      const rv = {
        mechanism: (has(c.review, 'mechanism') ? c.review.mechanism : base.mechanism) | 0,
        affinity: (has(c.review, 'affinity') ? c.review.affinity : base.affinity) | 0,
        clinical: (has(c.review, 'clinical') ? c.review.clinical : base.clinical) | 0,
        citation: base.citation | 0,
        mastery: base.mastery | 0,
        note: has(c.review, 'note') ? (c.review.note || '') : (base.note || ''),
      };
      if (!rv.mechanism && !rv.affinity && !rv.clinical && !rv.citation && !rv.mastery && !rv.note) delete out.review[id]; else out.review[id] = rv;
      for (const vol of r.volumes || VOLUMES) stamp(id, vol, null, c.review.at);
    }
  }
  return { format: FORMAT, review: out.review, activity: out.activity, bindingReview: out.bindingReview || [], sources: out.sources, receptorSources: out.receptorSources, bindingSources: out.bindingSources || [], content: { claims: out.content.claims, archive: out.content.archive, clinical: out.content.clinical, bindings: out.content.bindings || [] } };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** One line for the publish prompt. Counts unpublished records only. */
export function summarise(changesList) {
  let edits = 0, attached = 0, conflicts = 0, reviews = 0;
  for (const c of changesList) {
    edits += Object.values(c.fields).filter(f => !f.publishedAs).length;
    attached += c.sources.add.filter(a => !a.publishedAs).length;
    conflicts += Object.values(c.sources.set).filter(s => !s.publishedAs && s.conflicting).length + c.sources.add.filter(a => !a.publishedAs && a.conflicting).length;
    if (c.review && !c.review.publishedAs) reviews++;
  }
  const parts = [];
  if (edits) parts.push(plural(edits, 'content edit'));
  if (attached) parts.push(plural(attached, 'source') + ' attached');
  if (conflicts) parts.push(plural(conflicts, 'conflict') + ' noted');
  if (reviews) parts.push(plural(reviews, 'review') + ' updated');
  return parts.join(', ') || 'nothing to publish';
}

export function countUnpublished(changesList) {
  let n = 0;
  for (const c of changesList) {
    n += Object.values(c.fields).filter(f => !f.publishedAs).length + c.sources.add.filter(a => !a.publishedAs).length + Object.values(c.sources.set).filter(s => !s.publishedAs).length + (c.review && !c.review.publishedAs ? 1 : 0);
  }
  return n;
}

/** The mirror of countUnpublished: records already carried by a published edits file. */
export function countPublished(changesList) {
  let n = 0;
  for (const c of changesList) {
    n += Object.values(c.fields).filter(f => f.publishedAs).length + c.sources.add.filter(a => a.publishedAs).length + Object.values(c.sources.set).filter(s => s.publishedAs).length + (c.review && c.review.publishedAs ? 1 : 0);
  }
  return n;
}

export function markPublished(changes, sha) {
  const c = clone(changes);
  for (const f of Object.values(c.fields)) if (!f.publishedAs) f.publishedAs = sha;
  for (const a of c.sources.add) if (!a.publishedAs) a.publishedAs = sha;
  for (const s of Object.values(c.sources.set)) if (!s.publishedAs) s.publishedAs = sha;
  if (c.review && !c.review.publishedAs) c.review.publishedAs = sha;
  return c;
}

/** Only what a publish has already carried: the records with a publishedAs (and the library rows of the
 *  published adds). desk:pull converts this to recognise "the repo's edits file is what this Desk published". */
export function publishedOnly(changes) {
  const c = clone(changes);
  const out = emptyChanges(c.receptorId, c.seedCommit);
  for (const [k, f] of Object.entries(c.fields || {})) if (f.publishedAs) out.fields[k] = f;
  const src = c.sources || {};
  out.sources.add = (src.add || []).filter(a => a.publishedAs);
  out.sources.remove = (src.remove || []).filter(r => r.publishedAs);
  for (const [k, s] of Object.entries(src.set || {})) if (s.publishedAs) out.sources.set[k] = s;
  for (const a of out.sources.add) if (c.library && c.library[a.key]) out.library[a.key] = c.library[a.key];
  out.review = c.review && c.review.publishedAs ? c.review : null;
  return out;
}

/** After a re-seed: published records are now in the seed, so drop them; keep the rest against the new commit. */
export function rekey(changes, newSeed) {
  const c = clone(changes); c.seedCommit = newSeed.commit;
  for (const [k, f] of Object.entries(c.fields)) if (f.publishedAs) delete c.fields[k];
  c.sources.add = c.sources.add.filter(a => !a.publishedAs);
  for (const [k, s] of Object.entries(c.sources.set)) if (s.publishedAs) delete c.sources.set[k];
  for (const k of Object.keys(c.library)) if (!c.sources.add.some(a => a.key === k)) delete c.library[k];
  if (c.review && c.review.publishedAs) c.review = null;
  return c;
}
