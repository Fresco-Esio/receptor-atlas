// Shared read queries used by routes and exercised directly in unit tests.

/**
 * Roll up a receptor's per-source citation statuses into one overall status
 * (Citation/verification redesign). A receptor with no attached sources is
 * 'needs-source' — that state no longer lives on a per-source row, since every
 * attached source IS a source. A conflicting source wins outright, regardless
 * of the rest; otherwise all-verified rolls up to 'verified'; any other mix
 * (e.g. verified + provided) rolls up to 'provided' — carried, not fully checked.
 */
export function rollupStatus(statuses) {
  if (!statuses.length) return 'needs-source';
  if (statuses.includes('conflicting')) return 'conflicting';
  if (statuses.every(s => s === 'verified')) return 'verified';
  return 'provided';
}

/**
 * Every receptor's rolled-up citation status, keyed by receptor_id. Used by the
 * registry list endpoint, which needs one status per receptor without pulling
 * each receptor's full source list.
 */
export function receptorStatuses(db) {
  const rows = db.prepare('SELECT receptor_id, status FROM receptor_sources').all();
  const byReceptor = new Map();
  for (const r of rows) {
    if (!byReceptor.has(r.receptor_id)) byReceptor.set(r.receptor_id, []);
    byReceptor.get(r.receptor_id).push(r.status);
  }
  const out = new Map();
  for (const [id, statuses] of byReceptor) out.set(id, rollupStatus(statuses));
  return out;
}

/**
 * A receptor's full source list (Citation/verification redesign): every
 * attached source, each with its own status, whether it's the primary citation,
 * and any correction note — shaped for the desk's unified sources panel and the
 * receptor detail endpoint.
 */
export function receptorSources(db, receptorId) {
  return db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, s.notes,
           rs.status, rs.is_primary, rs.correction_note
    FROM receptor_sources rs
    JOIN sources s ON s.id = rs.source_id
    WHERE rs.receptor_id = ?
    ORDER BY rs.is_primary DESC, s.kind, s.year DESC
  `).all(receptorId).map(r => ({
    id: r.id, kind: r.kind, authors: r.authors, year: r.year, title: r.title,
    journal: r.journal, pmid: r.pmid, doi: r.doi, url: r.url, notes: r.notes,
    status: r.status, is_primary: !!r.is_primary, correction_note: r.correction_note,
  }));
}

/**
 * A single atlas volume (archive | cabinet | ledger) as the volume pages read it:
 * one row per receptor in the volume, carrying the volume's own alias, its claim,
 * rolled-up citation status, and the primary source shaped as a compact citation
 * (journal omitted, matching the volume payload). Shared by the /api/atlas/:volume
 * route and the static publish snapshot so both emit the exact same shape.
 */
export function atlasVolume(db, volume) {
  const rows = db.prepare(`
    SELECT r.id, r.label,
           c.text AS claim,
           rs.source_id, ra.alias,
           s.authors, s.year, s.title, s.pmid, s.doi
    FROM receptor_volumes v
    JOIN receptors r ON r.id = v.receptor_id
    LEFT JOIN claims c ON c.receptor_id = r.id
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id AND rs.is_primary = 1
    LEFT JOIN sources s ON s.id = rs.source_id
    LEFT JOIN receptor_aliases ra ON ra.receptor_id = r.id AND ra.volume = v.volume
    WHERE v.volume = ?
    ORDER BY r.sort_order
  `).all(volume);
  const statuses = receptorStatuses(db);
  return rows.map(row => ({
    id: row.id,
    alias: row.alias ?? null,
    label: row.label,
    claim: row.claim ?? null,
    status: statuses.get(row.id) || 'needs-source',
    source: row.source_id == null ? null : {
      id: row.source_id, authors: row.authors, year: row.year,
      title: row.title, pmid: row.pmid, doi: row.doi,
    },
  }));
}

/**
 * Reconstruct the Cabinet's AFF_AGENTS array from binding_values, in the
 * exact shape the volume's matrix/rose already consume: one object per agent with
 * a `b` map keyed by the Cabinet's own target id (target_alias).
 */
export function cabinetBinding(db) {
  const rows = db.prepare(`
    SELECT agent_name, agent_group, cid, target_alias, ki, ki_text, act, act_full, src, note,
           n, lo, hi, sub, nc, weak, act_src
    FROM binding_values ORDER BY agent_name, target_alias
  `).all();
  const byAgent = new Map();
  for (const r of rows) {
    if (!byAgent.has(r.agent_name)) byAgent.set(r.agent_name, { name: r.agent_name, g: r.agent_group, cid: r.cid, b: {} });
    const entry = { ki: r.ki, kiText: r.ki_text, act: r.act, actFull: r.act_full, src: r.src };
    // Optional, and omitted rather than sent as null: the plate treats a missing key as
    // "not recorded", and an explicit null would read as a recorded absence.
    if (r.note != null) entry.note = r.note;
    if (r.n != null) entry.n = r.n;
    if (r.lo != null) entry.lo = r.lo;
    if (r.hi != null) entry.hi = r.hi;
    if (r.sub != null) entry.sub = r.sub;
    if (r.nc != null) entry.nc = r.nc;
    if (r.weak != null) entry.weak = r.weak;
    if (r.act_src != null) entry.actSrc = r.act_src;
    byAgent.get(r.agent_name).b[r.target_alias] = entry;
  }
  return [...byAgent.values()];
}

/**
 * Drug-first binding provenance (binding-affinity provenance feature): one object per
 * agent, each with its bindings; each binding carries its attached library sources (with
 * per-edge status), a rolled-up citation status, the per-number value_status, and the
 * preserved as-imported `src` label. Joined on the STABLE (agent_name, target_alias) pair.
 */
export function agentBindingProvenance(db) {
  const rows = db.prepare(`
    SELECT bv.agent_name, bv.agent_group, bv.cid, bv.target_alias, bv.receptor_id,
           bv.ki, bv.ki_text, bv.act, bv.act_full, bv.src, bv.note,
           br.value_status
    FROM binding_values bv
    LEFT JOIN binding_review br
      ON br.agent_name = bv.agent_name AND br.target_alias = bv.target_alias
    ORDER BY bv.agent_name, bv.target_alias
  `).all();
  const edgeStmt = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
    WHERE bs.agent_name = ? AND bs.target_alias = ?
    ORDER BY s.kind, s.year DESC
  `);
  const byAgent = new Map();
  for (const r of rows) {
    if (!byAgent.has(r.agent_name))
      byAgent.set(r.agent_name, { name: r.agent_name, g: r.agent_group, cid: r.cid, bindings: [] });
    const sources = edgeStmt.all(r.agent_name, r.target_alias);
    byAgent.get(r.agent_name).bindings.push({
      target_alias: r.target_alias, receptor_id: r.receptor_id,
      ki: r.ki, ki_text: r.ki_text, act: r.act, act_full: r.act_full,
      src: r.src, note: r.note,
      value_status: r.value_status || 'unchecked',
      status: rollupStatus(sources.map(s => s.status)),
      sources,
    });
  }
  return [...byAgent.values()];
}

