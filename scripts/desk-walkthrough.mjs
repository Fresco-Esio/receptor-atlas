// scripts/desk-walkthrough.mjs — drives desk/desk.html as a tester would. Not part of
// npm test (needs Chromium). Usage: node scripts/desk-walkthrough.mjs --mode local
// (Playwright comes from the global install: NODE_PATH=$(npm root -g) node scripts/desk-walkthrough.mjs --mode local)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import * as core from '../desk/desk-core.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
// ESM ignores NODE_PATH, so resolve Playwright from it (or from the global npm root) by hand.
async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) { /* not local; try the global install */ }
  const roots = (process.env.NODE_PATH || '').split(':').filter(Boolean);
  try { roots.push(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()); } catch (e) { /* no npm */ }
  for (const r of roots) { try { return createRequire(join(r, 'noop.js'))('playwright'); } catch (e) { /* next */ } }
  throw new Error('playwright not found locally, on NODE_PATH or in the global npm root');
}
const { chromium } = await loadPlaywright();
const FILE = join(HERE, '..', 'desk', 'desk.html');
const PAGE = pathToFileURL(FILE).href;
const exe = process.env.CHROMIUM || '/opt/pw-browsers/chromium';
const mi = process.argv.indexOf('--mode'); const mode = mi > 0 ? process.argv[mi + 1] : 'local';
if (mode !== 'local') { console.error(`unknown --mode ${mode} (only "local" exists yet)`); process.exit(2); }
const ok = (name, cond, extra = '') => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); if (!cond) process.exitCode = 1; };
const SEED = JSON.parse(readFileSync(join(HERE, '..', 'desk', 'seed.json'), 'utf8'));

// --- static: the built file is self-contained ---
const html = readFileSync(FILE, 'utf8');
const external = [...html.matchAll(/\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)].map(m => m[0]);
ok('build is self-contained (no <script src>, no fetch(), only Google Fonts)',
  !/<script[^>]*\bsrc=/i.test(html) && !/\bfetch\s*\(/.test(html) && external.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)),
  external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)).join(', '));

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ acceptDownloads: true }); const page = await ctx.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text() + ' ' + ((m.location() || {}).url || ''))) errors.push(m.text()); });
const ready = async (id) => { await page.waitForFunction(() => window.__desk); if (id) await page.selectOption('#rx', id); };
await page.goto(PAGE); await ready();
ok('load without errors', errors.length === 0, errors.join(' | '));
ok('picker lists 24 receptors', await page.locator('#rx option').count() === 24);
const banner0 = await page.locator('#banner').innerText();
ok('banner reads seed <date> · 0 published since · 0 unpublished · store: this browser', banner0 === `seed ${SEED.builtAt.slice(0, 10)} · 0 published since · 0 unpublished · store: this browser`, banner0);

// --- fields: Archive + Ledger for d2, claim (cabinet), nothing that is not there ---
await ready('d2');
const archivePaths = ['abstract', 'presentation', 'effect', 'receptor_class', 'ligand', 'figure_caption'].map(k => `[data-path="archive.${k}"]`);
const counts = async sels => Promise.all(sels.map(s => page.locator(s).count()));
ok('d2 shows every Archive field', (await counts([...archivePaths, '[data-paragraphs="archive.body"]', '[data-list="archive.tags"]'])).every(n => n === 1));
ok('d2 shows every Ledger field', (await counts([...core.CLINICAL_SCALAR.map(k => `[data-scalar="clinical.${k}"]`), ...Object.keys(core.CLINICAL_LIST).map(k => `[data-list="clinical.${k}"]`)])).every(n => n === 1));
ok('d2 shows the Cabinet claim', await page.locator('[data-path="claim"]').count() === 1);
const d2 = SEED.receptors.find(r => r.id === 'd2');
ok('d2 abstract shows the seed text', (await page.locator('[data-path="archive.abstract"]').innerText()) === d2.archive.abstract);
ok('d2 body shows the seed paragraphs', (await page.locator('[data-paragraphs] p').count()) === d2.archive.body.length);
await ready('d3');
ok('d3 (no Ledger row) shows Archive but no Ledger', await page.locator('[data-path="archive.abstract"]').count() === 1 && await page.locator('.ledger').count() === 0);
await ready('m3');
ok('m3 (Cabinet only) shows the claim, no Archive, no Ledger', await page.locator('[data-path="claim"]').count() === 1 && await page.locator('[data-path="archive.abstract"]').count() === 0 && await page.locator('.ledger').count() === 0);

// --- no-op edits are not changes ---
await ready('d2');
const mon = page.locator('[data-list="clinical.monitoring"]');
await mon.fill('temporary'); await page.waitForTimeout(450); await mon.fill(''); await page.waitForTimeout(450);
await page.locator('[data-scalar="clinical.onset"]').fill('x'); await page.waitForTimeout(450); await page.locator('[data-scalar="clinical.onset"]').fill(''); await page.waitForTimeout(450);
ok('typing then clearing a Ledger field leaves no change', await page.evaluate(() => Object.keys(window.__desk.store.get('d2').fields).length === 0));

