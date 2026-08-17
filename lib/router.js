// Returns the API route table. `db` is wired in so each route handler can close
// over the database connection. All queries are parameterized (`?`) — never
// string-interpolated — so the :id / :volume path segments cannot inject SQL.

import { reviewDrift, cabinetBinding, ledgerClinical, archiveNarrative, rollupStatus, receptorStatuses, receptorSources, atlasVolume, agentBindingProvenance, bindingSourceUsage } from './queries.js';

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Read and parse a JSON request body. Rejects on malformed JSON (handler -> 400)
// or on a body past MAX_BODY (handler -> 413). Rejecting on the size cap — rather
// than only destroying the socket — means an oversized upload settles the promise
// instead of leaving the handler awaiting forever; buffering stays bounded at the
// cap because we stop appending (and just drain) once it's hit.
const MAX_BODY = 1e6;
function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '', tooLarge = false;
    req.on('data', c => {
      if (tooLarge) return;
      body += c;
      if (body.length > MAX_BODY) {
        tooLarge = true;
        reject(Object.assign(new Error('payload too large'), { httpStatus: 413 }));
      }
    });
    req.on('end', () => { if (!tooLarge) { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('bad json')); } } });
    req.on('error', reject);
  });
}

// Shape a source object (from receptorSources(), or a raw `sources` row) into
// the citation object the desk/volumes render, or null when there isn't one.
// `journal` is omitted for the atlas volume payload, matching its original shape.
function toCitation(s, { journal = true } = {}) {
  if (!s) return null;
  const out = { id: s.id, authors: s.authors, year: s.year, title: s.title };
  if (journal) out.journal = s.journal;
  out.pmid = s.pmid;
  out.doi = s.doi;
  return out;
}

