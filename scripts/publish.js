// `npm run snapshot` — turn the live atlas.db into a self-contained, read-only
// static site under dist/, deployable to any plain static host with no server and
// no database behind it.
//
// The public volume pages already run offline: each embeds its full dataset and
// only *overlays* live values via fetch('/api/...'), inside a try/catch that keeps
// the embedded data when the API is unreachable. So publishing is two moves:
//   1. Emit the five read-only API payloads as static JSON (reusing the exact same
//      query functions the server uses, so the snapshot can never drift in shape).
//   2. Copy the pages and inject a tiny shim that reroutes those five /api paths to
//      the bundled JSON. The pages' own code runs unchanged, so the published site
//      is visually and behaviourally identical to the live one — just frozen.
// The Conservator's Desk (the editor) is deliberately left out; the public site is
// strictly read-only.

import { readFile, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from '../db/index.js';
import { atlasVolume, cabinetBinding, ledgerClinical, archiveNarrative } from '../lib/queries.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

// data file -> how to build it from the DB. These mirror, one for one, the five
// read-only GET endpoints the volume pages fetch (see the SHIM map below).
function dataFiles(db) {
  return {
    'cabinet.json':          atlasVolume(db, 'cabinet'),
    'cabinet-binding.json':  cabinetBinding(db),
    'ledger.json':           atlasVolume(db, 'ledger'),
    'ledger-clinical.json':  ledgerClinical(db),
    'archive-narrative.json': archiveNarrative(db),
  };
}

// Injected at the top of each volume page's <head>. Wraps window.fetch so the five
// known /api paths resolve to the bundled JSON instead. Paths are RELATIVE so the
// bundle works at a domain root or a /repo/ subpath (e.g. GitHub Pages). Any other
// URL passes straight through; a missing file still leaves the page's own offline
// fallback intact.
const SHIM = `<script>
/* Published snapshot: read-only API served as bundled static JSON. */
(function () {
  var MAP = {
    '/api/atlas/cabinet': 'data/cabinet.json',
    '/api/atlas/cabinet/binding': 'data/cabinet-binding.json',
    '/api/atlas/ledger': 'data/ledger.json',
    '/api/atlas/ledger/clinical': 'data/ledger-clinical.json',
    '/api/atlas/archive/narrative': 'data/archive-narrative.json'
  };
  var real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url);
    return real(MAP[url] || input, init);
  };
})();
</script>
`;

const VOLUME_PAGES = [
  'receptor-function.html',                          // Archive
  'neuroreceptor_pharmacology_explorer_dashboard.html', // Cabinet
  'neuroreceptor_clinical_table.html',               // Ledger
];
const STANDALONE_PAGES = ['receptor-atlas-demo.html']; // no /api calls; copied as-is
const SHELL = 'the-receptor-atlas.html';               // served at / -> index.html

function injectShim(html) {
  // Every page has exactly one <head>; place the shim first so it wraps fetch
  // before any page script runs.
  return html.replace('<head>', '<head>\n' + SHIM);
}

// Remove the shell's link to the Conservator's Desk — the editor is local-only and
// must not appear on the public site. Matches the whole <a href="…desk…">…</a>.
function scrubDeskLink(html) {
  return html.replace(/<a\b[^>]*href="the-conservators-desk\.html"[^>]*>[\s\S]*?<\/a>\s*/i, '');
}

/**
 * Build the static snapshot from an open DB handle into `outDir`. Pure enough to
 * test: pass a seeded in-memory/temp DB and any output dir.
 */
export async function publish(db, outDir) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(join(outDir, 'data'), { recursive: true });

  // 1. Data payloads (reusing the server's own query functions).
  for (const [name, payload] of Object.entries(dataFiles(db)))
    await writeFile(join(outDir, 'data', name), JSON.stringify(payload, null, 2));

  // 2. Volume pages: reroute /api -> bundled JSON, keep everything else.
  for (const page of VOLUME_PAGES) {
    const html = injectShim(await readFile(join(PUBLIC, page), 'utf8'));
    await writeFile(join(outDir, page), html);
  }

  // 3. The shell, minus the Desk affordance, as index.html so a static host serves
  //    it at /. Its iframe/link paths are relative and resolve inside dist/.
  const shell = scrubDeskLink(await readFile(join(PUBLIC, SHELL), 'utf8'));
  await writeFile(join(outDir, 'index.html'), shell);

  // 4. Fully standalone pages, verbatim.
  for (const page of STANDALONE_PAGES)
    await copyFile(join(PUBLIC, page), join(outDir, page));

  // 5. Guard the invariant: nothing in the published bundle may reference the Desk.
  for (const page of ['index.html', ...VOLUME_PAGES, ...STANDALONE_PAGES]) {
    const html = await readFile(join(outDir, page), 'utf8');
    if (html.includes('the-conservators-desk'))
      throw new Error(`publish: ${page} still references the Conservator's Desk`);
  }
}

// CLI: read the live DB as-is and build into dist/. Publishing is strictly a read
// of the current content — it never seeds or otherwise mutates atlas.db, so a
// snapshot can't disturb what you're editing at the Desk. Run `npm run migrate`
// first if the DB is empty.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = join(HERE, '..', 'dist');
  const db = openDb();
  const { c } = db.prepare('SELECT COUNT(*) c FROM receptors').get();
  if (c === 0) console.warn('warning: atlas.db has no receptors — run `npm run migrate` first, or the snapshot will be empty.');
  await publish(db, outDir);
  db.close();
  console.log(`Snapshot of ${c} receptors written to ${outDir}`);
}
