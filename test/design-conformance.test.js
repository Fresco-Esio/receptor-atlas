import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// DESIGN.md sets ONE label step at 0.6875rem (11px), bans side-stripe accent borders,
// and bans em dashes in copy. These are the project's own rules; the tests exist so the
// rules stop being re-litigated one page at a time.
//
// The guard covers every page that ships, not just the one that happened to drift when
// the rules were written. Each of these three rules was broken on a DIFFERENT page than
// the one originally checked, which is the whole argument for sweeping all of them.
const PUBLISHED = [
  'the-receptor-atlas.html',              // shell, served as index.html
  'receptor-function.html',               // Archive
  'neuroreceptor_pharmacology_explorer_dashboard.html', // Cabinet
  'neuroreceptor_clinical_table.html',    // Ledger
  'receptor-atlas-demo.html',             // standalone walkthrough
  // The Desk is not published to the web, but it is the surface the curator spends
  // the most hours in, and it is where the type floor drifted furthest before the
  // redesign. Holding it to the same three rules is the point of having them.
  'the-conservators-desk.html',
];

const read = page => readFileSync(new URL(`../public/${page}`, import.meta.url), 'utf8');

/** Strip the places a rule about *copy* deliberately does not reach: CSS blocks, HTML
 *  comments, and JS comments. Blanking rather than deleting keeps line numbers honest. */
const copyOnly = html => html
  .replace(/<style[\s\S]*?<\/style>/g, m => ' '.repeat(m.length))
  .replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length))
  .replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
  .replace(/^[ \t]*\/\/.*$/gm, m => ' '.repeat(m.length));

for (const page of PUBLISHED) {
  test(`${page}: no functional text below the documented label step`, () => {
    const tooSmall = [...read(page).matchAll(/font-size:\s*(0?\.\d+)rem/g)]
      .map(m => Number(m[1]))
      .filter(rem => rem < 0.6875);
    assert.deepEqual([...new Set(tooSmall)].sort(), [],
      `font sizes below the 0.6875rem label step: ${[...new Set(tooSmall)].join(', ')}`);
  });

  test(`${page}: no side-stripe accent borders`, () => {
    const stripes = [...read(page).matchAll(/border-(left|right):\s*([2-9]|\d{2,})px/g)].map(m => m[0]);
    assert.deepEqual(stripes, [],
      `DESIGN.md bans colored border-left/right wider than 1px: ${stripes.join(', ')}`);
  });

  test(`${page}: no em dashes in copy`, () => {
    const hits = (copyOnly(read(page)).match(/—|&mdash;/g) || []).length;
    assert.equal(hits, 0,
      `DESIGN.md bans em dashes in copy; ${hits} remain outside comments and CSS`);
  });
}

// The token layer is shared, so one test covers every page at once.
test('--lbl-sm does not reintroduce a sub-floor label step', () => {
  const tokens = readFileSync(new URL('../public/assets/tokens.css', import.meta.url), 'utf8');
  const m = tokens.match(/--lbl-sm:\s*([^;]+);/);
  assert.ok(m, '--lbl-sm should still be declared so existing call sites resolve');
  assert.match(m[1].trim(), /var\(--lbl\)/,
    '--lbl-sm was retired to an alias of --lbl; giving it a smaller value again puts '
    + 'functional text back under the label step on every page that uses it');
});
