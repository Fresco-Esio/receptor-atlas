import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DASHBOARD } from '../scripts/sourcing/config.mjs';

const html = readFileSync(DASHBOARD, 'utf8');

// DESIGN.md sets the label step at 0.6875rem (11px) and bans side-stripe accent borders.
// Both rules are the project's own; these tests stop them drifting silently.
test('no functional text is set below the documented label step', () => {
  const tooSmall = [...html.matchAll(/font-size:\s*(0?\.\d+)rem/g)]
    .map(m => Number(m[1]))
    .filter(rem => rem < 0.6875);
  assert.deepEqual([...new Set(tooSmall)], [],
    `font sizes below the 0.6875rem label step: ${[...new Set(tooSmall)].join(', ')}`);
});

test('no side-stripe accent borders', () => {
  const stripes = [...html.matchAll(/border-(left|right):\s*([2-9]|\d{2,})px/g)].map(m => m[0]);
  assert.deepEqual(stripes, [],
    `DESIGN.md bans colored border-left/right wider than 1px: ${stripes.join(', ')}`);
});