// --- edit persists (localStorage) ---
await page.locator('[data-path="archive.abstract"]').fill('Walkthrough abstract.');
await page.waitForTimeout(500);
await page.reload(); await ready('d2');
ok('abstract edit persists across reload', (await page.locator('[data-path="archive.abstract"]').innerText()) === 'Walkthrough abstract.');
ok('changed field is marked', await page.locator('[data-f="archive.abstract"] label.changed').count() === 1);
const banner1 = await page.locator('#banner').innerText();
ok('banner counts the unpublished edit', / · 0 published since · 1 unpublished · store: this browser$/.test(banner1), banner1);
ok('picker marks the edited receptor', (await page.locator('#rx option[value="d2"]').innerText()).startsWith('● '));

// --- a pending edit is flushed on receptor switch, onto the receptor it was typed in ---
await page.locator('[data-scalar="clinical.baseline"]').fill('Walkthrough baseline.');
await ready('d1');
const flushed = await page.evaluate(() => ({ d2: (window.__desk.store.get('d2').fields['clinical.baseline'] || {}).value, d1: Object.keys(window.__desk.store.get('d1').fields) }));
ok('switching receptor flushes the pending edit to the right receptor', flushed.d2 === 'Walkthrough baseline.' && flushed.d1.length === 0, JSON.stringify(flushed));

// --- review marks: toggle, persist, no citation/mastery ---
await ready('d2');
ok('d2 mechanism mark comes from the seed', await page.locator('[data-mark="mechanism"]').isChecked());
await page.locator('[data-mark="affinity"]').check(); await page.locator('[data-mark="mechanism"]').uncheck(); await page.waitForTimeout(300);
await page.reload(); await ready('d2');
ok('review marks persist', await page.locator('[data-mark="affinity"]').isChecked() && !(await page.locator('[data-mark="mechanism"]').isChecked()));
await ready('d1');
await page.locator('[data-mark="clinical"]').check(); await page.waitForTimeout(100); await page.locator('[data-mark="clinical"]').uncheck(); await page.waitForTimeout(100);
ok('marks toggled back to the seed leave no review record', await page.evaluate(() => window.__desk.store.get('d1').review === null));

// --- a stored record for a receptor the seed lacks is hidden, never deleted ---
const stray = core.setField(core.emptyChanges('zz', SEED.commit), 'claim', 'stray', '2026-09-26T00:00:00.000Z');
await page.evaluate(z => { const k = 'atlas-desk-changes-v1'; const all = JSON.parse(localStorage.getItem(k)); all.zz = z; localStorage.setItem(k, JSON.stringify(all)); }, stray);
await page.reload(); await ready('d2');
ok('citation and mastery are not shown', (await page.locator('[data-mark="citation"], [data-mark="mastery"]').count()) === 0 && !/citation|mastery/i.test(await page.locator('.review').innerText()) && !/citation|mastery/i.test(await page.locator('.top').innerText()));
await page.locator('[data-note]').fill('walkthrough note'); await page.waitForTimeout(450);
const strayState = await page.evaluate(() => ({ kept: !!JSON.parse(localStorage.getItem('atlas-desk-changes-v1')).zz, listed: window.__desk.store.list().some(c => c.receptorId === 'zz') }));
ok('unknown-receptor record survives a write but is not listed', strayState.kept && !strayState.listed, JSON.stringify(strayState));

// --- download equals the converter ---
const [download] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
ok('download is named curator-state.json', download.suggestedFilename() === 'curator-state.json');
const got = JSON.parse(readFileSync(await download.path(), 'utf8'));
const changes = await page.evaluate(() => window.__desk.store.list());
const expected = await page.evaluate(() => window.__desk.toCuratorState(window.__desk.SEED, window.__desk.store.list()));
ok('download equals the converter', JSON.stringify(got) === JSON.stringify(expected));
ok('download equals the node core on the same changes', JSON.stringify(got) === JSON.stringify(core.toCuratorState(SEED, changes)));
ok('download carries the edit', got.content.archive.d2 && got.content.archive.d2.abstract === 'Walkthrough abstract.');
ok('download carries the review', got.review.d2 && got.review.d2.affinity === 1 && got.review.d2.mechanism === 0 && got.review.d2.note === 'walkthrough note');
ok('download has no spurious Ledger columns', JSON.stringify(Object.keys(got.content.clinical[d2.clinicalNo] || {}).filter(k => k !== 'baseline' && !(k in (SEED.baseState.content.clinical[d2.clinicalNo] || {})))) === '[]', JSON.stringify(got.content.clinical[d2.clinicalNo]));
ok('no page errors during the walkthrough', errors.length === 0, errors.join(' | '));

