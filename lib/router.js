// Returns the API route table. `db` is wired in so each route handler can close
// over the database connection. All queries are parameterized (`?`) — never
// string-interpolated — so the :id / :volume path segments cannot inject SQL.

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Shape a joined source row into the citation object, or null when the receptor
// has no linked source. `journal` is omitted for the atlas volume payload.
function shapeSource(row, { journal = true } = {}) {
  if (row.source_id == null) return null;
  const s = { authors: row.authors, year: row.year, title: row.title };
  if (journal) s.journal = row.journal;
  s.pmid = row.pmid;
  s.doi = row.doi;
  return s;
}

export function apiRoutes(db) {
  // Task 4: registry list.
  const listStmt = db.prepare(`
    SELECT r.id, r.label, r.system, r.hall, r.sort_order,
           COALESCE(rs.status,'needs-source') AS status,
           (rv.mechanism + rv.affinity + rv.clinical + rv.citation) AS checks_done,
           rv.mastery
    FROM receptors r
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
    LEFT JOIN review_state rv ON rv.receptor_id = r.id
    ORDER BY r.sort_order
  `);

  // Task 5: fully joined detail (assembled from a few small queries).
  const detailStmt = db.prepare(`
    SELECT r.id, r.label, r.system, r.hall,
           COALESCE(rs.status,'needs-source') AS status,
           rs.source_id,
           s.authors, s.year, s.title, s.journal, s.pmid, s.doi
    FROM receptors r
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
    LEFT JOIN sources s ON s.id = rs.source_id
    WHERE r.id = ?
  `);
  const claimStmt = db.prepare(`SELECT text FROM claims WHERE receptor_id = ?`);
  const quizStmt = db.prepare(`SELECT prompt FROM quizzes WHERE receptor_id = ?`);
  const stahlStmt = db.prepare(`SELECT chapter FROM stahl_loci WHERE receptor_id = ? ORDER BY chapter`);
  const reviewStmt = db.prepare(`
    SELECT mechanism, affinity, clinical, citation, mastery, note
    FROM review_state WHERE receptor_id = ?
  `);

  // Task 6: receptors that appear in a given volume.
  const atlasStmt = db.prepare(`
    SELECT r.id, r.label,
           c.text AS claim,
           COALESCE(rs.status,'needs-source') AS status,
           rs.source_id,
           s.authors, s.year, s.title, s.pmid, s.doi
    FROM receptor_volumes v
    JOIN receptors r ON r.id = v.receptor_id
    LEFT JOIN claims c ON c.receptor_id = r.id
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
    LEFT JOIN sources s ON s.id = rs.source_id
    WHERE v.volume = ?
    ORDER BY r.sort_order
  `);

  return [
    {
      method: 'GET',
      pattern: /^\/api\/receptors$/,
      handler: (req, res) => {
        json(res, 200, listStmt.all());
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/receptors\/([\w-]+)$/,
      handler: (req, res, m) => {
        const id = m[1];
        const row = detailStmt.get(id);
        if (!row) return json(res, 404, { error: 'not found' });
        const claim = claimStmt.get(id);
        const quiz = quizStmt.get(id);
        const review = reviewStmt.get(id) || null;
        const stahl = stahlStmt.all(id).map(r => r.chapter);
        const source = shapeSource(row);
        json(res, 200, {
          id: row.id,
          label: row.label,
          system: row.system,
          hall: row.hall,
          claim: claim ? claim.text : null,
          quiz: quiz ? quiz.prompt : null,
          stahl,
          status: row.status,
          source,
          review,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/atlas\/(archive|cabinet|ledger)$/,
      handler: (req, res, m) => {
        const rows = atlasStmt.all(m[1]);
        const out = rows.map(row => ({
          id: row.id,
          label: row.label,
          claim: row.claim ?? null,
          status: row.status,
          source: shapeSource(row, { journal: false }),
        }));
        json(res, 200, out);
      },
    },
  ];
}
