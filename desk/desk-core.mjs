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

/** The last published state behind a record: the record itself when it is published (without any
 *  predecessor of its own), else the predecessor it already carries, else null. A record that overwrites a
 *  published one keeps this under `published`, so publishedOnly can still say what the repo file holds. */
function predecessorOf(rec) {
  if (!rec) return null;
  if (rec.publishedAs) { const { published: _p, ...own } = rec; return clone(own); }
  return rec.published ? clone(rec.published) : null;
}
const withPredecessor = (rec, pred) => { if (pred) rec.published = pred; else delete rec.published; return rec; };

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
  c.fields[path] = withPredecessor({ value: Array.isArray(value) ? [...value] : value, at, publishedAs: null }, predecessorOf(c.fields[path]));
  return c;
}

/** "Back to the seed value" for one field, and drop any spans on it. A record with no published state
 *  behind it is simply deleted; otherwise it becomes a tombstone { cleared: true, at, publishedAs: null,
 *  published }, because the repo's edits file carries the published value and the next publish has to
 *  take it back out. */
export function clearField(changes, path, at = null) {
  const c = clone(changes);
  const pred = predecessorOf(c.fields[path]);
  if (pred) c.fields[path] = { cleared: true, at, publishedAs: null, published: pred };
  else delete c.fields[path];
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
  // attached again after a detach: the remove goes, and whatever was published behind it stays behind the add
  const removed = (c.sources.remove || []).find(x => x.key === key);
  c.sources.remove = (c.sources.remove || []).filter(x => x.key !== key);
  if (!seed.sources[key]) c.library[key] = Object.fromEntries(SOURCE_COLS.map(k => [k, meta[k] ?? null]));
  c.sources.add.push(withPredecessor({ key, is_primary: flags.is_primary ? 1 : 0, conflicting: !!flags.conflicting, correction_note: flags.correction_note ?? null, at, publishedAs: null }, predecessorOf(removed)));
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
  const [gone] = c.sources.add.splice(i, 1); delete c.sources.set[key];
  // An add with a published state behind it is in the repo's edits file: record the detach (with that state,
  // and its library row, which the converter drops once nothing cites it) so the next publish takes it out.
  const pred = predecessorOf(gone);
  if (pred) (c.sources.remove = c.sources.remove || []).push({ key, at, publishedAs: null, published: pred });
  else delete c.library[key];
  c.spans = c.spans.filter(sp => sp.sourceKey !== key);
  return c;
}

/** A flag counts as "set by the caller" only when it isn't undefined — `{ is_primary: undefined }`
 *  leaves the stored value alone, while an explicit `null` (correction_note) still clears it. */
const given = (flags, k) => flags[k] !== undefined;

export function setSourceFlags(changes, seed, key, flags, at) {
  const c = clone(changes);
  const added = c.sources.add.find(s => s.key === key);
  if (added) { const pred = predecessorOf(added); withPredecessor(Object.assign(added, { is_primary: given(flags, 'is_primary') ? flags.is_primary : added.is_primary, conflicting: given(flags, 'conflicting') ? flags.conflicting : added.conflicting, correction_note: given(flags, 'correction_note') ? flags.correction_note : added.correction_note, at, publishedAs: null }), pred); return c; }
  const r = seedReceptorOf(seed, c.receptorId);
  const seeded = (r.sources || []).find(s => s.key === key);
  if (!seeded) throw new Error('unknown source');
  // conflicting stays undefined until the caller gives it: an untouched flag keeps the seed's own status (see edgeStatus)
  const cur = c.sources.set[key];   // a cleared set record (a re-created revert) is the seed's own flags
  const prev = cur && !cur.cleared ? cur : { is_primary: seeded.is_primary, conflicting: undefined, correction_note: seeded.correction_note };
  const pred = predecessorOf(c.sources.set[key]);
  c.sources.set[key] = withPredecessor({ is_primary: given(flags, 'is_primary') ? flags.is_primary : prev.is_primary, conflicting: given(flags, 'conflicting') ? flags.conflicting : prev.conflicting, correction_note: given(flags, 'correction_note') ? flags.correction_note : prev.correction_note, at, publishedAs: null }, pred);
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
  const pred = predecessorOf(c.review);
  const { cleared: _c, published: _p, ...before } = c.review && !c.review.cleared ? c.review : {};
  c.review = withPredecessor({ ...before, ...marks, at, publishedAs: null }, pred);
  return c;
}

