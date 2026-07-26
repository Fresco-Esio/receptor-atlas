// The static publish snapshot must be a faithful, server-free copy of the public
// site: every data file byte-for-byte what the live API returns, the shell served
// as index.html, the Desk editor left out entirely, and each volume page rewired
// to read the bundled JSON instead of /api. We seed one temp-file DB and read it
// two ways — through publish() and through the live server — so any drift between
// the snapshot and the running site fails the build.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { createServer } from '../server.js';
import { publish, verifyAssetRefs } from '../scripts/publish.js';

const VOLUME_PAGES = [
  'receptor-function.html',
  'neuroreceptor_pharmacology_explorer_dashboard.html',
  'neuroreceptor_clinical_table.html',
];

// data file -> the live endpoint it must mirror.
const DATA = [
  ['data/cabinet.json', '/api/atlas/cabinet'],
  ['data/cabinet-binding.json', '/api/atlas/cabinet/binding'],
  ['data/ledger.json', '/api/atlas/ledger'],
  ['data/ledger-clinical.json', '/api/atlas/ledger/clinical'],
  ['data/archive-narrative.json', '/api/atlas/archive/narrative'],
];

let dir, outDir, server, base;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'atlas-pub-'));
  const dbPath = join(dir, 'atlas.db');
  const db = openDb(dbPath);
  migrate(db);                     // deterministic seed
  outDir = join(dir, 'dist');
  await publish(db, outDir);
  db.close();

  server = createServer(dbPath);   // the live site reads the very same seeded file
  await new Promise(r => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  // Close the server (which releases its DB handle) before removing the temp dir.
  await new Promise(res => (server ? server.close(res) : res()));
  // Windows can lag releasing the file handle; retry the unlink a few times.
  for (let i = 0; ; i++) {
    try { await rm(dir, { recursive: true, force: true }); break; }
    catch (e) {
      if (i >= 10 || (e.code !== 'EBUSY' && e.code !== 'EPERM')) throw e;
      await new Promise(r => setTimeout(r, 50));
    }
  }
});

for (const [file, endpoint] of DATA) {
  test(`snapshot ${file} is identical to live ${endpoint}`, async () => {
    const emitted = JSON.parse(await readFile(join(outDir, file), 'utf8'));
    const live = await (await fetch(base + endpoint)).json();
    assert.deepEqual(emitted, live);
  });
}

test('the shell ships as index.html alongside the three volume pages', async () => {
  for (const f of ['index.html', ...VOLUME_PAGES])
    assert.ok((await stat(join(outDir, f))).isFile(), `${f} should exist in dist`);
});

test('the Desk editor is excluded and nothing links to it', async () => {
  await assert.rejects(stat(join(outDir, 'the-conservators-desk.html')), 'Desk must not be published');
  const index = await readFile(join(outDir, 'index.html'), 'utf8');
  assert.ok(!index.includes('the-conservators-desk'), 'shell must not link to the Desk');
});

test('each volume page reroutes /api to the bundled JSON', async () => {
  for (const f of VOLUME_PAGES) {
    const html = await readFile(join(outDir, f), 'utf8');
    assert.ok(html.includes('Published snapshot'), `${f} should carry the shim marker`);
    assert.ok(html.includes("'/api/atlas/cabinet': 'data/cabinet.json'"), `${f} should map the API paths`);
  }
});

test('shared assets are carried into the bundle', async () => {
  assert.ok((await stat(join(outDir, 'assets/tokens.css'))).isFile(),
    'assets/tokens.css should exist in dist');
});

test('publish fails when a page references a missing asset', async () => {
  // A page that links an asset the bundle does not contain must break the build,
  // not ship an unstyled site.
  const probeDir = join(dir, 'dist-probe');
  const db = openDb(join(dir, 'atlas.db'));
  await publish(db, probeDir);
  db.close();
  const page = join(probeDir, 'index.html');
  const html = await readFile(page, 'utf8');
  await writeFile(page, html.replace('<head>', '<head><link rel="stylesheet" href="assets/nope.css">'));
  await assert.rejects(
    verifyAssetRefs(probeDir, ['index.html']),
    /missing asset/,
    'a dangling asset reference must throw'
  );
});
