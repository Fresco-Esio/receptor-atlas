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
const fetches = (html.match(/\bfetch\s*\(/g) || []).length;
ok('build is self-contained (no <script src>, one fetch() to api.github.com, only Google Fonts loaded)',
  !/<script[^>]*\bsrc=/i.test(html) && fetches === 1 && html.includes("GH_API = 'https://api.github.com'") && external.every(u => /fonts\.(googleapis|gstatic)\.com/.test(u)),
  `fetch() × ${fetches}; ` + external.filter(u => !/fonts\.(googleapis|gstatic)\.com/.test(u)).join(', '));
// api.github.com answers Cache-Control: private, max-age=60, and the GET (?ref=main) is not the PUT's URL, so a cached
// GET would hand a second publish a stale blob sha. Playwright's routing turns the HTTP cache off, so this is static.
ok('the GitHub fetch() bypasses the HTTP cache (cache: \'no-store\')', /\bfetch\s*\(GH_API \+ path, \{[^}]*\bcache: 'no-store'/.test(html));
// shipped hidden, so nothing flashes in the claude.ai frame before the script decides; browser mode un-hides them
const tagOf = id => (html.match(new RegExp(`<button[^>]*\\bid="${id}"[^>]*>`)) || [''])[0];
ok('Publish, GitHub… and Import changes ship hidden in the markup', ['pub', 'ghset', 'imp'].every(id => /\bclass="[^"]*\bhidden\b/.test(tagOf(id))), ['pub', 'ghset', 'imp'].map(tagOf).join(' | '));

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
ok('in this browser "Download changes" is the first, primary action; the edits file says it is a full replacement',
  await page.evaluate(() => { const c = document.querySelector('#dlc'), d = document.querySelector('#dl'); return c.classList.contains('primary') && c.nextElementSibling === d && d.textContent === 'Download edits file (full replacement)'; }));
const [dlc] = await Promise.all([page.waitForEvent('download'), page.click('#dlc')]);
const rawChanges = JSON.parse(readFileSync(await dlc.path(), 'utf8'));
ok('"Download changes" saves changes.json, deep-equal to the store', dlc.suggestedFilename() === 'changes.json' && JSON.stringify(rawChanges) === JSON.stringify(await page.evaluate(() => window.__desk.store.list())));
ok('no page errors during the walkthrough', errors.length === 0, errors.join(' | '));

// --- Provenance layer: attach by hand, then span, then conflict ---
const selectIn = (sel, a, b) => page.locator(sel).first().evaluate((el, [a, b]) => { const r = document.createRange(); r.setStart(el.firstChild, a); r.setEnd(el.firstChild, b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); }, [a, b]);
await page.selectOption('#rx', 'd2');
ok('the citing hint shows above the abstract while the receptor has no brackets', await page.evaluate(() => { const h = document.querySelector('#hint'); return !!h && h.classList.contains('tiny') && h.nextElementSibling === document.querySelector('[data-f="archive.abstract"]') && /^Select a sentence, then choose the source that supports it\. Brackets and their cards appear as you go\./.test(h.innerText); }));
const d2body0 = d2.archive.body[0];
const abstractEl = page.locator('[data-path="archive.abstract"]');
await abstractEl.evaluate(el => { const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 11); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
ok('the popover reads "Attach to: “<first 40 characters>…”"', (await page.locator('#pop .l').innerText()) === `Attach to: “${(await page.evaluate(() => window.__desk.view().archive.abstract)).slice(0, 11)}”`, await page.locator('#pop .l').innerText());
ok('the popover offers one chip per attached source', (await page.locator('#pop [data-cite]').count()) === (await page.evaluate(() => window.__desk.view().sources.length)));
await page.click('text=+ add source');
ok('without the connector the source form is by hand only', (await page.locator('[data-lookup]').count()) === 0 && (await page.locator('.modal [name=title]').count()) === 1);
await page.fill('[name=title]', 'Walkthrough paper'); await page.fill('[name=authors]', 'Tester T'); await page.fill('[name=year]', '2026'); await page.fill('[name=journal]', 'J Test'); await page.fill('[name=pmid]', '999999');
await page.click('text=Attach'); await page.waitForTimeout(300);
ok('span drawn in the abstract', (await page.locator('[data-path="archive.abstract"] .cite').count()) === 1);
ok('the hint is gone once the receptor has a bracket', (await page.locator('#hint').count()) === 0);
ok('one card per attached source', (await page.locator('#margin .mcard').count()) === (await page.evaluate(() => window.__desk.view().sources.length)));
ok('a flow line per span', (await page.locator('#flow path').count()) === (await page.locator('#editor .cite').count()) && (await page.locator('#flow path').count()) === 1);
const stored = await page.evaluate(() => window.__desk.store.get('d2'));
ok('the span is stored as { field, start, end, text, sourceKey, at }', stored.spans.length === 1 && JSON.stringify(Object.keys(stored.spans[0])) === '["field","start","end","text","sourceKey","at"]' && stored.spans[0].field === 'archive.abstract' && stored.spans[0].start === 0 && stored.spans[0].end === 11 && stored.spans[0].text === 'Walkthrough' && stored.spans[0].sourceKey === 'pmid:999999', JSON.stringify(stored.spans));
const hues = await page.evaluate(() => ({ span: document.querySelector('[data-path="archive.abstract"] .cite').style.getPropertyValue('--h'), card: document.querySelector('#margin .mcard[data-key="pmid:999999"]').style.getPropertyValue('--h'), path: document.querySelector('#flow path[data-key="pmid:999999"]')?.getAttribute('stroke') }));
ok('span, card and flow line share the source hue', hues.span && hues.span === hues.card && hues.path === `hsl(${hues.span} 55% 36%)`, JSON.stringify(hues));
ok('the new card is marked added and can be detached', (await page.locator('#margin .mcard[data-key="pmid:999999"][data-added] [data-detach]').count()) === 1);
await page.locator('#margin .mcard[data-key="pmid:999999"] [data-flag="conflicting"]').check();
await page.fill('#margin .mcard[data-key="pmid:999999"] textarea', 'disagrees on onset'); await page.waitForTimeout(400);
const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl')]);
const got2 = JSON.parse(readFileSync(await dl2.path(), 'utf8'));
const edge = got2.receptorSources.find(e => e.receptor_id === 'd2' && e.source === 'pmid:999999');
ok('conflict flag reaches the edits file', edge && edge.status === 'conflicting' && edge.correction_note === 'disagrees on onset', JSON.stringify(edge));
ok('the card status follows the flag and keeps its added date', /^conflicting · added \d{4}-\d\d-\d\d$/.test(await page.locator('#margin .mcard[data-key="pmid:999999"] [data-status]').innerText()));
ok('seeded sources have no detach control', (await page.locator('#margin .mcard:not([data-added]) [data-detach]').count()) === 0);
await page.locator('#margin .mcard[data-key="pmid:999999"] [data-flag="conflicting"]').uncheck(); await page.waitForTimeout(100);
const unflagged = await page.evaluate(() => window.__desk.store.get('d2').sources.add.find(a => a.key === 'pmid:999999'));
ok('unchecking "conflicts with the text" hides and clears the note', !unflagged.conflicting && unflagged.correction_note === null && !(await page.locator('#margin .mcard[data-key="pmid:999999"] textarea').isVisible()), JSON.stringify(unflagged));
// a seeded source flagged and unflagged leaves no record
const seededKey = d2.sources[0].key;
await page.locator(`#margin .mcard[data-key="${seededKey}"] [data-flag="conflicting"]`).check(); await page.waitForTimeout(100);
const setOn = await page.evaluate(k => !!window.__desk.store.get('d2').sources.set[k], seededKey);
await page.locator(`#margin .mcard[data-key="${seededKey}"] [data-flag="conflicting"]`).uncheck(); await page.waitForTimeout(100);
ok('a seeded source flagged then unflagged leaves no record', setOn && await page.evaluate(k => !(k in window.__desk.store.get('d2').sources.set), seededKey));
// primary on a seeded 'provided' edge keeps it 'provided'
const providedKey = d2.sources.find(x => x.status === 'provided').key;
const provCard = `#margin .mcard[data-key="${providedKey}"]`;
await page.locator(`${provCard} [data-flag="is_primary"]`).check(); await page.waitForTimeout(100);
const provEdge = await page.evaluate(k => window.__desk.toCuratorState(window.__desk.SEED, window.__desk.store.list()).receptorSources.find(e => e.receptor_id === 'd2' && e.source === k), providedKey);
ok('primary on a seeded provided source exports provided, and the card says so', provEdge && provEdge.status === 'provided' && provEdge.is_primary === 1 && (await page.locator(`${provCard} [data-st]`).innerText()) === 'provided', JSON.stringify(provEdge));
await page.locator(`${provCard} [data-flag="is_primary"]`).uncheck(); await page.waitForTimeout(100);
ok('primary toggled back leaves no record', await page.evaluate(k => !(k in window.__desk.store.get('d2').sources.set), providedKey));
// an overlapping selection is refused
await selectIn('[data-path="archive.abstract"] .cite', 0, 4);
ok('a selection inside a bracket is refused', (await page.locator('#pop').count()) === 0 && /overlaps/.test(await page.locator('.toast').innerText().catch(() => '')));
await page.evaluate(() => { document.querySelector('#toastRoot').innerHTML = ''; document.querySelector('[data-path="archive.abstract"]').dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })); });
ok('a refused selection grown by keyboard does not toast again', (await page.locator('.toast').count()) === 0);
// a chip cites an attached source; the body is one <p data-field> per paragraph
ok('the body has one <p data-field="archive.body.n"> per paragraph', (await page.locator('[data-paragraphs] p[data-field="archive.body.0"]').count()) === 1);
await selectIn('[data-paragraphs] p[data-field="archive.body.0"]', 4, 14);
await page.click(`#pop [data-cite="${seededKey}"]`); await page.waitForTimeout(200);
const bodySpan = await page.evaluate(() => window.__desk.store.get('d2').spans.find(s => s.field === 'archive.body.0'));
ok('a chip draws a bracket in the body paragraph', bodySpan && bodySpan.start === 4 && bodySpan.end === 14 && bodySpan.text === d2body0.slice(4, 14) && (await page.locator('[data-paragraphs] .cite').count()) === 1, JSON.stringify(bodySpan));
// clicking a bracket opens its card
await page.locator('[data-paragraphs] .cite').click(); await page.waitForTimeout(100);
ok('clicking a bracket opens its card and dims the others', (await page.locator(`#margin .mcard.open[data-key="${seededKey}"]`).count()) === 1 && (await page.locator('#margin .mcard.dim').count()) === (await page.locator('#margin .mcard').count()) - 1);
// typing before a bracket moves it with its text
await abstractEl.evaluate(el => { el.focus(); el.insertBefore(document.createTextNode('New. '), el.firstChild); el.dispatchEvent(new InputEvent('input', { bubbles: true })); });
await page.waitForTimeout(450); await page.locator('[data-note]').focus(); await page.waitForTimeout(100);
const moved = await page.evaluate(() => window.__desk.store.get('d2').spans.find(s => s.field === 'archive.abstract'));
const movedOk =  moved && moved.start === 5 && moved.end === 16 && moved.text === 'Walkthrough' && (await page.locator('[data-path="archive.abstract"] .cite').innerText()) === 'Walkthrough';
ok('an edit before a bracket moves the bracket with its text', movedOk, JSON.stringify(moved));
// typing the bracket's own first letter just before it: the caret places the edit, the bracket stays exact
await abstractEl.evaluate(el => { el.focus(); const t = el.firstChild; const r = document.createRange(); r.setStart(t, t.length); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
await page.keyboard.type('W'); await page.waitForTimeout(450); await page.locator('[data-note]').focus(); await page.waitForTimeout(100);
const w1 = await page.evaluate(() => window.__desk.store.get('d2').spans.find(s => s.field === 'archive.abstract'));
ok('typing W before [Walkthrough] leaves the bracket reading exactly Walkthrough', w1 && w1.text === 'Walkthrough' && w1.start === 6 && (await page.locator('[data-path="archive.abstract"] .cite').innerText()) === 'Walkthrough' && (await page.evaluate(() => window.__desk.view().archive.abstract)) === 'New. WWalkthrough abstract.', JSON.stringify(w1));
// the same edit with no caret to go by (the ambiguous prefix/suffix fallback)
await abstractEl.evaluate(el => { el.focus(); getSelection().removeAllRanges(); el.firstChild.data += 'W'; el.dispatchEvent(new InputEvent('input', { bubbles: true })); });
await page.waitForTimeout(450); await page.locator('[data-note]').focus(); await page.waitForTimeout(100);
const w2 = await page.evaluate(() => window.__desk.store.get('d2').spans.find(s => s.field === 'archive.abstract'));
ok('without a caret an ambiguous edit keeps the bracket text rather than re-scoping it', w2 && w2.text === 'Walkthrough' && w2.start === 7 && (await page.evaluate(() => window.__desk.view().archive.abstract)) === 'New. WWWalkthrough abstract.', JSON.stringify(w2));
// a stored span whose text is gone is dropped on load, with a toast
await page.evaluate(() => { const k = 'atlas-desk-changes-v1'; const all = JSON.parse(localStorage.getItem(k)); all.d2.spans.push({ field: 'archive.abstract', start: 0, end: 4, text: 'Nope', sourceKey: 'pmid:999999', at: '2026-09-26T00:00:00.000Z' }); localStorage.setItem(k, JSON.stringify(all)); });
await page.reload(); await ready('d2');
ok('a span that no longer matches is dropped on load with a toast', (await page.locator('.toast').innerText().catch(() => '')) === '1 span no longer matches the text and was removed' && await page.evaluate(() => window.__desk.store.get('d2').spans.length === 2) && (await page.locator('#editor .cite').count()) === 2);
// a span whose source is not attached (a re-seed took it) is dropped on load too
await page.evaluate(() => { const k = 'atlas-desk-changes-v1'; const all = JSON.parse(localStorage.getItem(k)); all.d2.spans.push({ field: 'archive.abstract', start: 0, end: 3, text: 'New', sourceKey: 'pmid:0', at: '2026-09-26T00:00:00.000Z' }); localStorage.setItem(k, JSON.stringify(all)); });
await page.reload(); await ready('d2');
ok('a span whose source has no card is dropped on load with a toast', (await page.locator('.toast').innerText().catch(() => '')) === '1 span no longer matches the text and was removed' && await page.evaluate(() => !window.__desk.store.get('d2').spans.some(s => s.sourceKey === 'pmid:0')));
// detaching an added source takes its card and its brackets
await page.click('#margin .mcard[data-key="pmid:999999"] [data-detach]'); await page.waitForTimeout(100);
ok('Detach removes the card and its brackets', (await page.locator('#margin .mcard[data-key="pmid:999999"]').count()) === 0 && (await page.locator('[data-path="archive.abstract"] .cite').count()) === 0 && await page.evaluate(() => !window.__desk.store.get('d2').sources.add.length));
// focus moving from the abstract into the body leaves the caret where it was clicked
const absBefore = await page.evaluate(() => window.__desk.view().archive.abstract);
const body0Before = await page.evaluate(() => window.__desk.view().archive.body[0]);
await abstractEl.click();
const at = 30;
const pt = await page.locator('[data-paragraphs] p[data-field="archive.body.0"]').evaluate((p, at) => {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let n, left = at;
  while ((n = w.nextNode()) && left > n.length) left -= n.length;
  const r = document.createRange(); r.setStart(n, left); r.setEnd(n, left + 1); const b = r.getBoundingClientRect(); return { x: b.left + 1, y: b.top + b.height / 2 };
}, at);
await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(50);
await page.keyboard.type('ZZ'); await page.waitForTimeout(450); await page.locator('[data-note]').focus(); await page.waitForTimeout(100);
const after = await page.evaluate(() => ({ abs: window.__desk.view().archive.abstract, b0: window.__desk.view().archive.body[0] }));
ok('clicking from the abstract into the body types where clicked; the abstract is untouched', after.b0 === body0Before.slice(0, at) + 'ZZ' + body0Before.slice(at) && after.abs === absBefore, JSON.stringify({ b0: after.b0.slice(0, 50) }));
// re-checking "conflicts" on a seeded conflicting edge brings its seeded note back
const conflicted = SEED.receptors.flatMap(r => r.sources.map(x => ({ id: r.id, ...x }))).find(x => x.status === 'conflicting');
await page.selectOption('#rx', conflicted.id);
const confCard = `#margin .mcard[data-key="${conflicted.key}"]`;
await page.locator(`${confCard} [data-flag="conflicting"]`).uncheck(); await page.waitForTimeout(100);
const clearedNote = await page.locator(`${confCard} textarea`).inputValue();
await page.locator(`${confCard} [data-flag="conflicting"]`).check(); await page.waitForTimeout(100);
const recheck = await page.evaluate(k => ({ note: window.__desk.view().sources.find(x => x.key === k).correction_note, status: window.__desk.view().sources.find(x => x.key === k).status, rec: window.__desk.store.get(window.__desk.view().id).sources.set[k] || null }), conflicted.key);
ok('re-checking "conflicts" on a seeded conflicting edge restores its seeded note (and so leaves no record)',
  clearedNote === '' && (await page.locator(`${confCard} textarea`).inputValue()) === conflicted.correction_note && recheck.note === conflicted.correction_note && recheck.status === 'conflicting' && recheck.rec === null, JSON.stringify(recheck));
// the hint's × dismisses it for good (this browser)
await page.selectOption('#rx', 'd1');
const hintBefore = await page.locator('#hint').count();
await page.click('#hint [data-hint-x]');
const hintAfter = await page.locator('#hint').count();
await page.reload(); await ready('d1');
ok('the hint is dismissed by its × and stays dismissed across a reload', hintBefore === 1 && hintAfter === 0 && (await page.locator('#hint').count()) === 0);
ok('no page errors in the Provenance layer', errors.length === 0, errors.join(' | '));

// --- Publish button (browser mode) against a faked GitHub ---
const utf8b64 = t => Buffer.from(t, 'utf8').toString('base64');
async function fakeGitHub(context, cfg) {
  const log = { gets: 0, puts: [], putAuth: [], compares: [], auth: [] };
  await context.route('https://api.github.com/**', async route => {
    const req = route.request(); const url = new URL(req.url()); log.auth.push(req.headers()['authorization'] || '');
    const contents = url.pathname === '/repos/Fresco-Esio/receptor-atlas/contents/db/curator-state.json';
    if (contents && req.method() === 'GET') {
      log.gets++;
      if (cfg.status) return route.fulfill({ status: cfg.status, contentType: 'application/json', body: JSON.stringify({ message: 'Bad credentials' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: 'blob111', encoding: 'base64', content: utf8b64(JSON.stringify(cfg.repoState, null, 1) + '\n').replace(/(.{60})/g, '$1\n') }) });
    }
    if (contents && req.method() === 'PUT') { log.puts.push(JSON.parse(req.postData())); log.putAuth.push(req.headers()['authorization'] || ''); if (cfg.putDelayMs) await new Promise(r => setTimeout(r, cfg.putDelayMs)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: 'blob222' }, commit: { sha: 'c0ffee1234567890c0ffee1234567890c0ffee12', html_url: 'https://github.com/Fresco-Esio/receptor-atlas/commit/c0ffee1' } }) }); }
    const m = url.pathname.match(/\/compare\/([^.]+)\.\.\.(.+)$/);
    if (m) { log.compares.push(m[1]); if (cfg.delayMs) await new Promise(r => setTimeout(r, cfg.delayMs)); if (cfg.compare404) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' }); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: (cfg.ancestors || []).includes(m[1]) ? 'ahead' : 'diverged' }) }); }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Not Found"}' });
  });
  return log;
}
{
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const perrs = []; p.on('pageerror', e => perrs.push(e.message));
  const gh = await fakeGitHub(pctx, { repoState: SEED.baseState });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.selectOption('#rx', 'd2');
  ok('browser mode shows Publish and GitHub…', await p.locator('#pub:not(.hidden)').count() === 1 && await p.locator('#ghset:not(.hidden)').count() === 1);
  await p.locator('#pub').click(); await p.waitForTimeout(200);
  ok('nothing to publish: toast, no request', (await p.locator('.toast').innerText()).includes('Nothing to publish') && gh.gets === 0);
  await p.locator('[data-path="archive.abstract"]').fill('Published from the button.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForTimeout(200);
  ok('no token: the token dialog opens first', await p.locator('#modalBg #gh-h').count() === 1 && await p.locator('#modalBg [name=token]').getAttribute('type') === 'password' && await p.locator('#modalBg [name=remember]').isChecked());
  await p.locator('#modalBg [name=token]').fill('github_pat_TEST'); await p.locator('#modalBg [data-save]').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pc-h'));
  ok('token remembered in this browser', await p.evaluate(() => localStorage.getItem('atlas-desk-github-token')) === 'github_pat_TEST');
  ok('after Save the publish continues: the repo file was read with the token, confirm shows the subject', gh.gets === 1 && gh.auth[0] === 'Bearer github_pat_TEST' && await p.locator('#modalBg #pc-h').count() === 1 && (await p.locator('#modalBg').innerText()).includes('curate: 1 narrative edit'));
  await p.locator('#modalBg [data-cancel]').click(); await p.waitForTimeout(100);
  ok('cancel sends no PUT and marks nothing', gh.puts.length === 0 && await p.evaluate(() => !window.__desk.store.get('d2').fields['archive.abstract'].publishedAs));
  // a confirm dialog closed another way (the picker's onchange calls closeModal) still settles: the button comes back
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pc-h'));
  await p.selectOption('#rx', 'd1'); await p.waitForTimeout(200);
  ok('a confirm dialog closed by a receptor switch settles: Publish re-enabled, no PUT', await p.evaluate(() => document.querySelector('#pub').textContent === 'Publish' && !document.querySelector('#pub').disabled && !document.querySelector('#modalBg')) && gh.puts.length === 0);
  await p.selectOption('#rx', 'd2');
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pc-h')); await p.locator('#modalBg [data-go]').click();
  await p.waitForFunction(() => document.querySelector('#pub').textContent === 'Publish' && !document.querySelector('#pub').disabled);
  // marking changes publishedAs only; the converter reads values, so the store still converts to the committed bytes
  const expectedText = await p.evaluate(() => JSON.stringify(window.__desk.toCuratorState(window.__desk.SEED, window.__desk.store.list()), null, 1) + '\n');
  const put = gh.puts[0] || {};
  ok('PUT carries the subject, the blob sha, the branch, and the converter\'s bytes', gh.puts.length === 1 && put.message === 'curate: 1 narrative edit' && put.sha === 'blob111' && put.branch === 'main' && Buffer.from(put.content, 'base64').toString('utf8') === expectedText);
  ok('the PUT is sent with the token in the Authorization header', gh.putAuth.length === 1 && gh.putAuth[0] === 'Bearer github_pat_TEST', JSON.stringify(gh.putAuth.map(a => a.slice(0, 12))));
  ok('every publish attempt reads the repo file (three attempts, three GETs)', gh.gets === 3, `gets=${gh.gets}`);
  ok('records marked published with the commit sha; receipt stored; banner shows it', await p.evaluate(() => window.__desk.store.get('d2').fields['archive.abstract'].publishedAs === 'c0ffee1234567890c0ffee1234567890c0ffee12' && JSON.parse(localStorage.getItem('atlas-desk-last-publish')).sha.startsWith('c0ffee1')) && /· last published c0ffee1 · \d{4}-\d{2}-\d{2}$/.test(await p.locator('#banner').innerText()));
  ok('publish pass: no page errors', perrs.length === 0, perrs.join(' | '));
  await pctx.close();
}
{ // the repo moved: refusal, no PUT
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const moved = JSON.parse(JSON.stringify(SEED.baseState)); moved.review.d1 = { mechanism: 1, affinity: 0, clinical: 0, citation: 0, mastery: 0, note: 'moved elsewhere' };
  const gh = await fakeGitHub(pctx, { repoState: moved });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.evaluate(() => localStorage.setItem('atlas-desk-github-token', 't'));
  await p.selectOption('#rx', 'd2'); await p.locator('[data-path="archive.abstract"]').fill('Blocked.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #pr-h'));
  ok('a moved repo file is refused, naming the keys, with no PUT', (await p.locator('#modalBg').innerText()).includes('review') && gh.puts.length === 0 && await p.evaluate(() => !window.__desk.store.get('d2').fields['archive.abstract'].publishedAs));
  await pctx.close();
}
{ // a rejected token
  const pctx = await browser.newContext(); const p = await pctx.newPage();
  const gh = await fakeGitHub(pctx, { repoState: SEED.baseState, status: 401 });
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk); await p.evaluate(() => localStorage.setItem('atlas-desk-github-token', 'bad'));
  await p.selectOption('#rx', 'd2'); await p.locator('[data-path="archive.abstract"]').fill('Unauthorised.'); await p.waitForTimeout(500);
  await p.locator('#pub').click(); await p.waitForFunction(() => document.querySelector('#modalBg #gh-h'));
  ok('401 → toast "rejected the token", token dialog, nothing marked, no PUT', (await p.locator('.toast').innerText()).includes('rejected the token') && gh.puts.length === 0 && await p.locator('#modalBg [data-forget]').count() === 1);
  await p.locator('#modalBg [data-forget]').click(); await p.waitForTimeout(100);
  ok('Forget clears the stored token', await p.evaluate(() => localStorage.getItem('atlas-desk-github-token')) === null);
  ok('after a rejected token the Publish button is back and enabled', await p.evaluate(() => document.querySelector('#pub').textContent === 'Publish' && !document.querySelector('#pub').disabled));
  await pctx.close();
}
{ // the token dialog on its own: empty Save, remember off (session only), Forget; a malformed receipt does not break the page
  const pctx = await browser.newContext();
  await pctx.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('atlas-desk-last-publish', JSON.stringify({ sha: 'abc' })); } });
  const p = await pctx.newPage(); const perrs = []; p.on('pageerror', e => perrs.push(e.message));
  await p.goto(PAGE); await p.waitForFunction(() => window.__desk, null, { timeout: 15000 });
  ok('a malformed publish receipt is ignored: the page renders, no receipt in the banner', perrs.length === 0 && !(await p.locator('#banner').innerText()).includes('last published') && await p.locator('#rx option').count() === 24, perrs.join(' | '));
  await p.locator('#ghset').click(); await p.waitForFunction(() => document.querySelector('#modalBg #gh-h'));
  ok('no token held: the dialog offers no Forget', await p.locator('#modalBg [data-forget]').count() === 0);
  await p.locator('#modalBg [data-save]').click(); await p.waitForTimeout(100);
  ok('Save with an empty field: toast "Paste a token first." and the dialog stays open', (await p.locator('.toast').innerText()).includes('Paste a token first.') && await p.locator('#modalBg #gh-h').count() === 1);
  await p.locator('#modalBg [name=token]').fill('github_pat_SESSION'); await p.locator('#modalBg [name=remember]').uncheck(); await p.locator('#modalBg [data-save]').click(); await p.waitForTimeout(100);
  ok('remember off: nothing is stored in this browser', await p.locator('#modalBg').count() === 0 && await p.evaluate(() => localStorage.getItem('atlas-desk-github-token')) === null);
  await p.locator('#ghset').click(); await p.waitForFunction(() => document.querySelector('#modalBg #gh-h'));
  ok('a session-only token can be forgotten: the dialog offers Forget', await p.locator('#modalBg [data-forget]').count() === 1);
  await p.locator('#modalBg [data-forget]').click(); await p.waitForTimeout(100);
  await p.locator('#ghset').click(); await p.waitForFunction(() => document.querySelector('#modalBg #gh-h'));
  ok('Forget drops the session token too', await p.locator('#modalBg [data-forget]').count() === 0);
  await p.locator('#modalBg [data-cancel]').click();
  ok('token dialog pass: no page errors', perrs.length === 0, perrs.join(' | '));
  await pctx.close();
}
// --- re-key on load (browser mode) ---
const staleDoc = (rev) => { let d = core.setField(core.emptyChanges('d2', 'oldseed'), 'claim', 'was published', '2026-09-20T10:00:00.000Z'); d = core.markPublished(d, 'sha1'); d = core.setField(d, 'archive.abstract', 'still unpublished', '2026-09-21T10:00:00.000Z'); if (rev) d = core.clearField(core.markPublished(core.setField(d, 'archive.effect', 'x', '2026-09-20T10:00:00.000Z'), 'sha1'), 'archive.effect', '2026-09-22T10:00:00.000Z'); return d; };
async function loadWith(cfg, doc) {
  const c = await browser.newContext(); const p = await c.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  const gh = cfg.abort ? null : await fakeGitHub(c, cfg);
  const aborted = { n: 0 };
  if (cfg.abort) await c.route('https://api.github.com/**', r => { aborted.n++; return r.abort(); });
  await p.addInitScript(([all, tok]) => { if (!localStorage.getItem('atlas-desk-changes-v1')) localStorage.setItem('atlas-desk-changes-v1', JSON.stringify(all)); if (tok) localStorage.setItem('atlas-desk-github-token', tok); }, [cfg.docs || { d2: doc }, cfg.token || '']);
  await p.goto(PAGE); await p.waitForFunction(cfg.noWait ? () => window.__desk : () => window.__desk && window.__desk.rekeyDone);
  return { c, p, gh, errs, aborted, doc: () => p.evaluate(() => window.__desk.store.get('d2')), notice: () => p.locator('#notice').innerText() };
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], token: 'github_pat_REMEMBERED' }, staleDoc(false));
  const d = await t.doc();
  ok('re-key on load: published field dropped, unpublished kept, seedCommit updated, one compare for sha1', d.seedCommit === SEED.commit && !d.fields.claim && d.fields['archive.abstract'] && !d.fields['archive.abstract'].publishedAs && t.gh.compares.length === 1 && t.gh.compares[0] === 'sha1');
  ok('re-key notice', (await t.notice()).includes('re-keyed 1 document'), await t.notice());
  ok('no refusal: no discard button', await t.p.locator('#discardStale').count() === 0);
  ok('re-key compare is anonymous even with a remembered token (a rejected token cannot break re-keying)', t.gh.compares.length >= 1 && t.gh.auth.length === t.gh.compares.length && t.gh.auth.every(a => a === ''), JSON.stringify(t.gh.auth));
  ok('re-key on load: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: [] }, staleDoc(false));
  const d = await t.doc();
  ok('a publish not in history: left alone, notice says so', d.seedCommit === 'oldseed' && d.fields.claim && (await t.notice()).includes('not in the history'));
  ok('not in history: the notice offers the discard escape', (await t.notice()).includes('or discard them below.') && await t.p.locator('#notice #discardStale').count() === 1, await t.notice());
  await t.p.locator('#discardStale').click(); await t.p.waitForFunction(() => document.querySelector('#modalBg #pd-h'));
  const dtext = await t.p.locator('#modalBg').innerText();
  ok('not in history: the discard dialog warns those publishes may not be on the site and offers Download changes first', dtext.includes('may not be') && await t.p.locator('#modalBg [data-dlfirst]').count() === 1, dtext);
  await t.p.locator('#modalBg [data-cancel]').click();
  ok('not in history: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], compare404: true }, staleDoc(false));
  const d = await t.doc();
  ok('a compare answering 404 counts as not an ancestor, not as unreachable', d.seedCommit === 'oldseed' && (await t.notice()).includes('not in the history') && !(await t.notice()).includes('could not be reached'), await t.notice());
  ok('compare 404: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], token: 't' }, staleDoc(true));
  const d = await t.doc();
  const note = await t.notice();
  ok('an unpublished revert blocks re-key, notice says so and gives the honest remedy', d.seedCommit === 'oldseed' && note.includes('unpublished revert') && note.includes('not re-keyed') && note.includes('no longer knows') && !note.includes('Publish or undo'), note);
  ok('an unpublished revert is reported without a compare request', t.gh.compares.length === 0);
  await t.p.locator('#pub').click(); await t.p.waitForTimeout(300);
  const heldToast = await t.p.locator('.toast').innerText().catch(() => '');
  const tomb = (await t.doc()).fields['archive.effect'];
  ok('Publish is held while a document is keyed to an older snapshot: toast, no request, nothing marked', heldToast.includes('keyed to an older snapshot') && t.gh.gets === 0 && t.gh.puts.length === 0 && tomb && tomb.cleared && !tomb.publishedAs, `${heldToast} · gets=${t.gh.gets} puts=${t.gh.puts.length}`);
  ok('unpublished revert: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{ // the escape from a permanent refusal: discard only the documents keyed to the older snapshot
  const d1 = core.setField(core.emptyChanges('d1', SEED.commit), 'claim', 'current work', '2026-09-25T10:00:00.000Z');
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], token: 't', docs: { d2: staleDoc(true), d1 } });
  const label = SEED.receptors.find(r => r.id === 'd2').label;
  ok('a refusal offers "Discard those older-snapshot changes"', await t.p.locator('#notice #discardStale').count() === 1 && (await t.notice()).includes('or discard them below.'), await t.notice());
  await t.p.locator('#discardStale').click(); await t.p.waitForFunction(() => document.querySelector('#modalBg #pd-h'));
  const dtext = await t.p.locator('#modalBg').innerText();
  ok('the discard dialog lists the receptor and its unpublished and published counts', dtext.includes(label) && dtext.includes('1 unpublished') && dtext.includes('2 published') && dtext.includes('Discard changes keyed to the older snapshot'), dtext);
  await t.p.locator('#modalBg [data-cancel]').click(); await t.p.waitForTimeout(100);
  await t.p.locator('#pub').click(); await t.p.waitForTimeout(200);
  ok('Cancel discards nothing and Publish stays held', await t.p.evaluate(() => !!window.__desk.store.all.d2) && (await t.p.locator('.toast').innerText()).includes('keyed to an older snapshot') && t.gh.gets === 0);
  await t.p.locator('#discardStale').click(); await t.p.waitForFunction(() => document.querySelector('#modalBg #pd-h'));
  await t.p.locator('#modalBg [data-discard]').click(); await t.p.waitForTimeout(200);
  const all = await t.p.evaluate(() => window.__desk.store.all);
  const stored = await t.p.evaluate(() => JSON.parse(localStorage.getItem('atlas-desk-changes-v1')));
  ok('Discard drops only the older-snapshot document, in memory and in this browser; notice hidden', !all.d2 && all.d1 && all.d1.fields.claim.value === 'current work' && !stored.d2 && stored.d1 && await t.p.locator('#notice.hidden').count() === 1 && (await t.p.locator('.toast').innerText()).includes('Discarded 1 document.'));
  await t.p.locator('#pub').click(); await t.p.waitForFunction(() => document.querySelector('#modalBg #pc-h'), null, { timeout: 4000 }).catch(() => {});
  ok('after Discard, Publish proceeds (reads the repo file)', t.gh.gets === 1 && await t.p.locator('#modalBg #pc-h').count() === 1, `gets=${t.gh.gets}`);
  await t.p.locator('#modalBg [data-cancel]').click();
  ok('discard: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{
  const t = await loadWith({ abort: true }, staleDoc(true));
  const d = await t.doc();
  ok('reverts with GitHub down: the revert notice shows, and no request was attempted', d.seedCommit === 'oldseed' && (await t.notice()).includes('unpublished revert') && t.aborted.n === 0, `aborted=${t.aborted.n} · ${await t.notice()}`);
  ok('reverts with GitHub down: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{
  const t = await loadWith({ abort: true }, staleDoc(false));
  const d = await t.doc();
  ok('GitHub unreachable: left alone, notice says so', d.seedCommit === 'oldseed' && (await t.notice()).includes('could not be reached') && t.aborted.n >= 1);
  ok('GitHub unreachable: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{ // an edit made while the compare is in flight survives the re-key
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], delayMs: 600, noWait: true }, staleDoc(false));
  const early = await t.p.evaluate(() => window.__desk.rekeyDone);
  await t.p.selectOption('#rx', 'd2');
  await t.p.locator('[data-path="archive.abstract"]').fill('typed during rekey'); await t.p.waitForTimeout(450);
  await t.p.waitForFunction(() => window.__desk.rekeyDone);
  const d = await t.doc();
  ok('an edit typed while GitHub answers survives the re-key', early === false && d.seedCommit === SEED.commit && d.fields['archive.abstract'] && d.fields['archive.abstract'].value === 'typed during rekey' && !d.fields.claim, JSON.stringify({ early, seedCommit: d.seedCommit, abstract: d.fields['archive.abstract'] }));
  ok('race: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{ // Publish while a re-key is in flight: held, no request
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], delayMs: 800, noWait: true, token: 't' }, staleDoc(false));
  const early = await t.p.evaluate(() => window.__desk.rekeyDone);
  await t.p.locator('#pub').click(); await t.p.waitForTimeout(150);
  const toastText = await t.p.locator('.toast').innerText().catch(() => '');
  ok('Publish during a re-key: toast "Re-keying stored changes", no request', early === false && toastText.includes('Re-keying stored changes; try again in a moment.') && t.gh.gets === 0 && t.gh.puts.length === 0, toastText);
  await t.p.waitForFunction(() => window.__desk.rekeyDone);
  await t.c.close();
}
{ // a re-key run that throws: boot still finishes (toast, rekeyDone), and a run queued behind it still runs
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], delayMs: 600, noWait: true }, staleDoc(false));
  await t.p.evaluate(() => {
    const s = window.__desk.store, list = s.list; let once = true;
    s.list = function () { if (once) { once = false; throw new Error('store list failed (test)'); } return list.call(this); };
    window.__q = window.__desk.rekeyStale();   // queued behind the boot run, which is waiting on GitHub
  });
  const done = await t.p.waitForFunction(() => window.__desk.rekeyDone, null, { timeout: 4000 }).then(() => true, () => false);
  const toastText = await t.p.locator('.toast').innerText().catch(() => '');
  const queued = await t.p.evaluate(() => window.__q.then(() => 'resolved', e => 'rejected: ' + (e && e.message)));
  const d = await t.doc();
  ok('a throwing boot re-key: toast, rekeyDone still set, no unhandled rejection', done && toastText.includes('store list failed (test)') && t.errs.length === 0, `done=${done} toast=${toastText} errs=${t.errs.join(' | ')}`);
  ok('a re-key queued behind a failed run still runs', queued === 'resolved' && d.seedCommit === SEED.commit && !d.fields.claim, `${queued} · ${d.seedCommit}`);
  await t.c.close();
}
{
  const fresh = core.setField(core.emptyChanges('d2', SEED.commit), 'claim', 'current', '2026-09-25T10:00:00.000Z');
  const t = await loadWith({ repoState: SEED.baseState, ancestors: [] }, fresh);
  ok('a document on the current seed makes no compare request and no notice', t.gh.compares.length === 0 && await t.p.locator('#notice.hidden').count() === 1);
  // --- Import changes ---
  ok('browser mode shows Import changes', await t.p.locator('#imp:not(.hidden)').count() === 1);
  const docA = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.abstract', 'imported abstract', '2026-09-25T11:00:00.000Z');
  const docB = core.setField(core.emptyChanges('nope', SEED.commit), 'claim', 'x', '2026-09-25T11:00:00.000Z');
  await t.p.locator('#impfile').setInputFiles({ name: 'changes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([docA, docB, 7])) });
  await t.p.waitForTimeout(400);
  const after = await t.doc();
  ok('import: no page errors', t.errs.length === 0, t.errs.join(' | '));
  ok('import merges the known document, skips the rest, keeps the existing claim', after.fields.claim && after.fields.claim.value === 'current' && after.fields['archive.abstract'] && after.fields['archive.abstract'].value === 'imported abstract' && (await t.p.locator('.toast').innerText()).includes('Imported 1 document (2 skipped)'));
  await t.c.close();
}
const importFile = async (p, docs) => { await p.evaluate(() => { document.querySelector('#toastRoot').innerHTML = ''; }); await p.locator('#impfile').setInputFiles({ name: 'changes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(docs)) }); await p.waitForFunction(() => /Imported|Wait for/.test(document.querySelector('#toastRoot').innerText)); await p.waitForTimeout(300); return p.locator('.toast').innerText(); };
const onlyD1 = { d1: core.setField(core.emptyChanges('d1', SEED.commit), 'claim', 'd1 local', '2026-09-25T10:00:00.000Z') };
{ // an older-seed document is re-keyed before it is merged (a fresh store)
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], docs: onlyD1 });
  const toastText = await importFile(t.p, [staleDoc(false)]);
  const d = await t.doc();
  ok('import of an older-seed document: re-keyed onto this seed before it is stored (published claim folded, abstract kept)', d.seedCommit === SEED.commit && !d.fields.claim && d.fields['archive.abstract'] && d.fields['archive.abstract'].value === 'still unpublished' && t.gh.compares.includes('sha1'), toastText);
  ok('import re-key: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
{ // an Import re-keying an older-seed document holds Publish until it is done
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'], delayMs: 800, token: 't', docs: onlyD1 });
  await t.p.evaluate(() => { document.querySelector('#toastRoot').innerHTML = ''; });
  await t.p.locator('#impfile').setInputFiles({ name: 'changes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([staleDoc(false)])) });
  await t.p.waitForTimeout(200);
  await t.p.locator('#pub').click(); await t.p.waitForTimeout(150);
  const held = await t.p.locator('.toast').innerText().catch(() => '');
  ok('Publish during an Import re-key: held, no request', held.includes('Re-keying stored changes') && t.gh.gets === 0, held);
  await t.p.waitForFunction(() => /Imported/.test(document.querySelector('#toastRoot').innerText));
  await t.c.close();
}
{ // ... and merging it never turns this browser's current work stale
  let local = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.effect', 'published here', '2026-09-24T10:00:00.000Z');
  local = core.clearField(core.markPublished(local, 'shaP'), 'archive.effect', '2026-09-25T10:00:00.000Z');   // published on this seed, then reverted
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'] }, local);
  const toastText = await importFile(t.p, [staleDoc(false)]);
  const d = await t.doc();
  ok('import of an older-seed document into current work: stays on this seed, revert kept, claim folded', d.seedCommit === SEED.commit && d.fields['archive.effect'] && d.fields['archive.effect'].cleared && !d.fields.claim && d.fields['archive.abstract'] && await t.p.locator('#notice.hidden').count() === 1, `${toastText} · ${d.seedCommit}`);
  await t.c.close();
}
{ // an older-seed document whose publish is not in this seed's history: not imported, and the toast says why
  const t = await loadWith({ repoState: SEED.baseState, ancestors: [], docs: onlyD1 });
  const docA = core.setField(core.emptyChanges('d3', SEED.commit), 'claim', 'current d3', '2026-09-25T11:00:00.000Z');
  const toastText = await importFile(t.p, [staleDoc(false), docA]);
  const all = await t.p.evaluate(() => window.__desk.store.all);
  ok('an older-seed document not in the history is not imported; the current-seed one is', !all.d2 && all.d3 && all.d3.fields.claim.value === 'current d3' && toastText.includes('not in the history'), toastText);
  await t.c.close();
}
{ // this browser's copy is keyed to an older snapshot (re-key refused): an import is not merged into it
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['sha1'] }, staleDoc(true));
  const docA = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.abstract', 'imported abstract', '2026-09-25T11:00:00.000Z');
  const toastText = await importFile(t.p, [docA]);
  const d = await t.doc();
  ok('an import is not merged into a document keyed to an older snapshot (it would re-key its reverts silently)', d.seedCommit === 'oldseed' && d.fields['archive.abstract'].value === 'still unpublished' && toastText.includes('keyed to an older snapshot'), `${toastText} · ${d.seedCommit}`);
  await t.c.close();
}
{ // while a publish commits: Import is refused, a re-key waits, and the view under the caret is not re-drawn
  let doc = core.setField(core.emptyChanges('d2', SEED.commit), 'claim', 'published earlier', '2026-09-24T10:00:00.000Z');
  doc = core.setField(core.markPublished(doc, 'shaX'), 'archive.abstract', 'to publish', '2026-09-25T10:00:00.000Z');
  const t = await loadWith({ repoState: SEED.baseState, ancestors: ['shaX'], putDelayMs: 1200, token: 't' }, doc);
  const gh = t.gh;
  await t.p.selectOption('#rx', 'd2');
  await t.p.locator('#pub').click(); await t.p.waitForFunction(() => document.querySelector('#modalBg #pc-h')); await t.p.locator('#modalBg [data-go]').click();
  await t.p.waitForFunction(() => document.querySelector('#pub').textContent === 'Committing…');
  const imp = core.setField(core.emptyChanges('d1', SEED.commit), 'claim', 'imported mid-publish', '2026-09-25T11:00:00.000Z');
  const toastText = await importFile(t.p, [imp]);
  ok('Import during a publish: "Wait for the publish to finish." and the store is unchanged', toastText.includes('Wait for the publish to finish.') && await t.p.evaluate(() => !window.__desk.store.all.d1), toastText);
  // a re-key started now (the document keyed to an older seed by another route) must not write before the marks land
  await t.p.evaluate(() => { const s = window.__desk.store; s.put({ ...s.get('d2'), seedCommit: 'oldseed' }); window.__rk = window.__desk.rekeyStale(); });
  await t.p.locator('[data-path="archive.presentation"]').fill('typed while committing');
  await t.p.waitForFunction(() => document.querySelector('#pub').textContent === 'Publish' && !document.querySelector('#pub').disabled, null, { timeout: 8000 });
  const focus = await t.p.evaluate(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.path);
  await t.p.evaluate(() => window.__rk);
  const d = await t.doc();
  ok('a publish landing while a field has focus does not re-draw under the caret', focus === 'archive.presentation', String(focus));
  ok('a re-key started mid-publish waits for the marks: no phantom revert of the published claim', gh.puts.length === 1 && d.fields.claim && !d.fields.claim.cleared && d.fields.claim.publishedAs === 'shaX' && d.fields['archive.abstract'].publishedAs && d.fields['archive.abstract'].publishedAs.startsWith('c0ffee'), JSON.stringify(d.fields.claim));
  ok('mid-publish: no page errors', t.errs.length === 0, t.errs.join(' | '));
  await t.c.close();
}
// --- simulated claude.ai frame: a fake window.claude with db + downloads, same page from disk ---
async function framePage(cfg) {
  const fctx = await browser.newContext({ acceptDownloads: true });
  await fctx.addInitScript(cfg => {
    const L = window.__fakeLog = { sets: [], inflight: 0, maxInflight: 0, reads: 0, saves: [], calls: [], subs: 0 };
    if (cfg.ls) localStorage.setItem('atlas-desk-changes-v1', JSON.stringify(cfg.ls));
    const asSnap = docs => ({ docs: Object.entries(docs).map(([id, d]) => ({ id, data: () => d })) });
    // the test hook: push(docs) delivers { id: body } to the page's subscription as another view's write
    window.__fakeDb = { cb: null, push(docs) { if (this.cb) this.cb(asSnap(docs)); } };
    window.claude = { use: async name => {
      if (name === 'db') {
        if (cfg.db === 'none') return null;
        return {
          collection: () => ({ onSnapshot: (cb) => { L.subs++; window.__fakeDb.cb = cb; setTimeout(() => cb(asSnap(cfg.docs || {})), 0); return () => {}; }, get: async () => { L.reads++; if (cfg.db === 'down' || (cfg.db === 'flaky' && L.reads === 1)) throw { code: 'unavailable', message: 'x' }; return { docs: Object.entries(cfg.docs || {}).map(([id, d]) => ({ id, data: () => d })) }; } }),
          doc: path => ({ set: async obj => { L.inflight++; L.maxInflight = Math.max(L.maxInflight, L.inflight); await new Promise(r => setTimeout(r, 80)); L.inflight--; L.sets.push({ path, obj }); } }),
        };
      }
      if (name === 'downloads') {
        if (cfg.dl === 'none') return null;
        return { save: async req => { L.saves.push(req.filename); if (cfg.dl === 'unavailable') throw { code: 'unavailable', message: 'x' }; return { status: 'saved' }; } };
      }
      if (name === 'mcp') {
        if (!cfg.mcp) return null;
        // PubMed as an MCP tool result: one text block carrying the JSON payload
        return { callTool: async (server, tool, input) => {
          L.calls.push({ server, tool, input });
          if (server !== 'PubMed' || tool !== 'get_article_metadata') throw { code: 'tool_error', message: 'unexpected call ' + server + '.' + tool };
          const articles = input.pmids.map(pmid => ({ title: 'Psychosis as a state of aberrant salience: a framework linking biology, phenomenology, and pharmacology in schizophrenia.', identifiers: { pmid, doi: '10.1176/appi.ajp.160.1.13' }, journal: { title: 'The American journal of psychiatry' }, authors: [{ last_name: 'Kapur', fore_name: 'Shitij', initials: 'S' }], publication_date: { year: 2003 }, article_types: ['Journal Article'] }));
          return { content: [{ type: 'text', text: JSON.stringify({ articles }) }] };
        } };
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
  ok('frame: Publish, GitHub… and Import changes are hidden', await f.p.locator('#pub.hidden').count() === 1 && await f.p.locator('#ghset.hidden').count() === 1 && await f.p.locator('#imp.hidden').count() === 1);
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
{ // another view writes: merged record by record, re-drawn except under the caret
  const f = await framePage({ db: 'ok', dl: 'ok', docs: {} });
  await f.p.selectOption('#rx', 'd2');
  ok('frame: the page subscribes to the store once', (await f.log()).subs === 1);
  await f.p.locator('[data-path="archive.presentation"]').fill('Local presentation.'); await f.p.evaluate(() => { window.__desk.flush(); document.activeElement.blur(); });
  await f.p.waitForTimeout(300);   // the local edit's own write lands first
  const setsBefore = (await f.log()).sets.length;
  const later = '2999-01-01T00:00:00.000Z';
  const remote = core.setField(core.emptyChanges('d2', SEED.commit), 'archive.effect', 'Remote effect.', later);
  await f.p.evaluate(d => window.__fakeDb.push({ d2: d }), remote); await f.p.waitForTimeout(400);
  const merged = await f.p.evaluate(() => window.__desk.store.get('d2').fields);
  const setsAfter = (await f.log()).sets.length;
  ok('frame: the merge is in memory (remote field and local record) and the snapshot sends no write',
    setsBefore >= 1 && setsAfter === setsBefore && merged['archive.effect'] && merged['archive.effect'].value === 'Remote effect.' && merged['archive.presentation'] && merged['archive.presentation'].value === 'Local presentation.', `sets ${setsBefore} -> ${setsAfter}`);
  ok('frame: a remote write on another field re-draws that field, and the local record survives',
    (await f.p.locator('[data-path="archive.effect"]').innerText()) === 'Remote effect.' && merged['archive.presentation'] && merged['archive.presentation'].value === 'Local presentation.' && (await f.p.locator('[data-path="archive.presentation"]').innerText()) === 'Local presentation.', JSON.stringify(Object.keys(merged)));
  await f.p.locator('[data-path="archive.abstract"]').focus();
  const remote2 = core.setField(remote, 'archive.ligand', 'Remote ligand.', later);
  await f.p.evaluate(d => window.__fakeDb.push({ d2: d }), remote2); await f.p.waitForTimeout(100);
  const whileFocused = await f.p.locator('[data-path="archive.ligand"]').innerText();
  const stillFocused = await f.p.evaluate(() => document.activeElement && document.activeElement.dataset.path === 'archive.abstract');
  await f.p.evaluate(() => document.activeElement.blur()); await f.p.waitForTimeout(100);
  ok('frame: while a field has focus the view is not re-drawn; it is once focus leaves',
    whileFocused !== 'Remote ligand.' && stillFocused && (await f.p.locator('[data-path="archive.ligand"]').innerText()) === 'Remote ligand.', whileFocused);
  ok('frame: no page errors with live updates', f.errs.length === 0, f.errs.join(' | '));
  await f.fctx.close();
}
{ // changes this browser kept before the store answered: a persistent line offers to merge them
  const local = core.setField(core.emptyChanges('d1', SEED.commit), 'claim', 'Kept in this browser.', '2026-09-26T00:00:00.000Z');
  const f = await framePage({ db: 'ok', dl: 'ok', docs: {}, ls: { d1: local } });
  const line = await f.p.locator('#lsmerge').innerText().catch(() => '');
  ok('frame: a store-mode page with changes left in this browser says so', (await f.p.locator('#lsmerge').isVisible()) && /^this browser holds 1 change that is not in the store —\s*Merge$/.test(line), line);
  await f.p.click('#lsmergeBtn'); await f.p.waitForTimeout(300);
  const L = await f.log(); const w = L.sets.filter(x => x.path === 'changes/d1').pop();
  ok('frame: Merge writes the merged document to the store and empties this browser',
    w && w.obj.fields.claim.value === 'Kept in this browser.' && await f.p.evaluate(() => localStorage.getItem('atlas-desk-changes-v1') === null) && !(await f.p.locator('#lsmerge').isVisible()) && await f.p.evaluate(() => window.__desk.store.get('d1').fields.claim.value === 'Kept in this browser.'));
  ok('frame: no page errors merging this browser', f.errs.length === 0, f.errs.join(' | '));
  await f.fctx.close();
}
{ // downloads capability absent: the button is hidden
  const f = await framePage({ db: 'none', dl: 'none' });
  await f.p.waitForTimeout(100);
  ok('frame: Download is hidden when the downloads capability is absent', !(await f.p.locator('#dl').isVisible()) && !(await f.p.locator('#dlc').isVisible()));
  await f.fctx.close();
}
{ // downloads capability rejects unavailable: hidden after the attempt, no fallback download
  const f = await framePage({ db: 'none', dl: 'unavailable' });
  await f.p.click('#dl'); await f.p.waitForTimeout(300);
  ok('frame: Download hides itself on "unavailable" and does not fall back', !(await f.p.locator('#dl').isVisible()) && f.downloads() === 0);
  await f.fctx.close();
}
{ // the PubMed connector present: Look up fills the form from get_article_metadata, Attach attaches it
  const f = await framePage({ db: 'none', dl: 'ok', mcp: true });
  await f.p.selectOption('#rx', 'd1');
  await f.p.locator('[data-path="archive.abstract"]').evaluate(el => { const r = document.createRange(); r.setStart(el.firstChild, 4); r.setEnd(el.firstChild, 11); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await f.p.click('text=+ add source');
  await f.p.fill('[name=lookup]', '12505794'); await f.p.click('text=Look up');
  await f.p.waitForFunction(() => document.querySelector('[name=title]').value !== '');
  const form = await f.p.evaluate(() => Object.fromEntries(['title', 'authors', 'year', 'journal', 'pmid', 'doi'].map(n => [n, document.querySelector(`[name=${n}]`).value])));
  ok('frame: Look up 12505794 calls PubMed.get_article_metadata and fills the form', JSON.stringify((await f.log()).calls) === JSON.stringify([{ server: 'PubMed', tool: 'get_article_metadata', input: { pmids: ['12505794'] } }]) && form.pmid === '12505794' && form.authors === 'Kapur S' && form.year === '2003' && form.doi === '10.1176/appi.ajp.160.1.13', JSON.stringify(form));
  await f.p.click('.modal >> text=Attach'); await f.p.waitForTimeout(300);
  const d1 = await f.p.evaluate(() => window.__desk.store.get('d1'));
  ok('frame: Look up 12505794 → Attach attaches a source keyed pmid:12505794, with the bracket', d1.sources.add.length === 1 && d1.sources.add[0].key === 'pmid:12505794' && d1.spans.length === 1 && d1.spans[0].sourceKey === 'pmid:12505794' && d1.spans[0].text === 'primary' && (await f.p.locator('#margin .mcard[data-key="pmid:12505794"][data-added]').count()) === 1, JSON.stringify({ add: d1.sources.add, spans: d1.spans }));
  ok('frame: no page errors with the connector', f.errs.length === 0, f.errs.join(' | '));
  await f.fctx.close();
}
await browser.close();
