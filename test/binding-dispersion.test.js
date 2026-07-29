import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db/index.js';
import { migrate } from '../scripts/migrate.js';
import { cabinetBinding } from '../lib/queries.js';
import { AGENTS } from '../scripts/sourcing/config.mjs';

// The plate ships a snapshot in the HTML and then REPLACES it with this feed on load, so
// any field the database cannot hold is silently dropped from the page. These tests pin
// the round trip: what 3-build.mjs computes must survive migration and come back out of
// the API intact. Expected values are read from the built literal rather than typed in,
// so a data refresh cannot turn a real regression into a fixture edit.
const lit = name => AGENTS.find(a => a.name === name);
const fresh = () => { const db = openDb(':memory:'); migrate(db); return db; };

test('binding_values stores the dispersion the median was drawn from', () => {
  const db = fresh();
  const cols = db.prepare('PRAGMA table_info(binding_values)').all().map(c => c.name);
  for (const c of ['n', 'lo', 'hi', 'sub', 'nc', 'weak', 'act_src']) {
    assert.ok(cols.includes(c), `binding_values is missing the ${c} column`);
  }
});

test('the migration carries n, lo and hi through from the built literal', () => {
  const db = fresh();
  const want = lit('Fluoxetine').b.sert;
  const got = db.prepare(
    `SELECT n, lo, hi FROM binding_values WHERE agent_name = 'Fluoxetine' AND target_alias = 'sert'`).get();
  assert.equal(got.n, want.n, 'n must survive migration');
  assert.equal(got.lo, want.lo);
  assert.equal(got.hi, want.hi);
});

test('a named subtype survives as data, not only buried in kiText', () => {
  const db = fresh();
  const want = lit('Guanfacine').b.alpha_2;
  assert.ok(want.sub, 'fixture precondition: guanfacine alpha_2 should report a subtype');
  const got = db.prepare(
    `SELECT sub FROM binding_values WHERE agent_name = 'Guanfacine' AND target_alias = 'alpha_2'`).get();
  assert.equal(got.sub, want.sub);
});

test('an all-censored cell keeps its screen count', () => {
  const db = fresh();
  const entry = Object.entries(lit('Ketamine').b).find(([, v]) => v.nc > 0);
  assert.ok(entry, 'fixture precondition: ketamine should have a screened-clean target');
  const [alias, want] = entry;
  const got = db.prepare(
    `SELECT nc FROM binding_values WHERE agent_name = 'Ketamine' AND target_alias = ?`).get(alias);
  assert.equal(got.nc, want.nc);
});

test('a subtype is named only when it decisively beats the runner-up', () => {
  // alpha2C 7.74 vs alpha2A 7.70 is a 0.04 log-unit gap — inside measurement noise,
  // and it would flip on one new datapoint. Report the pooled median, flagged weak.
  const m = lit('Mirtazapine').b.alpha_2;
  assert.equal(m.sub, undefined, 'mirtazapine alpha_2 must not claim a subtype');
  assert.equal(m.weak, 1, 'and must be flagged low-confidence');
});

test('a decisive subtype lead is still reported', () => {
  // alpha2A 7.16 vs alpha2B 5.93 is a 1.23 log-unit lead — this is the drug's whole story.
  assert.equal(lit('Guanfacine').b.alpha_2.sub, 'Alpha2A');
});

test('the cabinet feed returns the fields the plate was built with', () => {
  const db = fresh();
  const want = lit('Fluoxetine').b.sert;
  const cell = cabinetBinding(db).find(a => a.name === 'Fluoxetine').b.sert;
  assert.equal(cell.n, want.n, 'n must survive the API');
  assert.equal(cell.lo, want.lo);
  assert.equal(cell.hi, want.hi);
  assert.equal(cell.actSrc, want.actSrc, 'the IUPHAR attribution must survive the API');
});