/**
 * Per-source binding usage (binding-affinity provenance feature): for every source cited
 * by at least one binding, its bibliographic fields plus the number of binding edges and
 * their rolled-up status. Powers the Desk's by-source bulk-verify panel.
 */
export function bindingSourceUsage(db) {
  const rows = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
  `).all();
  const bySource = new Map();
  for (const r of rows) {
    if (!bySource.has(r.id))
      bySource.set(r.id, { id: r.id, kind: r.kind, authors: r.authors, year: r.year, title: r.title,
                           journal: r.journal, pmid: r.pmid, doi: r.doi, url: r.url, statuses: [] });
    bySource.get(r.id).statuses.push(r.status);
  }
  return [...bySource.values()].map(({ statuses, ...s }) => ({
    ...s, count: statuses.length, status: rollupStatus(statuses),
  }));
}

/**
 * Reconstruct the Ledger's DATA rows from clinical_rows, list fields parsed
 * back to arrays. Citations are supplied separately by /api/atlas/ledger.
 */
export function ledgerClinical(db) {
  return db.prepare('SELECT * FROM clinical_rows ORDER BY no').all().map(r => ({
    no: r.no, sys: r.sys, name: r.name, cls: r.cls, baseline: r.baseline, mech: r.mech, stahl: r.stahl,
    over: JSON.parse(r.over_json || '[]'), under: JSON.parse(r.under_json || '[]'),
    agonists: JSON.parse(r.agonists_json || '[]'), antagonists: JSON.parse(r.antagonists_json || '[]'),
  }));
}

/**
 * The Archive's per-receptor narrative prose, shaped for the Archive page's render
 * (Archive content editing). `alias` is the entry number the page matches on.
 */
export function archiveNarrative(db) {
  return db.prepare(`
    SELECT ae.receptor_id, ra.alias, ae.abstract, ae.presentation, ae.effect,
           ae.receptor_class, ae.ligand, ae.figure_caption, ae.body_json, ae.tags_json
    FROM archive_entries ae
    LEFT JOIN receptor_aliases ra ON ra.receptor_id = ae.receptor_id AND ra.volume = 'archive'
    ORDER BY CAST(ra.alias AS INTEGER)
  `).all().map(r => ({
    receptor_id: r.receptor_id, alias: r.alias,
    abstract: r.abstract, presentation: r.presentation, effect: r.effect,
    receptor_class: r.receptor_class, ligand: r.ligand, figure_caption: r.figure_caption,
    body: JSON.parse(r.body_json || '[]'), tags: JSON.parse(r.tags_json || '[]'),
  }));
}

/**
 * Review drift: every section whose structured data was edited after it
 * was last reviewed — i.e. the review may now be stale. A section that was edited
 * but never reviewed (last_reviewed_at IS NULL) also counts. ISO-8601 timestamps
 * sort lexicographically, so a plain string compare is a correct time compare.
 */
export function reviewDrift(db) {
  return db.prepare(`
    SELECT sa.receptor_id, sa.volume, sa.last_edited_at, sa.last_reviewed_at, r.label
    FROM section_activity sa
    JOIN receptors r ON r.id = sa.receptor_id
    WHERE sa.last_edited_at IS NOT NULL
      AND (sa.last_reviewed_at IS NULL OR sa.last_edited_at > sa.last_reviewed_at)
    ORDER BY sa.last_edited_at DESC
  `).all();
}
