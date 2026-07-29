import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/**
 * Pull a JS literal (array `[...]` or object `{...}`) out of an embedded <script>
 * by name, bracket-matching from the opening to its balanced close. String contents
 * (which may hold brackets, apostrophes, or unicode) are skipped, so this is robust
 * to the long clinical prose in the volume data. The extracted literal is evaluated
 * with `new Function` — safe here because the input is our own repo's source files,
 * never user data.
 */
export function sliceLiteral(src, declName, open = '[', close = ']') {
  const re = new RegExp(declName + '\\s*=\\s*\\' + open);
  const m = re.exec(src);
  if (!m) throw new Error('declaration not found: ' + declName);
  const start = src.indexOf(open, m.index);
  let depth = 0, str = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === str) str = null;
    } else if (c === '"' || c === "'" || c === '`') {
      str = c;
    } else if (c === open) {
      depth++;
    } else if (c === close) {
      if (--depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced literal: ' + declName);
}

// Evaluate a pure-data literal (AFF_AGENTS, DATA, CANON2NO). For literals that contain
// function calls / identifier refs (e.g. the Archive ENTRIES), use a sandboxed eval
// instead — see scripts/migrate-archive.js.
export function extractLiteral(src, declName, open = '[', close = ']') {
  return new Function('return ' + sliceLiteral(src, declName, open, close))();
}

// The Ledger's row-number → canonical-id map, inverted to no → canon, so each
// clinical row resolves to a receptor_id via the (ledger) alias table.
function ledgerNoToCanon(clinicalSrc) {
  const CANON2NO = extractLiteral(clinicalSrc, 'CANON2NO', '{', '}');
  const out = {};
  for (const canon in CANON2NO) out[CANON2NO[canon]] = canon;
  return out;
}

/**
 * Load binding_values (Cabinet AFF_AGENTS) and clinical_rows (Ledger DATA) from the
 * volume files into the DB, resolving each to a canonical receptor_id via the alias
 * table. Requires receptor_aliases to be seeded first.
 *
 * SEED-ONLY, never a rebuild. Once a table holds rows it is authoritative: the
 * Conservator's Desk edits binding_values/clinical_rows in place (PATCH .../structured),
 * so re-reading the volume HTML and rebuilding would silently clobber every curator edit
 * on the next startup — and regenerate binding_values.id, breaking id-keyed edits. So we
 * seed a table only while it is still empty (a fresh DB, or one seeded before this feature
 * existed) and otherwise leave it untouched. To rebuild from the HTML, delete db/atlas.db
 * and re-migrate (the documented reset path). Because a populated DB is never re-read, a
 * seeded DB no longer depends on the volume files being present at startup.
 *
 * Returns { binding, clinical } (live row counts) plus { skipped:true } when both tables
 * were already populated.
 */
export function migrateStructured(db) {
  const bindingCount = db.prepare('SELECT COUNT(*) c FROM binding_values').get().c;
  const clinicalCount = db.prepare('SELECT COUNT(*) c FROM clinical_rows').get().c;
  if (bindingCount > 0 && clinicalCount > 0) {
    return { binding: bindingCount, clinical: clinicalCount, skipped: true };
  }

  const cabinetSrc = readFileSync(join(PUBLIC, 'neuroreceptor_pharmacology_explorer_dashboard.html'), 'utf8');
  const ledgerSrc = readFileSync(join(PUBLIC, 'neuroreceptor_clinical_table.html'), 'utf8');

  const AFF_AGENTS = extractLiteral(cabinetSrc, 'AFF_AGENTS');
  const DATA = extractLiteral(ledgerSrc, 'DATA');
  const NO2CANON = ledgerNoToCanon(ledgerSrc);

  const aliasToReceptor = (volume, alias) =>
    db.prepare('SELECT receptor_id FROM receptor_aliases WHERE volume = ? AND alias = ?').get(volume, alias)?.receptor_id ?? null;

  const insBinding = db.prepare(`
    INSERT INTO binding_values (receptor_id, target_alias, agent_name, agent_group, cid, ki, ki_text,
                                act, act_full, src, note, n, lo, hi, sub, nc, weak, act_src)
    VALUES (@receptor_id, @target_alias, @agent_name, @agent_group, @cid, @ki, @ki_text,
            @act, @act_full, @src, @note, @n, @lo, @hi, @sub, @nc, @weak, @act_src)
  `);
  const insClinical = db.prepare(`
    INSERT OR REPLACE INTO clinical_rows (no, receptor_id, sys, name, cls, baseline, mech, over_json, under_json, stahl, agonists_json, antagonists_json)
    VALUES (@no, @receptor_id, @sys, @name, @cls, @baseline, @mech, @over_json, @under_json, @stahl, @agonists_json, @antagonists_json)
  `);

  const tx = db.transaction(() => {
    // Seed each table only while empty, independently — a DB left half-seeded by an
    // earlier interrupted run self-heals without touching the populated table's edits.
    if (bindingCount === 0) {
      for (const agent of AFF_AGENTS) {
        for (const targetAlias in agent.b) {
          const v = agent.b[targetAlias];
          insBinding.run({
            receptor_id: aliasToReceptor('cabinet', targetAlias),
            target_alias: targetAlias,
            agent_name: agent.name,
            agent_group: agent.g ?? null,
            cid: agent.cid ?? null,
            ki: typeof v.ki === 'number' ? v.ki : null,
            ki_text: v.kiText ?? null,
            act: v.act ?? null,
            act_full: v.actFull ?? null,
            src: v.src ?? null,
            note: v.note ?? null,
            // The dispersion the median came from. Without these the page keeps only the
            // point estimate, because the plate renders this table and not the snapshot.
            n: typeof v.n === 'number' ? v.n : null,
            lo: typeof v.lo === 'number' ? v.lo : null,
            hi: typeof v.hi === 'number' ? v.hi : null,
            sub: v.sub ?? null,
            nc: typeof v.nc === 'number' ? v.nc : null,
            weak: v.weak ? 1 : null,
            act_src: v.actSrc ?? null,
          });
        }
      }
    }

    if (clinicalCount === 0) {
      for (const d of DATA) {
        insClinical.run({
          no: d.no,
          receptor_id: aliasToReceptor('ledger', NO2CANON[d.no]),
          sys: d.sys ?? null,
          name: d.name ?? null,
          cls: d.cls ?? null,
          baseline: d.baseline ?? null,
          mech: d.mech ?? null,
          over_json: JSON.stringify(d.over ?? []),
          under_json: JSON.stringify(d.under ?? []),
          stahl: d.stahl ?? null,
          agonists_json: JSON.stringify(d.agonists ?? []),
          antagonists_json: JSON.stringify(d.antagonists ?? []),
        });
      }
    }
  });
  tx();
  return {
    binding: db.prepare('SELECT COUNT(*) c FROM binding_values').get().c,
    clinical: db.prepare('SELECT COUNT(*) c FROM clinical_rows').get().c,
  };
}

// Run directly with `node scripts/migrate-structured.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  const r = migrateStructured(db);
  console.log(`structured: ${r.binding} binding values, ${r.clinical} clinical rows`);
}
