// The Desk core runs in the page, so it cannot import scripts/curator-state.mjs (node: imports);
// it carries its own copies of the column lists. This keeps them tied: a column added to the
// dump and not to the core would be silently dropped by the converter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../desk/desk-core.mjs';
import { SOURCE_COLS, ARCHIVE_COLS, CLINICAL_COLS } from '../scripts/curator-state.mjs';

test('the core column lists equal the curator-state ones', () => {
  assert.deepEqual(core.SOURCE_COLS, SOURCE_COLS);
  assert.deepEqual(core.ARCHIVE_COLS, ARCHIVE_COLS);
  assert.deepEqual(core.CLINICAL_COLS, CLINICAL_COLS);
});
