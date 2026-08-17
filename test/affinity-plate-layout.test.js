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

// The rose tweens between selections by interpolating a frame per animation step. That
// interpolated frame is a UNION of the outgoing and incoming selections: an agent that
// was just unpinned survives in it with every cell at v=0. paint() skips zero-value
// petals, but it still counts that series when it divides a slot's arc between pinned
// agents, so a frame carrying a departed agent draws every remaining petal at half
// width, offset to one side.
//
// That is harmless while the tween runs. It is a bug at the end of it: unpinning one of
// two agents left the rose holding a gap for the agent that had gone, until some later
// redraw happened to clear it. So the final act of the tween must be to paint the real
// target frame, never the last interpolated one.
test('the rose paints its target frame when the tween finishes, not the interpolated one', () => {
  const step = html.match(/const step = now => \{[\s\S]*?\n\s*\};/);
  assert.ok(step, 'the tween step function should be findable in the Cabinet page');

  // The branch taken on the final frame, where e has reached 1.
  const done = step[0].match(/else \{([\s\S]*?)\}/);
  assert.ok(done, 'step() should have a completion branch for e >= 1');

  assert.match(done[1], /paint\(\s*next\s*\)/,
    'the completion branch assigns liveFrame = next but must also paint(next): leaving '
    + 'the interpolated frame on screen keeps a slot divided for an agent that is no '
    + 'longer pinned, so the rose holds a gap until an unrelated redraw clears it');
});