// --- simulated claude.ai frame: a fake window.claude with db + downloads, same page from disk ---
async function framePage(cfg) {
  const fctx = await browser.newContext({ acceptDownloads: true });
  await fctx.addInitScript(cfg => {
    const L = window.__fakeLog = { sets: [], inflight: 0, maxInflight: 0, reads: 0, saves: [] };
    window.claude = { use: async name => {
      if (name === 'db') {
        if (cfg.db === 'none') return null;
        return {
          collection: () => ({ get: async () => { L.reads++; if (cfg.db === 'down' || (cfg.db === 'flaky' && L.reads === 1)) throw { code: 'unavailable', message: 'x' }; return { docs: Object.entries(cfg.docs || {}).map(([id, d]) => ({ id, data: () => d })) }; } }),
          doc: path => ({ set: async obj => { L.inflight++; L.maxInflight = Math.max(L.maxInflight, L.inflight); await new Promise(r => setTimeout(r, 80)); L.inflight--; L.sets.push({ path, obj }); } }),
        };
      }
      if (name === 'downloads') {
        if (cfg.dl === 'none') return null;
        return { save: async req => { L.saves.push(req.filename); if (cfg.dl === 'unavailable') throw { code: 'unavailable', message: 'x' }; return { status: 'saved' }; } };
      }
      return null;
    } };
  }, cfg);
  const p = await fctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let downloads = 0; p.on('download', () => downloads++);
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk, null, { timeout: 15000 });
  return { p, fctx, errs, downloads: () => downloads, log: () => p.evaluate(() => window.__fakeLog) };
}
{ // db never answers: retried once, then this browser, with a toast
  const f = await framePage({ db: 'down', dl: 'ok' });
  const toastText = await f.p.locator('.toast').innerText().catch(() => '');
  ok('frame: a failing store read is retried once, then the page works in this browser',
    (await f.log()).reads === 2 && / · store: this browser$/.test(await f.p.locator('#banner').innerText()) && toastText === 'claude.ai store did not answer; working in this browser', toastText);
  await f.p.selectOption('#rx', 'd2'); await f.p.locator('[data-path="archive.abstract"]').fill('Local.'); await f.p.waitForTimeout(450);
  ok('frame: after the fallback no write goes to the store', (await f.log()).sets.length === 0 && await f.p.evaluate(() => !!JSON.parse(localStorage.getItem('atlas-desk-changes-v1')).d2));
  await f.fctx.close();
}
{ // db answers on the retry: claude.ai mode with the stored documents; writes serialised; download via the capability
  const stored = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.abstract', 'From the store.', '2026-09-26T00:00:00.000Z');
  const f = await framePage({ db: 'flaky', dl: 'ok', docs: { d2: stored } });
  await f.p.selectOption('#rx', 'd2');
  ok('frame: store mode shows the stored documents', / · store: claude\.ai$/.test(await f.p.locator('#banner').innerText()) && (await f.p.locator('[data-path="archive.abstract"]').innerText()) === 'From the store.');
  for (const m of ['mechanism', 'affinity', 'clinical']) await f.p.locator(`[data-mark="${m}"]`).click();
  await f.p.locator('[data-note]').fill('burst'); await f.p.evaluate(() => window.__desk.flush());
  await f.p.waitForTimeout(600);
  const L = await f.log(); const last = L.sets.filter(s => s.path === 'changes/d2').pop();
  ok('frame: a burst of edits is written one at a time and the last write carries the newest state',
    L.maxInflight === 1 && L.sets.length < 5 && last && last.obj.review.note === 'burst' && last.obj.review.mechanism === 0 && last.obj.review.affinity === 1 && last.obj.review.clinical === 1,
    `sets=${L.sets.length} maxInflight=${L.maxInflight}`);
  await f.p.click('#dl'); await f.p.waitForTimeout(300);
  ok('frame: Download goes through the downloads capability, never <a download>', (await f.log()).saves.join() === 'curator-state.json' && f.downloads() === 0);
  ok('frame: no page errors', f.errs.length === 0, f.errs.join(' | '));
  await f.fctx.close();
}
{ // downloads capability absent: the button is hidden
  const f = await framePage({ db: 'none', dl: 'none' });
  await f.p.waitForTimeout(100);
  ok('frame: Download is hidden when the downloads capability is absent', !(await f.p.locator('#dl').isVisible()));
  await f.fctx.close();
}
{ // downloads capability rejects unavailable: hidden after the attempt, no fallback download
  const f = await framePage({ db: 'none', dl: 'unavailable' });
  await f.p.click('#dl'); await f.p.waitForTimeout(300);
  ok('frame: Download hides itself on "unavailable" and does not fall back', !(await f.p.locator('#dl').isVisible()) && f.downloads() === 0);
  await f.fctx.close();
}
await browser.close();
