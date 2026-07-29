import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TARGETS, DASHBOARD } from '../scripts/sourcing/config.mjs';

const html = readFileSync(DASHBOARD, 'utf8');

// Drugs removed from AFF_AGENTS during the 2026-07 clinical re-scope. The primer's
// "Examples here:" lines promise the reader they can go find these on the plate.
const REMOVED_FROM_ROSTER = [
  'fentanyl', 'dobutamine', 'flumazenil', 'metoprolol', 'atenolol', 'atropine',
  'doxazosin', 'phenobarbital', 'amantadine', 'oxybutynin', 'glycopyrrolate',
];

test('the methodology statement names the statistic the pipeline actually computes', () => {
  assert.ok(!/geometric mean/i.test(html),
    'copy claims geometric means; 3-build.mjs computes a median of pKi');
  assert.match(html, /median of all human values/i);
});

test('no copy claims a target count that disagrees with AFF_TARGETS', () => {
  const words = {
    12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen',
    16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
  };
  const wrong = Object.entries(words)
    .filter(([n]) => Number(n) !== TARGETS.length)
    .map(([, w]) => w)
    .filter(w => new RegExp(`${w}\\s+(targets|slots)`, 'i').test(html));
  assert.deepEqual(wrong, [],
    `copy names a target count that is not ${TARGETS.length}: ${wrong.join(', ')}`);
});

test('primer examples do not cite drugs removed from the atlas', () => {
  const egs = [...html.matchAll(/class="concept-eg">([\s\S]*?)<\/p>/g)].map(m => m[1].toLowerCase());
  const stale = REMOVED_FROM_ROSTER.filter(d => egs.some(e => e.includes(d)));
  assert.deepEqual(stale, [],
    `"Examples here" cites drugs no longer on the plate: ${stale.join(', ')}`);
});