export function apiRoutes(db) {
  // The receptor registry: read each receptor's progress summary.
  const listStmt = db.prepare(`
    SELECT r.id, r.label, r.system, r.hall, r.sort_order,
           (rv.mechanism + rv.affinity + rv.clinical + rv.citation) AS checks_done,
           rv.mastery,
           (SELECT MAX(last_edited_at)   FROM section_activity sa WHERE sa.receptor_id = r.id) AS edited_at,
           (SELECT MAX(last_reviewed_at) FROM section_activity sa WHERE sa.receptor_id = r.id) AS reviewed_at
    FROM receptors r
    LEFT JOIN review_state rv ON rv.receptor_id = r.id
    ORDER BY r.sort_order
  `);

  // Citation redesign: receptor row + its full source list (assembled
  // from a few small queries — sources come from receptorSources()).
  const detailStmt = db.prepare(`
    SELECT r.id, r.label, r.system, r.hall, r.stahl_note, r.search_query
    FROM receptors r WHERE r.id = ?
  `);
  const claimStmt = db.prepare(`SELECT text FROM claims WHERE receptor_id = ?`);
  const quizStmt = db.prepare(`SELECT prompt FROM quizzes WHERE receptor_id = ?`);
  const volStmt = db.prepare(`SELECT volume FROM receptor_volumes WHERE receptor_id = ? ORDER BY volume`);
  const reviewStmt = db.prepare(`
    SELECT mechanism, affinity, clinical, citation, mastery, note
    FROM review_state WHERE receptor_id = ?
  `);

  // Citation redesign: sources library (read + write). `kind` ('article'
  // | 'book') is exposed and writable so the desk's combobox can tell a Stahl
  // chapter apart from a peer-reviewed article without special-casing either.
  const sourceCols = ['kind', 'authors', 'year', 'title', 'journal', 'pmid', 'doi', 'url', 'notes'];
  const listSourcesStmt = db.prepare(`
    SELECT id, kind, authors, year, title, journal, pmid, doi, url, notes
    FROM sources ORDER BY year DESC, authors
  `);
  const getSourceStmt = db.prepare(`
    SELECT id, kind, authors, year, title, journal, pmid, doi, url, notes
    FROM sources WHERE id = ?
  `);
  const insertSourceStmt = db.prepare(`
    INSERT INTO sources (kind, authors, year, title, journal, pmid, doi, url, notes)
    VALUES (@kind, @authors, @year, @title, @journal, @pmid, @doi, @url, @notes)
  `);

  // Citation/verification redesign: attach/update/unlink a source on a receptor's
  // source list. A per-edge status is one of three states — 'needs-source' isn't
  // a per-edge value, since an attached row inherently has a source; it only
  // describes a receptor with zero attached sources (see rollupStatus).
  const receptorExistsStmt = db.prepare(`SELECT 1 FROM receptors WHERE id = ?`);
  const CITATION_STATUS = new Set(['verified', 'provided', 'conflicting']);
  const getEdgeStmt = db.prepare(`SELECT 1 FROM receptor_sources WHERE receptor_id = ? AND source_id = ?`);
  const getEdgeIsPrimaryStmt = db.prepare(`SELECT is_primary FROM receptor_sources WHERE receptor_id = ? AND source_id = ?`);
  const unsetPrimaryStmt = db.prepare(`UPDATE receptor_sources SET is_primary = 0 WHERE receptor_id = ?`);
  const attachSourceStmt = db.prepare(`
    INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary, correction_note)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(receptor_id, source_id) DO UPDATE SET
      status = excluded.status, is_primary = excluded.is_primary, correction_note = excluded.correction_note
  `);
  const deleteEdgeStmt = db.prepare(`DELETE FROM receptor_sources WHERE receptor_id = ? AND source_id = ?`);
  // Deleting the primary edge must not leave the receptor with zero primaries —
  // the atlas volumes' "exactly one citation per receptor" read depends on one
  // always being set when any source remains. Articles outrank books as the
  // auto-promoted replacement (same tie-break receptorSources() already uses).
  const nextPrimaryCandidateStmt = db.prepare(`
    SELECT s.id FROM receptor_sources rs JOIN sources s ON s.id = rs.source_id
    WHERE rs.receptor_id = ? ORDER BY s.kind, s.year DESC LIMIT 1
  `);
  const setPrimaryStmt = db.prepare(`UPDATE receptor_sources SET is_primary = 1 WHERE receptor_id = ? AND source_id = ?`);
  // Guard the same invariant when an edge's is_primary is cleared explicitly (not
  // just on delete): prefer promoting a source OTHER than the one just cleared,
  // falling back to it only when it is the receptor's last remaining source.
  const hasPrimaryStmt = db.prepare(`SELECT 1 FROM receptor_sources WHERE receptor_id = ? AND is_primary = 1`);
  const nextPrimaryExceptStmt = db.prepare(`
    SELECT rs.source_id FROM receptor_sources rs JOIN sources s ON s.id = rs.source_id
    WHERE rs.receptor_id = ? ORDER BY (rs.source_id = ?), s.kind, s.year DESC LIMIT 1
  `);

  // Structured data for one receptor: binding values, clinical row, claim, activity.
  const VOLUMES = new Set(['archive', 'cabinet', 'ledger']);
  const bindingForReceptorStmt = db.prepare(`
    SELECT id, target_alias, agent_name, agent_group, cid, ki, ki_text, act, act_full, src, note
    FROM binding_values WHERE receptor_id = ? ORDER BY ki IS NULL, ki, agent_name
  `);
  const clinicalForReceptorStmt = db.prepare(`SELECT * FROM clinical_rows WHERE receptor_id = ?`);
  const archiveRowStmt = db.prepare(`SELECT * FROM archive_entries WHERE receptor_id = ?`);
  const NARRATIVE_SCALAR = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption'];
  const NARRATIVE_LIST = { body: 'body_json', tags: 'tags_json' };
  const activityForReceptorStmt = db.prepare(`
    SELECT volume, last_edited_at, last_reviewed_at FROM section_activity WHERE receptor_id = ?
  `);
  // Whitelisted, editable columns only — the request body never names a SQL column.
  const BINDING_FIELDS = ['ki', 'ki_text', 'act', 'act_full', 'src', 'note'];
  const CLINICAL_SCALAR = ['sys', 'name', 'cls', 'baseline', 'mech', 'stahl', 'onset', 'time_course'];
  const CLINICAL_LIST = {
    over: 'over_json', under: 'under_json',
    agonists: 'agonists_json', antagonists: 'antagonists_json',
    risk_factors: 'risk_factors_json', monitoring: 'monitoring_json',
  };
  const stampStmt = db.prepare(`
    INSERT INTO section_activity (receptor_id, volume, last_edited_at)
    VALUES (?, ?, ?)
    ON CONFLICT(receptor_id, volume) DO UPDATE SET last_edited_at = excluded.last_edited_at
  `);
  // Reviewing a receptor marks all of its sections reviewed (clears their drift).
  const stampReviewedStmt = db.prepare(`
    INSERT INTO section_activity (receptor_id, volume, last_reviewed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(receptor_id, volume) DO UPDATE SET last_reviewed_at = excluded.last_reviewed_at
  `);
  const upsertClaimStmt = db.prepare(`
    INSERT INTO claims (receptor_id, text) VALUES (?, ?)
    ON CONFLICT(receptor_id) DO UPDATE SET text = excluded.text
  `);
  // The quiz prompt was readable through /api/receptors/:id and carried on the Desk's
  // record, but had no write path, so it could be shown and never changed.
  const upsertQuizStmt = db.prepare(`
    INSERT INTO quizzes (receptor_id, prompt) VALUES (?, ?)
    ON CONFLICT(receptor_id) DO UPDATE SET prompt = excluded.prompt
  `);

  // Binding-affinity provenance: edges + per-number review keyed on the stable pair.
  const VALUE_STATUS = new Set(['unchecked', 'confirmed', 'mismatch']);
  const bindingPairExistsStmt = db.prepare(
    `SELECT 1 FROM binding_values WHERE agent_name = ? AND target_alias = ? LIMIT 1`);
  const attachBindingSourceStmt = db.prepare(`
    INSERT INTO binding_sources (agent_name, target_alias, source_id, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(agent_name, target_alias, source_id) DO UPDATE SET status = excluded.status
  `);
  const getBindingEdgeStmt = db.prepare(
    `SELECT 1 FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const updBindingEdgeStmt = db.prepare(
    `UPDATE binding_sources SET status = ? WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const delBindingEdgeStmt = db.prepare(
    `DELETE FROM binding_sources WHERE agent_name = ? AND target_alias = ? AND source_id = ?`);
  const upsertBindingReviewStmt = db.prepare(`
    INSERT INTO binding_review (agent_name, target_alias, value_status)
    VALUES (?, ?, ?)
    ON CONFLICT(agent_name, target_alias) DO UPDATE SET value_status = excluded.value_status
  `);
  const bulkBindingStatusStmt = db.prepare(
    `UPDATE binding_sources SET status = ? WHERE source_id = ?`);
  const bindingEdgesStmt = db.prepare(`
    SELECT s.id, s.kind, s.authors, s.year, s.title, s.journal, s.pmid, s.doi, s.url, bs.status
    FROM binding_sources bs JOIN sources s ON s.id = bs.source_id
    WHERE bs.agent_name = ? AND bs.target_alias = ? ORDER BY s.kind, s.year DESC
  `);
  const getBindingReviewStmt = db.prepare(
    `SELECT value_status FROM binding_review WHERE agent_name = ? AND target_alias = ?`);

  function structuredFor(id) {
    // Enrich each binding with its citation edges + per-number review, so the specimen's
    // structured editor can show every Ki alongside its source and value_status inline
    // (receptor-first provenance) — joined on the stable (agent_name, target_alias) pair.
    const binding = bindingForReceptorStmt.all(id).map(b => {
      const sources = bindingEdgesStmt.all(b.agent_name, b.target_alias);
      const rv = getBindingReviewStmt.get(b.agent_name, b.target_alias);
      return { ...b, sources, value_status: rv?.value_status || 'unchecked', citation_status: rollupStatus(sources.map(s => s.status)) };
    });
    // The Ledger's syndromic columns — onset, course, risk, monitoring — are what makes
    // Vol III a clinical volume rather than a second list of symptoms, and they were
    // missing from this shape, from the two write whitelists below, and from the Desk.
    // A column the API never returns is a column the curator cannot see, so it may as
    // well not be in the table.
    const cRow = clinicalForReceptorStmt.get(id);
    const clinical = cRow ? {
      no: cRow.no, sys: cRow.sys, name: cRow.name, cls: cRow.cls,
      baseline: cRow.baseline, mech: cRow.mech, stahl: cRow.stahl,
      onset: cRow.onset, time_course: cRow.time_course,
      over: JSON.parse(cRow.over_json || '[]'), under: JSON.parse(cRow.under_json || '[]'),
      agonists: JSON.parse(cRow.agonists_json || '[]'), antagonists: JSON.parse(cRow.antagonists_json || '[]'),
      risk_factors: JSON.parse(cRow.risk_factors_json || '[]'),
      monitoring: JSON.parse(cRow.monitoring_json || '[]'),
    } : null;
    const claim = claimStmt.get(id);
    const aRow = archiveRowStmt.get(id);
    const narrative = aRow ? {
      abstract: aRow.abstract, presentation: aRow.presentation, effect: aRow.effect,
      receptor_class: aRow.receptor_class, ligand: aRow.ligand, figure_caption: aRow.figure_caption,
      body: JSON.parse(aRow.body_json || '[]'), tags: JSON.parse(aRow.tags_json || '[]'),
    } : null;
    const activity = {};
    for (const a of activityForReceptorStmt.all(id))
      activity[a.volume] = { last_edited_at: a.last_edited_at, last_reviewed_at: a.last_reviewed_at };
    return { id, claim: claim ? claim.text : null, binding, clinical, narrative, activity };
  }

  // Persist review state, upserting on receptor_id.
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
        const statuses = receptorStatuses(db);
        const rows = listStmt.all().map(r => ({ ...r, status: statuses.get(r.id) || 'needs-source' }));
        json(res, 200, rows);
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
        const volumes = volStmt.all(id).map(r => r.volume);
        const sources = receptorSources(db, id);
        const primary = sources.find(s => s.is_primary) || null;
        json(res, 200, {
          id: row.id,
          label: row.label,
          system: row.system,
          hall: row.hall,
          volumes,
          claim: claim ? claim.text : null,
          quiz: quiz ? quiz.prompt : null,
          note: row.stahl_note ?? null,
          note2: primary ? primary.correction_note ?? null : null,
          search: row.search_query ?? null,
          status: rollupStatus(sources.map(s => s.status)),
          source: toCitation(primary),
          sources,
          review,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/atlas\/(archive|cabinet|ledger)$/,
      handler: (req, res, m) => json(res, 200, atlasVolume(db, m[1])),
    },

    // Sources library: read and write operations.
    {
      method: 'GET',
      pattern: /^\/api\/sources$/,
      handler: (req, res) => {
        json(res, 200, listSourcesStmt.all());
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/sources\/(\d+)$/,
      handler: (req, res, m) => {
        const id = Number(m[1]);
        const row = getSourceStmt.get(id);
        if (!row) return json(res, 404, { error: 'not found' });
        json(res, 200, row);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/sources$/,
      handler: async (req, res) => {
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        // Whitelist columns; any field the caller omits defaults to null, except
        // `kind`, whose column default ('article') only applies when no value is
        // bound at all — an explicit null would violate its NOT NULL constraint.
        const row = {};
        for (const k of sourceCols) row[k] = body[k] ?? null;
        row.kind = body.kind ?? 'article';
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
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
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

    // Citation/verification redesign: attach an existing library source, or
    // create one inline and attach it in the same call.
    {
      method: 'POST',
      pattern: /^\/api\/receptors\/([\w-]+)\/sources$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        const status = body.status ?? 'provided';
        if (!CITATION_STATUS.has(status)) return json(res, 400, { error: 'invalid status' });
        const isPrimary = !!body.is_primary;

        let sourceId;
        if (body.source_id != null) {
          sourceId = Number(body.source_id);
          if (!getSourceStmt.get(sourceId)) return json(res, 400, { error: 'unknown source_id' });
        } else if (body.source && typeof body.source === 'object') {
          const row = {};
          for (const k of sourceCols) row[k] = body.source[k] ?? null;
          row.kind = body.source.kind ?? 'article';
          sourceId = insertSourceStmt.run(row).lastInsertRowid;
        } else {
          return json(res, 400, { error: 'source_id or source is required' });
        }

        db.transaction(() => {
          if (isPrimary) unsetPrimaryStmt.run(id);
          attachSourceStmt.run(id, sourceId, status, isPrimary ? 1 : 0, body.correction_note ?? null);
        })();

        json(res, 201, receptorSources(db, id).find(s => s.id === sourceId));
      },
    },

    // Update a source's status, primary flag, and/or correction note on a
    // receptor (does not touch the shared `sources` library row).
    {
      method: 'PATCH',
      pattern: /^\/api\/receptors\/([\w-]+)\/sources\/(\d+)$/,
      handler: async (req, res, m) => {
        const id = m[1], sourceId = Number(m[2]);
        if (!getEdgeStmt.get(id, sourceId)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if ('status' in body && !CITATION_STATUS.has(body.status)) return json(res, 400, { error: 'invalid status' });

        db.transaction(() => {
          if (body.is_primary === true) unsetPrimaryStmt.run(id);
          const sets = [], params = { id, sourceId };
          if ('status' in body) { sets.push('status = @status'); params.status = body.status; }
          if ('is_primary' in body) { sets.push('is_primary = @is_primary'); params.is_primary = body.is_primary ? 1 : 0; }
          if ('correction_note' in body) { sets.push('correction_note = @correction_note'); params.correction_note = body.correction_note; }
          if (sets.length) db.prepare(`UPDATE receptor_sources SET ${sets.join(', ')} WHERE receptor_id = @id AND source_id = @sourceId`).run(params);
          // Clearing the only primary must not leave the receptor at zero primaries
          // while sources remain — the atlas volumes read exactly one primary edge.
          if (body.is_primary === false && !hasPrimaryStmt.get(id)) {
            const next = nextPrimaryExceptStmt.get(id, sourceId);
            if (next) setPrimaryStmt.run(id, next.source_id);
          }
        })();

        json(res, 200, receptorSources(db, id).find(s => s.id === sourceId));
      },
    },

    // Unlink a source from a receptor. The shared `sources` library row is kept
    // (other receptors may still cite it) — this only removes the edge. If the
    // unlinked source was primary, another attached source (if any) is promoted
    // in the same transaction, so the receptor never sits at zero primaries
    // while it still has sources — the atlas volumes' primary-edge read depends
    // on that invariant.
    {
      method: 'DELETE',
      pattern: /^\/api\/receptors\/([\w-]+)\/sources\/(\d+)$/,
      handler: (req, res, m) => {
        const id = m[1], sourceId = Number(m[2]);
        const edge = getEdgeIsPrimaryStmt.get(id, sourceId);
        if (!edge) return json(res, 404, { error: 'not found' });
        db.transaction(() => {
          deleteEdgeStmt.run(id, sourceId);
          if (edge.is_primary) {
            const next = nextPrimaryCandidateStmt.get(id);
            if (next) setPrimaryStmt.run(id, next.id);
          }
        })();
        json(res, 200, { deleted: sourceId });
      },
    },

    // Persist review state.
    {
      method: 'PATCH',
      pattern: /^\/api\/receptors\/([\w-]+)\/review$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        const keys = reviewCols.filter(k => k in body);
        if (keys.length) {
          const set = keys.map(k => `${k} = @${k}`).join(', ');
          const params = { id };
          for (const k of keys) params[k] = body[k];
          db.prepare(`UPDATE review_state SET ${set} WHERE receptor_id = @id`).run(params);
        }
        // A review touch stamps last_reviewed_at on every section of this
        // receptor, so an active review clears its drift.
        const now = new Date().toISOString();
        for (const v of volStmt.all(id)) stampReviewedStmt.run(id, v.volume, now);
        json(res, 200, getReviewStmt.get(id));
      },
    },

    // Review drift: sections edited since their last review.
    {
      method: 'GET',
      pattern: /^\/api\/review\/drift$/,
      handler: (req, res) => json(res, 200, reviewDrift(db)),
    },

    // Structured volume data shaped for the volume's own render code.
    {
      method: 'GET',
      pattern: /^\/api\/atlas\/cabinet\/binding$/,
      handler: (req, res) => json(res, 200, cabinetBinding(db)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/agents\/binding$/,
      handler: (req, res) => json(res, 200, agentBindingProvenance(db)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/sources\/binding-usage$/,
      handler: (req, res) => json(res, 200, bindingSourceUsage(db)),
    },

    // Binding-affinity provenance: attach a library source (or create-inline) to a binding.
    {
      method: 'POST',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]);
        if (!bindingPairExistsStmt.get(agent, target)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        const status = body.status ?? 'provided';
        if (!CITATION_STATUS.has(status)) return json(res, 400, { error: 'invalid status' });

        let sourceId;
        if (body.source_id != null) {
          sourceId = Number(body.source_id);
          if (!getSourceStmt.get(sourceId)) return json(res, 400, { error: 'unknown source_id' });
        } else if (body.source && typeof body.source === 'object') {
          const row = {};
          for (const k of sourceCols) row[k] = body.source[k] ?? null;
          row.kind = body.source.kind ?? 'article';
          sourceId = insertSourceStmt.run(row).lastInsertRowid;
        } else {
          return json(res, 400, { error: 'source_id or source is required' });
        }

        attachBindingSourceStmt.run(agent, target, sourceId, status);
        json(res, 201, getSourceStmt.get(sourceId));
      },
    },
    // Update one binding edge's status.
    {
      method: 'PATCH',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources\/(\d+)$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]), sid = Number(m[3]);
        if (!getBindingEdgeStmt.get(agent, target, sid)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!CITATION_STATUS.has(body.status)) return json(res, 400, { error: 'invalid status' });
        updBindingEdgeStmt.run(body.status, agent, target, sid);
        json(res, 200, bindingEdgesStmt.all(agent, target).find(s => s.id === sid));
      },
    },
    // Unlink a source from a binding (keeps the shared library row).
    {
      method: 'DELETE',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/sources\/(\d+)$/,
      handler: (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]), sid = Number(m[3]);
        if (!getBindingEdgeStmt.get(agent, target, sid)) return json(res, 404, { error: 'not found' });
        delBindingEdgeStmt.run(agent, target, sid);
        json(res, 200, { deleted: sid });
      },
    },
    // Set a binding's per-number value_status.
    {
      method: 'PATCH',
      pattern: /^\/api\/bindings\/([^/]+)\/([^/]+)\/review$/,
      handler: async (req, res, m) => {
        const agent = decodeURIComponent(m[1]), target = decodeURIComponent(m[2]);
        if (!bindingPairExistsStmt.get(agent, target)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!VALUE_STATUS.has(body.value_status)) return json(res, 400, { error: 'invalid value_status' });
        upsertBindingReviewStmt.run(agent, target, body.value_status);
        json(res, 200, { agent_name: agent, target_alias: target, value_status: body.value_status });
      },
    },
    // Bulk: set every binding edge citing this source to one status.
    {
      method: 'PATCH',
      pattern: /^\/api\/sources\/(\d+)\/binding-status$/,
      handler: async (req, res, m) => {
        const sid = Number(m[1]);
        if (!getSourceStmt.get(sid)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!CITATION_STATUS.has(body.status)) return json(res, 400, { error: 'invalid status' });
        const info = bulkBindingStatusStmt.run(body.status, sid);
        json(res, 200, { source_id: sid, status: body.status, updated: info.changes });
      },
    },

    {
      method: 'GET',
      pattern: /^\/api\/atlas\/ledger\/clinical$/,
      handler: (req, res) => json(res, 200, ledgerClinical(db)),
    },
    {
      method: 'GET',
      pattern: /^\/api\/atlas\/archive\/narrative$/,
      handler: (req, res) => json(res, 200, archiveNarrative(db)),
    },

    // Read a receptor's structured data (binding/clinical/claim/activity).
    {
      method: 'GET',
      pattern: /^\/api\/receptors\/([\w-]+)\/structured$/,
      handler: (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        json(res, 200, structuredFor(id));
      },
    },

    // Edit structured data (claim / a binding value / clinical fields) and
    // stamp section_activity.last_edited_at for the volume that was edited.
    {
      method: 'PATCH',
      pattern: /^\/api\/receptors\/([\w-]+)\/structured$/,
      handler: async (req, res, m) => {
        const id = m[1];
        if (!receptorExistsStmt.get(id)) return json(res, 404, { error: 'not found' });
        let body;
        try { body = await readJson(req); }
        catch (e) { return json(res, e.httpStatus || 400, { error: e.httpStatus === 413 ? 'payload too large' : 'invalid json' }); }
        if (!VOLUMES.has(body.volume)) return json(res, 400, { error: 'invalid volume' });

        const hasClaim = typeof body.claim === 'string';
        const hasQuiz = typeof body.quiz === 'string';
        const hasBinding = body.binding && typeof body.binding === 'object';
        const hasClinical = body.clinical && typeof body.clinical === 'object';
        const hasNarrative = body.narrative && typeof body.narrative === 'object';
        if (!hasClaim && !hasQuiz && !hasBinding && !hasClinical && !hasNarrative)
          return json(res, 400, { error: 'nothing to change' });

        try {
          db.transaction(() => {
            if (hasClaim) upsertClaimStmt.run(id, body.claim);
            if (hasQuiz) upsertQuizStmt.run(id, body.quiz);

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

            if (hasNarrative) {
              const nv = body.narrative, sets = [], params = { id };
              for (const k of NARRATIVE_SCALAR) if (k in nv) { sets.push(`${k} = @${k}`); params[k] = nv[k]; }
              for (const k in NARRATIVE_LIST) if (k in nv) { sets.push(`${NARRATIVE_LIST[k]} = @${k}`); params[k] = JSON.stringify(nv[k] ?? []); }
              if (sets.length) db.prepare(`UPDATE archive_entries SET ${sets.join(', ')} WHERE receptor_id = @id`).run(params);
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

    // Commit the curator dump and push it: the one action that makes a session's
    // work reach the other machine and the public site.
    //
    // Takes no request body on purpose. Nothing the browser sends becomes a git
    // argument, and the commit message is composed on this side from the diff, so
    // there is no path from the page into the shell. See lib/git-publish.js.
    {
      method: 'POST',
      pattern: /^\/api\/publish$/,
      handler: async (req, res) => {
        const { publishToGit } = await import('./git-publish.js');
        const result = await publishToGit(db);
        json(res, result.ok ? 200 : 500, result);
      },
    },
  ];
}