/** The receptor as the page should show it: seed with every change laid over it. */
export function viewOf(seedReceptor, changes) {
  const v = clone(seedReceptor);
  for (const [path, f] of Object.entries(changes.fields)) {
    if (f.cleared) continue;   // a tombstone: the seed value shows
    const val = Array.isArray(f.value) ? [...f.value] : f.value;
    if (path === 'claim') v.claim = val;
    else { const [vol, field] = path.split('.'); if (!v[vol]) v[vol] = {}; v[vol][field] = val; }
  }
  const removed = new Set(((changes.sources || {}).remove || []).map(x => x.key));
  const sources = (v.sources || []).filter(s => !removed.has(s.key)).map(s => {
    const set = changes.sources.set[s.key];
    return set && !set.cleared ? { ...s, is_primary: set.is_primary, status: edgeStatus(s.status, set), correction_note: set.correction_note } : s;
  });
  for (const a of changes.sources.add) sources.push({ key: a.key, is_primary: a.is_primary, status: a.conflicting ? 'conflicting' : 'verified', correction_note: a.correction_note, added: true });
  v.sources = sources;
  if (changes.review && !changes.review.cleared) {
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

  const removedKeys = new Set();
  for (const c of changesList) {
    const id = c.receptorId; const r = seedReceptorOf(seed, id);
    if (!r) throw new Error('unknown receptor: ' + id);
    const no = r.clinicalNo;
    // --- content fields ---
    const arch = { ...(out.content.archive[id] || {}) }, clin = { ...(no != null ? out.content.clinical[no] || {} : {}) };
    for (const [path, f] of Object.entries(c.fields)) {
      // A tombstone is "back to the seed": out started as a copy of the seed's own edits file, so the
      // column is left as the seed has it; only the activity records that something was reverted.
      if (f.cleared) { stamp(id, path === 'claim' ? 'cabinet' : path.startsWith('archive.') ? 'archive' : 'ledger', f.at); continue; }
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
    for (const x of c.sources.remove || []) { dropEdge(id, x.key); removedKeys.add(x.key); stamp(id, 'archive', x.at); }
    for (const [key, s] of Object.entries(c.sources.set)) {
      if (s.cleared) { stamp(id, 'archive', s.at); continue; }   // back to the seed's edge: out already has it
      const pr = P.receptorSources[`${id}|${key}`];
      const seeded = (r.sources || []).find(x => x.key === key);
      const edge = { receptor_id: id, source: key, status: edgeStatus(seeded ? seeded.status : (pr ? pr.status : 'verified'), s), is_primary: s.is_primary ? 1 : 0, correction_note: s.correction_note ?? null };
      if (pr && pr.status === edge.status && (pr.is_primary ? 1 : 0) === edge.is_primary && eq(pr.correction_note, edge.correction_note)) dropEdge(id, key); else upsertEdge(edge);
      stamp(id, 'archive', s.at);
    }
    // --- review: only the keys the caller actually set override the base; citation/mastery
    // are Desk-only fields with no setter here, so they always come from the base. ---
    if (c.review && c.review.cleared) { for (const vol of r.volumes || VOLUMES) stamp(id, vol, null, c.review.at); }
    else if (c.review) {
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
  // A detached source's library row goes too, once nothing else cites it (after every receptor, so the
  // order of the list does not matter). A pristine row is not the Desk's to drop: there it is a metadata delta.
  for (const key of removedKeys) {
    if (!P.sources[key] && !out.receptorSources.some(e => e.source === key) && !(out.bindingSources || []).some(e => e.source === key)) dropSource(key);
  }
  return { format: FORMAT, review: out.review, activity: out.activity, bindingReview: out.bindingReview || [], sources: out.sources, receptorSources: out.receptorSources, bindingSources: out.bindingSources || [], content: { claims: out.content.claims, archive: out.content.archive, clinical: out.content.clinical, bindings: out.content.bindings || [] } };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** One line for the publish prompt. Counts unpublished records only. */
export function summarise(changesList) {
  let edits = 0, reverted = 0, attached = 0, detached = 0, conflicts = 0, reviews = 0;
  for (const c of changesList) {
    edits += Object.values(c.fields).filter(f => !f.publishedAs && !f.cleared).length;
    reverted += Object.values(c.fields).filter(f => !f.publishedAs && f.cleared).length;
    attached += c.sources.add.filter(a => !a.publishedAs).length;
    detached += (c.sources.remove || []).filter(x => !x.publishedAs).length;
    conflicts += Object.values(c.sources.set).filter(s => !s.publishedAs && s.conflicting).length + c.sources.add.filter(a => !a.publishedAs && a.conflicting).length;
    if (c.review && !c.review.publishedAs) reviews++;
  }
  const parts = [];
  if (edits) parts.push(plural(edits, 'content edit'));
  if (reverted) parts.push(plural(reverted, 'field') + ' reverted');
  if (attached) parts.push(plural(attached, 'source') + ' attached');
  if (detached) parts.push(plural(detached, 'source') + ' detached');
  if (conflicts) parts.push(plural(conflicts, 'conflict') + ' noted');
  if (reviews) parts.push(plural(reviews, 'review') + ' updated');
  return parts.join(', ') || 'nothing to publish';
}

/** Every record in one changes object (fields, tombstones, adds, removes, flags, review), for counting and marking. */
function records(c) {
  return [...Object.values(c.fields), ...c.sources.add, ...(c.sources.remove || []), ...Object.values(c.sources.set), ...(c.review ? [c.review] : [])];
}

export function countUnpublished(changesList) {
  let n = 0;
  for (const c of changesList) n += records(c).filter(r => !r.publishedAs).length;
  return n;
}

/** The mirror of countUnpublished: records already carried by a published edits file. */
export function countPublished(changesList) {
  let n = 0;
  for (const c of changesList) n += records(c).filter(r => r.publishedAs).length;
  return n;
}

export function markPublished(changes, sha) {
  const c = clone(changes);
  // a record marked published is now the published state: its predecessor goes
  const mark = r => { r.publishedAs = sha; delete r.published; };
  for (const f of Object.values(c.fields)) if (!f.publishedAs) mark(f);
  for (const a of c.sources.add) if (!a.publishedAs) mark(a);
  for (const x of c.sources.remove || []) if (!x.publishedAs) mark(x);
  for (const s of Object.values(c.sources.set)) if (!s.publishedAs) mark(s);
  if (c.review && !c.review.publishedAs) mark(c.review);
  return c;
}

/** JSON with object keys sorted, so two records compare equal whatever order a store gave their keys. */
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v === undefined ? null : v);
const sameRecord = (a, b) => { if (!a || !b) return false; const { publishedAs: _a, published: _c, ...x } = a, { publishedAs: _b, published: _d, ...y } = b; return stable(x) === stable(y); };

/** markPublished for a store that may have moved since the pull. `pulled` is the document as it was
 *  converted and committed, so each of its records is now what the repo holds. Per record of `current`:
 *  - deep-equal (publishedAs and predecessor aside) to its pulled counterpart: marked published with sha;
 *  - changed since the pull: stays unpublished, with the pulled record as its predecessor
 *    (`published = { ...pulled, publishedAs: sha }`);
 *  - pulled but gone from `current` (deleted before marking): re-created as the published form of "back to
 *    the seed" — a tombstone for a field, flag set or review, a sources.remove for an add — carrying the
 *    pulled record, so publishedOnly still reproduces the repo; stamped `at` (the marking time). */
export function markPublishedFrom(current, pulled, sha, at = new Date().toISOString()) {
  const c = clone(current);
  if (!pulled) return c;
  const p = clone(pulled), ps = p.sources || {};
  c.sources.remove = c.sources.remove || [];
  const mark = r => { r.publishedAs = sha; delete r.published; };   // it is now the published state
  const asPublished = r => { const { published: _p, ...own } = r; return { ...own, publishedAs: sha }; };
  const settle = (cur, pr) => {       // cur and pr both present
    if (cur.publishedAs) return;
    if (sameRecord(cur, pr)) mark(cur); else cur.published = asPublished(pr);
  };
  // a re-created revert is stamped with the marking time: it is newer than any copy of the pulled record
  // another view may still hold, so it wins mergeChanges' later-`at` rule
  const tombstone = pr => pr.cleared ? asPublished(pr) : { cleared: true, at, publishedAs: null, published: asPublished(pr) };
  // fields
  for (const [k, pr] of Object.entries(p.fields || {})) { if (c.fields[k]) settle(c.fields[k], pr); else c.fields[k] = tombstone(pr); }
  // a source's add or remove, one record per key
  const pulledEdges = [...(ps.add || []), ...(ps.remove || [])];
  for (const pr of pulledEdges) {
    const cur = c.sources.add.find(x => x.key === pr.key) || c.sources.remove.find(x => x.key === pr.key);
    if (cur) { settle(cur, pr); continue; }
    if ('is_primary' in pr) {            // an add, since deleted: a remove carrying it (and its library row)
      c.sources.remove.push({ key: pr.key, at, publishedAs: null, published: asPublished(pr) });
      if (p.library && p.library[pr.key] && !c.library[pr.key]) c.library[pr.key] = p.library[pr.key];
    } else c.sources.remove.push(asPublished(pr));
  }
  // flag sets
  for (const [k, pr] of Object.entries(ps.set || {})) { if (c.sources.set[k]) settle(c.sources.set[k], pr); else c.sources.set[k] = tombstone(pr); }
  // review
  if (p.review) { if (c.review) settle(c.review, p.review); else c.review = tombstone(p.review); }
  return c;
}

/** Only what a publish has already carried: per record, the record itself when published, else its
 *  `published` predecessor, else nothing (and the library rows of the adds that result). desk:pull converts
 *  this to recognise "the repo's edits file is what this Desk published". A source's add and remove are one
 *  record: whichever shape the published state has (an add carries is_primary) is where it goes. */
export function publishedOnly(changes) {
  const c = clone(changes);
  const out = emptyChanges(c.receptorId, c.seedCommit);
  const eff = r => !r ? null : r.publishedAs ? r : r.published || null;
  for (const [k, f] of Object.entries(c.fields || {})) { const e = eff(f); if (e) out.fields[k] = e; }
  const src = c.sources || {};
  for (const r of [...(src.add || []), ...(src.remove || [])]) {
    const e = eff(r); if (!e) continue;
    if ('is_primary' in e) out.sources.add.push({ ...e, key: r.key }); else out.sources.remove.push({ ...e, key: r.key });
  }
  for (const [k, s] of Object.entries(src.set || {})) { const e = eff(s); if (e) out.sources.set[k] = e; }
  for (const a of out.sources.add) if (c.library && c.library[a.key]) out.library[a.key] = c.library[a.key];
  out.review = eff(c.review);
  return out;
}

/** Two copies of one receptor's changes (this view's, and another view's from the store) as one. Per record
 *  (a field, a source add or remove, a flag set, the review) the one with the later `at` wins, ties to remote,
 *  and it keeps its own publishedAs; an add and a remove of the same source compete as one record. Spans
 *  are unioned by (field, start, sourceKey), remote's copy first; the library is unioned. */
export function mergeChanges(local, remote) {
  if (!local) return clone(remote);
  if (!remote) return clone(local);
  const L = clone(local), R = clone(remote);
  // The winner keeps its own predecessor. An unpublished winner with none takes the loser's published state
  // (the loser itself when published, else its predecessor): that is the same published state, which the
  // winner overwrote without having seen it.
  const pick = (l, r) => !l ? r : !r ? l : String(l.at || '') > String(r.at || '') ? l : r;
  // When both carry a published state, the later one (by that published record's own `at`) is kept.
  const later = (l, r) => {
    const w = pick(l, r); if (!w || !l || !r) return w;
    if (!w.publishedAs) {
      const p = predecessorOf(w === l ? r : l);
      if (p && (!w.published || String(p.at || '') > String(w.published.at || ''))) w.published = p;
    }
    return w;
  };
  const out = emptyChanges(R.receptorId ?? L.receptorId, R.seedCommit ?? L.seedCommit);
  const keysOf = (a, b) => [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])];
  for (const k of keysOf(L.fields, R.fields)) out.fields[k] = later((L.fields || {})[k], (R.fields || {})[k]);
  const edges = c => { const m = {}; const src = c.sources || {}; for (const a of src.add || []) m[a.key] = { kind: 'add', rec: a }; for (const x of src.remove || []) m[x.key] = { kind: 'remove', rec: x }; return m; };
  const le = edges(L), re = edges(R);
  for (const k of keysOf(le, re)) {
    const l = le[k], r = re[k];
    const w = !l ? r : !r ? l : pick(l.rec, r.rec) === l.rec ? l : r;
    if (l && r) later(l.rec, r.rec);   // only for the predecessor hand-over onto the winning record
    out.sources[w.kind].push(w.rec);
  }
  const ls = (L.sources || {}).set || {}, rs = (R.sources || {}).set || {};
  for (const k of keysOf(ls, rs)) out.sources.set[k] = later(ls[k], rs[k]);
  out.library = { ...(L.library || {}), ...(R.library || {}) };
  const spanKey = sp => `${sp.field}|${sp.start}|${sp.sourceKey}`;
  const seen = new Set((R.spans || []).map(spanKey));
  out.spans = [...(R.spans || []), ...(L.spans || []).filter(sp => !seen.has(spanKey(sp)))];
  out.review = L.review || R.review ? later(L.review, R.review) : null;
  return out;
}

/** After a re-seed: published records are now in the seed, so drop them; keep the rest against the new commit. */
export function rekey(changes, newSeed) {
  const c = clone(changes); c.seedCommit = newSeed.commit;
  for (const [k, f] of Object.entries(c.fields)) if (f.publishedAs) delete c.fields[k];
  c.sources.add = c.sources.add.filter(a => !a.publishedAs);
  c.sources.remove = (c.sources.remove || []).filter(x => !x.publishedAs);
  // what survives is unpublished; the published state behind it is in the new seed now
  for (const r of [...Object.values(c.fields), ...c.sources.add, ...c.sources.remove, ...Object.values(c.sources.set)]) delete r.published;
  if (c.review) delete c.review.published;
  for (const [k, s] of Object.entries(c.sources.set)) if (s.publishedAs) delete c.sources.set[k];
  for (const k of Object.keys(c.library)) if (!c.sources.add.some(a => a.key === k)) delete c.library[k];
  if (c.review && c.review.publishedAs) c.review = null;
  return c;
}
