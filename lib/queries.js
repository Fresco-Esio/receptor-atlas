// Shared read queries used by routes and exercised directly in unit tests.

/**
 * Review drift (Task 16): every section whose structured data was edited after it
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
