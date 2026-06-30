// Shared read queries used by routes and exercised directly in unit tests.

/**
 * Review drift (Task 16): every section whose structured data was edited after it
 * was last reviewed — i.e. the review may now be stale. A section that was edited
 * but never reviewed (last_reviewed_at IS NULL) also counts. ISO-8601 timestamps
 * sort lexicographically, so a plain string compare is a correct time compare.
 */
/**
 * Reconstruct the Cabinet's AFF_AGENTS array from binding_values (Task 19), in the
 * exact shape the volume's matrix/radar already consume: one object per agent with
 * a `b` map keyed by the Cabinet's own target id (target_alias).
 */
export function cabinetBinding(db) {
  const rows = db.prepare(`
    SELECT agent_name, agent_group, cid, target_alias, ki, ki_text, act, act_full, src, note
    FROM binding_values ORDER BY agent_name, target_alias
  `).all();
  const byAgent = new Map();
  for (const r of rows) {
    if (!byAgent.has(r.agent_name)) byAgent.set(r.agent_name, { name: r.agent_name, g: r.agent_group, cid: r.cid, b: {} });
    const entry = { ki: r.ki, kiText: r.ki_text, act: r.act, actFull: r.act_full, src: r.src };
    if (r.note != null) entry.note = r.note;
    byAgent.get(r.agent_name).b[r.target_alias] = entry;
  }
  return [...byAgent.values()];
}

/**
 * Reconstruct the Ledger's DATA rows from clinical_rows (Task 19), list fields parsed
 * back to arrays. Citations are supplied separately by /api/atlas/ledger (Task 13).
 */
export function ledgerClinical(db) {
  return db.prepare('SELECT * FROM clinical_rows ORDER BY no').all().map(r => ({
    no: r.no, sys: r.sys, name: r.name, cls: r.cls, baseline: r.baseline, mech: r.mech, stahl: r.stahl,
    over: JSON.parse(r.over_json || '[]'), under: JSON.parse(r.under_json || '[]'),
    agonists: JSON.parse(r.agonists_json || '[]'), antagonists: JSON.parse(r.antagonists_json || '[]'),
  }));
}

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
