// Structured Desk edits (a binding value, a clinical field, archive narrative) must
// survive a server restart. A restart re-runs migrate() against the already-seeded
// file DB; if that re-migrate rebuilds binding_values/clinical_rows/archive_entries
// from the volume HTML it silently clobbers the curator's edits. We prove the whole
// round-trip through the real HTTP surface: boot a seeded file-backed server, PATCH
// edits, close it (which releases the DB handle), then boot again on the SAME file
// (seed:true → migrate runs) and read the edits back.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server.js';

// Boot a seeded server on dbPath, run fn(base), then close it. server.close() fires
// the 'close' handler that calls db.close(), releasing the file so the next boot is a
// genuine cold start rather than a second live connection to the same WAL.
async function boot(dbPath, fn) {
  const server = createServer(dbPath, { seed: true });
  await new Promise(r => server.listen(0, r));
  try {
    return await fn(`http://localhost:${server.address().port}`);
  } finally {
    await new Promise(res => server.close(res));
  }
}

const patch = (base, body) => fetch(`${base}/api/receptors/gabaa/structured`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const structured = async (base) => (await fetch(`${base}/api/receptors/gabaa/structured`)).json();

test('structured edits survive a server restart (re-migrate does not clobber)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-persist-'));
  const dbPath = join(dir, 'atlas.db');
  try {
    // Boot 1: seed, then edit one binding value, one clinical field, and the narrative.
    await boot(dbPath, async (base) => {
      const s = await structured(base);
      const diazepam = s.binding.find(b => b.agent_name === 'Diazepam');
      assert.ok(diazepam, 'seed should include a Diazepam binding for gabaa');

      assert.equal((await patch(base, { volume: 'cabinet', binding: { id: diazepam.id, ki: 1.23, note: 'recheck' } })).status, 200);
      assert.equal((await patch(base, { volume: 'ledger', clinical: { baseline: 'EDITED baseline', over: ['x', 'y'] } })).status, 200);
      assert.equal((await patch(base, { volume: 'archive', narrative: { abstract: 'EDITED abstract', body: ['p1', 'p2'] } })).status, 200);
    });

    // Boot 2: same file → migrate() runs again (the "restart"). Every edit must remain.
    await boot(dbPath, async (base) => {
      const s = await structured(base);

      // Look the binding up by its STABLE (agent_name) identity, not its id — a
      // clobbering rebuild would both reset the value and hand it a new id.
      const diazepam = s.binding.find(b => b.agent_name === 'Diazepam');
      assert.ok(diazepam, 'Diazepam binding still present after restart');
      assert.equal(diazepam.ki, 1.23, 'edited Ki survived restart');
      assert.equal(diazepam.note, 'recheck', 'edited note survived restart');

      assert.equal(s.clinical.baseline, 'EDITED baseline', 'edited clinical field survived restart');
      assert.deepEqual(s.clinical.over, ['x', 'y'], 'edited clinical list survived restart');

      assert.equal(s.narrative.abstract, 'EDITED abstract', 'edited narrative field survived restart');
      assert.deepEqual(s.narrative.body, ['p1', 'p2'], 'edited narrative list survived restart');
    });
  } finally {
    // Windows keeps the .db file briefly locked after close; retry the rmdir a few times.
    for (let i = 0; ; i++) {
      try { await rm(dir, { recursive: true, force: true }); break; }
      catch (e) {
        if (i >= 10 || (e.code !== 'EBUSY' && e.code !== 'EPERM')) throw e;
        await new Promise(r => setTimeout(r, 50));
      }
    }
  }
});
