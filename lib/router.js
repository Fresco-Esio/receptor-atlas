// Returns the API route table. `db` is wired in so each route handler can close
// over the database connection. All queries are parameterized (`?`) — never
// string-interpolated — so the :id / :volume path segments cannot inject SQL.

import { reviewDrift } from './queries.js';

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Read and parse a JSON request body. Rejects on malformed JSON; the handler
// turns that into a 400. Caps the body to guard against unbounded buffering.
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

// Shape a joined source row into the citation object, or null when the receptor
// has no linked source. `journal` is omitted for the atlas volume payload.
function shapeSource(row, { journal = true } = {}) {
  if (row.source_id == null) return null;
  const s = { id: row.source_id, authors: row.authors, year: row.year, title: row.title };
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
    SELECT r.id, r.label, r.system, r.hall, r.stahl_note,
           COALESCE(rs.status,'needs-source') AS status,
           rs.source_id, rs.correction_note, rs.search_query,
           s.authors, s.year, s.title, s.journal, s.pmid, s.doi
    FROM receptors r
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
    LEFT JOIN sources s ON s.id = rs.source_id
    WHERE r.id = ?
  `);
  const claimStmt = db.prepare(`SELECT text FROM claims WHERE receptor_id = ?`);
  const quizStmt = db.prepare(`SELECT prompt FROM quizzes WHERE receptor_id = ?`);
  const stahlStmt = db.prepare(`SELECT chapter FROM stahl_loci WHERE receptor_id = ? ORDER BY chapter`);
  const volStmt = db.prepare(`SELECT volume FROM receptor_volumes WHERE receptor_id = ? ORDER BY volume`);
  const reviewStmt = db.prepare(`
    SELECT mechanism, affinity, clinical, citation, mastery, note
    FROM review_state WHERE receptor_id = ?
  `);

  // Task 6: receptors that appear in a given volume.
  const atlasStmt = db.prepare(`
    SELECT r.id, r.label,
           c.text AS claim,
           COALESCE(rs.status,'needs-source') AS status,
           rs.source_id, ra.alias,
           s.authors, s.year, s.title, s.pmid, s.doi
    FROM receptor_volumes v
    JOIN receptors r ON r.id = v.receptor_id
    LEFT JOIN claims c ON c.receptor_id = r.id
    LEFT JOIN receptor_sources rs ON rs.receptor_id = r.id
    LEFT JOIN sources s ON s.id = rs.source_id
    LEFT JOIN receptor_aliases ra ON ra.receptor_id = r.id AND ra.volume = v.volume
    WHERE v.volume = ?
    ORDER BY r.sort_order
  `);

  // Task 9: sources library (read + write).
  const sourceCols = ['authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
  const listSourcesStmt = db.prepare(`
    SELECT id, authors, year, title, journal, pmid, doi, url, notes
    FROM sources ORDER BY year DESC, authors
  `);
  const getSourceStmt = db.prepare(`
    SELECT id, authors, year, title, journal, pmid, doi, url, notes
    FROM sources WHERE id = ?
  `);
  const insertSourceStmt = db.prepare(`
    INSERT INTO sources (authors, year, title, journal, pmid, doi, url, notes)
    VALUES (@authors, @year, @title, @journal, @pmid, @doi, @url, @notes)
  `);

  // Task 10: link a source to a receptor (upsert the single per-receptor row).
  const receptorExistsStmt = db.prepare(`SELECT 1 FROM receptors WHERE id = ?`);
  const upsertCitationStmt = db.prepare(`
    INSERT INTO receptor_sources (receptor_id, source_id, status)
    VALUES (?, ?, ?)
    ON CONFLICT(receptor_id) DO UPDATE SET
      source_id = excluded.source_id, status = excluded.status
  `);
  const getCitationStmt = db.prepare(`
    SELECT receptor_id, source_id, status, correction_note, search_query
    FROM receptor_sources WHERE receptor_id = ?
  `);
  const CITATION_STATUS = new Set(['verified', 'provided', 'conflicting', 'needs-source']);

  // Task 15: structured data (binding values, clinical row, claim) + activity.
  const VOLUMES = new Set(['archive', 'cabinet', 'ledger']);
  const bindingForReceptorStmt = db.prepare(`
    SELECT id, target_alias, agent_name, agent_group, cid, ki, ki_text, act, act_full, src, note
    FROM binding_values WHERE receptor_id = ? ORDER BY ki IS NULL, ki, agent_name
  `);
  const clinicalForReceptorStmt = db.prepare(`SELECT * FROM clinical_rows WHERE receptor_id = ?`);
  const activityForReceptorStmt = db.prepare(`
    SELECT volume, last_edited_at, last_reviewed_at FROM section_activity WHERE receptor_id = ?
  `);
  // Whitelisted, editable columns only — the request body never names a SQL column.
  const BINDING_FIELDS = ['ki', 'ki_text', 'act', 'act_full', 'src', 'note'];
  const CLINICAL_SCALAR = ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl'];
  const CLINICAL_LIST = { over: 'over_json', under: 'under_json', agonists: 'agonists_json', antagonists: 'antagonists_json' };
  const stampStmt = db.prepare(`
    INSERT INTO section_activity (receptor_id, volume, last_edited_at)
    VALUES (?, ?, ?)
    ON CONFLICT(receptor_id, volume) DO UPDATE SET last_edited_at = excluded.last_edited_at
  `);
  const upsertClaimStmt = db.prepare(`
    INSERT INTO claims (receptor_id, text) VALUES (?, ?)
    ON CONFLICT(receptor_id) DO UPDATE SET text = excluded.text
  `);

  function structuredFor(id) {
    const binding = bindingForReceptorStmt.all(id);
    const cRow = clinicalForReceptorStmt.get(id);
    const clinical = cRow ? {
      no: cRow.no, sys: cRow.sys, name: cRow.name, cls: cRow.cls,
      baseline: cRow.baseline, mech: cRow.mech, stahl: cRow.stahl,
      over: JSON.parse(cRow.over_json || '[]'), under: JSON.parse(cRow.under_json || '[]'),
      agonists: JSON.parse(cRow.agonists_json || '[]'), antagonists: JSON.parse(cRow.antagonists_json || '[]'),
    } : null;
    const claim = claimStmt.get(id);
    const activity = {};
    for (const a of activityForReceptorStmt.all(id))
      activity[a.volume] = { last_edited_at: a.last_edited_at, last_reviewed_at: a.last_reviewed_at };
    return { id, claim: claim ? claim.text : null, binding, clinical, activity };
  }

  // Task 11: persist review state (upsert by receptor_id).
  const reviewCols = ['mechanism', 'affinity', 'clinical', 'citation', 'mastery', 'note'];
  const getReviewStmt = db.prepare(`
    SELECT receptor_id, mechanism, affinity, clinical, citation, mastery, note
    FROM review_state WHERE receptor_id = ?
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
        const volumes = volStmt.all(id).map(r => r.volume);
        const source = shapeSource(row);
        json(res, 200, {
          id: row.id,
          label: row.label,
          system: row.system,
          hall: row.hall,
          volumes,
          claim: claim ? claim.text : null,
          quiz: quiz ? quiz.prompt : null,
          stahl,
          note: row.stahl_note ?? null,
          note2: row.correction_note ?? null,
          search: row.search_query ?? null,
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
          alias: row.alias ?? null,
          label: row.label,
          claim: row.claim ?? null,
          status: row.status,
          source: shapeSource(row, { journal: false }),
        }));
        json(res, 200, out);
      },
    },

    // Task 9: sources library.
    {
      method: 'GET',
      pattern: /^\/api\/sources$/,
      handler: (req, res) => {
        json(res, 200, listSourcesStmt.all());
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/sources$/,
      handler: async (req, res) => {
        let body;
        try { body = await readJson(req); }
        catch { return json(res, 400, { error: 'invalid json' }); }
        // Whitelist columns; any field the caller omits defaults to null.
        const row = {};
        for (const k of sourceCols) row[k] = body[k] ?? null;
        const info = insertSourceStmt.run(row);
        json(res, 201, getSourceStmt.get(info.lastInsertRowid));
      },
    },
    {
      method: 'PATCH',
      pattern: /^\/api\/sources\/(\d+)$/,
      handler: async (req, res, m) => {
        const id = Number(m[1]);
        if (!getSourceStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch { return json(res, 400, { error: 'invalid json' }); }
        // Only update whitelisted, explicitly-provided keys — no arbitrary
        // column names from the request body reach the SQL.
        const keys = sourceCols.filter(k => k in body);
        if (keys.length) {
          const set = keys.map(k => `${k} = @${k}`).join(', ');
          const params = { id };
          for (const k of keys) params[k] = body[k];
          db.prepare(`UPDATE sources SET ${set} WHERE id = @id`).run(params);
        }
        json(res, 200, getSourceStmt.get(id));
      },
    },

    // Task 10: link a source to a receptor.
    {
      method: 'PUT',
      pattern: /^\/api\/receptors\/([\w-]+)\/citation$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch { return json(res, 400, { error: 'invalid json' }); }
        const status = body.status;
        if (!CITATION_STATUS.has(status)) return json(res, 400, { error: 'invalid status' });
        const sourceId = body.source_id ?? null;
        upsertCitationStmt.run(id, sourceId, status);
        json(res, 200, getCitationStmt.get(id));
      },
    },

    // Task 11: persist review state.
    {
      method: 'PATCH',
      pattern: /^\/api\/receptors\/([\w-]+)\/review$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch { return json(res, 400, { error: 'invalid json' }); }
        const keys = reviewCols.filter(k => k in body);
        if (keys.length) {
          const set = keys.map(k => `${k} = @${k}`).join(', ');
          const params = { id };
          for (const k of keys) params[k] = body[k];
          db.prepare(`UPDATE review_state SET ${set} WHERE receptor_id = @id`).run(params);
        }
        json(res, 200, getReviewStmt.get(id));
      },
    },

    // Task 16: sections edited since their last review (review drift).
    {
      method: 'GET',
      pattern: /^\/api\/review\/drift$/,
      handler: (req, res) => json(res, 200, reviewDrift(db)),
    },

    // Task 15: read a receptor's structured data (binding/clinical/claim/activity).
    {
      method: 'GET',
      pattern: /^\/api\/receptors\/([\w-]+)\/structured$/,
      handler: (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        json(res, 200, structuredFor(id));
      },
    },

    // Task 15: edit structured data (claim / a binding value / clinical fields) and
    // stamp section_activity.last_edited_at for the volume that was edited.
    {
      method: 'PATCH',
      pattern: /^\/api\/receptors\/([\w-]+)\/structured$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch { return json(res, 400, { error: 'invalid json' }); }
        if (!VOLUMES.has(body.volume)) return json(res, 400, { error: 'invalid volume' });

        const hasClaim = typeof body.claim === 'string';
        const hasBinding = body.binding && typeof body.binding === 'object';
        const hasClinical = body.clinical && typeof body.clinical === 'object';
        if (!hasClaim && !hasBinding && !hasClinical) return json(res, 400, { error: 'nothing to change' });

        try {
          db.transaction(() => {
            if (hasClaim) upsertClaimStmt.run(id, body.claim);

            if (hasBinding) {
              const b = body.binding;
              const keys = BINDING_FIELDS.filter(k => k in b);
              if (keys.length && b.id != null) {
                const set = keys.map(k => `${k} = @${k}`).join(', ');
                const params = { rowId: b.id, id };
                for (const k of keys) params[k] = b[k];
                db.prepare(`UPDATE binding_values SET ${set} WHERE id = @rowId AND receptor_id = @id`).run(params);
              }
            }

            if (hasClinical) {
              const c = body.clinical;
              const sets = [], params = { id };
              for (const k of CLINICAL_SCALAR) if (k in c) { sets.push(`${k} = @${k}`); params[k] = c[k]; }
              for (const k in CLINICAL_LIST) if (k in c) { sets.push(`${CLINICAL_LIST[k]} = @${k}`); params[k] = JSON.stringify(c[k] ?? []); }
              if (sets.length) db.prepare(`UPDATE clinical_rows SET ${sets.join(', ')} WHERE receptor_id = @id`).run(params);
            }

            stampStmt.run(id, body.volume, new Date().toISOString());
          })();
        } catch (e) {
          return json(res, 500, { error: 'update failed' });
        }

        const out = structuredFor(id);
        json(res, 200, { ...out, volume: body.volume, last_edited_at: out.activity[body.volume]?.last_edited_at ?? null });
      },
    },
  ];
}
