import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGENTS, TARGETS, DASHBOARD } from '../scripts/sourcing/config.mjs';

const html = readFileSync(DASHBOARD, 'utf8');

// The matrix is a CSS grid whose rows use `display: contents`, so every agent row pours
// its cells straight into the grid's own tracks. If the track count and the target count
// ever disagree, the rows do not overflow visibly — they WRAP, silently, and every dot
// lands under the wrong receptor. That is exactly what happened when the plate went from
// 13 targets to 16 and this rule kept saying repeat(13, ...).
test('the matrix declares one column per target, plus the agent-name column', () => {
  const rule = html.match(/\.grid\s*\{[^}]*grid-template-columns:([^;]+);/);
  assert.ok(rule, '.grid must declare grid-template-columns');
  const decl = rule[1];

  const literal = decl.match(/repeat\(\s*(\d+)\s*,/);
  if (literal) {
    assert.equal(Number(literal[1]), TARGETS.length,
      `hardcoded repeat(${literal[1]}) but the plate has ${TARGETS.length} targets — the matrix will wrap`);
  } else {
    // Derived from the data rather than typed in: the count must come from AFF_TARGETS.
    assert.match(decl, /repeat\(\s*var\(--aff-cols\)/,
      'column count should be repeat(var(--aff-cols), ...) if it is not a literal');
    assert.match(html, /--aff-cols['"]?\s*,\s*AFF_TARGETS\.length|setProperty\(\s*['"]--aff-cols['"]\s*,\s*AFF_TARGETS\.length/,
      '--aff-cols must be set from AFF_TARGETS.length so it can never drift again');
  }
});

// The rose maps pKi onto radius with `Math.min(PETAL_MAX, pKi)`. That clamp is silent:
// a binder tighter than the ceiling is drawn at exactly the ceiling's length, so the
// plate shows two different affinities as the same petal and nothing anywhere says so.
//
// The ceiling is a constant rather than derived from the data on purpose, so the scale
// does not shift under the reader every time the catalogue is re-sourced. The cost of
// that choice is that a refresh can raise the real maximum past it, which is exactly
// what happened: PETAL_MAX sat at 9.75 while asenapine at 5-HT2A had moved to 9.8.
test('no binding exceeds the petal ceiling it would be clamped to', () => {
  const m = html.match(/PETAL_MAX\s*=\s*([\d.]+)/);
  assert.ok(m, 'PETAL_MAX must be declared in the rose scale');
  const max = Number(m[1]);

  const over = [];
  for (const a of AGENTS) {
    for (const [target, v] of Object.entries(a.b)) {
      if (typeof v.pki === 'number' && v.pki > max) over.push(`${a.name}/${target} ${v.pki}`);
    }
  }
  assert.deepEqual(over, [],
    `PETAL_MAX is ${max}; these are drawn clamped to it, understating how tightly they `
    + `bind. Raise PETAL_MAX to the new maximum: ${over.join(', ')}`);
});
