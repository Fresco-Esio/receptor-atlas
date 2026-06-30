import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { sliceLiteral } from './migrate-structured.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = join(HERE, '..', 'public', 'receptor-function.html');

// The Archive ENTRIES literal is NOT pure data — fields like `figureSvg: gpcrSvg({...})`
// and `figureLabel: SVG_LABELS.gpcr` are calls/identifier refs. Evaluate it inside a
// Proxy sandbox where every unknown name resolves to a no-op, so those figure fields
// become undefined (we ignore them) and only the prose survives. Safe: our own repo file.
function evalEntries(src) {
  const lit = sliceLiteral(src, 'ENTRIES');
  const sandbox = new Proxy({}, { has: () => true, get: () => () => undefined });
  return new Function('__sb', 'with(__sb){ return (' + lit + '); }')(sandbox);
}

export function migrateArchive(db) {
  const ENTRIES = evalEntries(readFileSync(ARCHIVE, 'utf8'));
  const alias = (n) => db.prepare(
    "SELECT receptor_id FROM receptor_aliases WHERE volume='archive' AND alias=?").get(String(n))?.receptor_id ?? null;
  const ins = db.prepare(`
    INSERT OR REPLACE INTO archive_entries
      (receptor_id, abstract, presentation, effect, receptor_class, ligand, figure_caption, body_json, tags_json)
    VALUES (@receptor_id,@abstract,@presentation,@effect,@receptor_class,@ligand,@figure_caption,@body_json,@tags_json)`);
  let n = 0;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM archive_entries').run();
    for (const e of ENTRIES) {
      const rid = alias(e.number); if (!rid) continue;
      const x = e.exhibit || {};
      ins.run({
        receptor_id: rid,
        abstract: x.abstract ?? null, presentation: x.presentation ?? null, effect: x.effect ?? null,
        receptor_class: x.receptorClass ?? null, ligand: x.ligand ?? null, figure_caption: x.figureCaption ?? null,
        body_json: JSON.stringify(x.body ?? []), tags_json: JSON.stringify(x.tags ?? []),
      });
      n++;
    }
  });
  tx();
  return { archive: n };
}

// Run directly with `node scripts/migrate-archive.js`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  console.log('archive entries:', migrateArchive(db).archive);
}
