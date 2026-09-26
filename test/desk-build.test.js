import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toArtifactVariant } from '../scripts/desk-build.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const full = readFileSync(join(HERE, '..', 'desk', 'desk.html'), 'utf8');

function extractBlock(html, openTag, closeTag) {
  const start = html.indexOf(openTag);
  assert.notEqual(start, -1, `expected to find ${openTag}`);
  const end = html.indexOf(closeTag, start);
  assert.notEqual(end, -1, `expected to find ${closeTag} after ${openTag}`);
  return html.slice(start, end + closeTag.length);
}

test('toArtifactVariant drops the doctype/html/head/body wrapper and the meta tags', () => {
  const variant = toArtifactVariant(full);
  for (const marker of ['<!DOCTYPE', '<html', '<head>', '<body>', '<meta']) {
    assert.equal(variant.toUpperCase().includes(marker.toUpperCase()), false, `variant should not contain ${marker}`);
  }
});

test('toArtifactVariant starts with the page title', () => {
  const variant = toArtifactVariant(full);
  assert.ok(variant.startsWith('<title>'), `expected variant to start with <title>, got: ${variant.slice(0, 40)}`);
});

test('toArtifactVariant keeps the same <style> and <script type="module"> blocks', () => {
  const variant = toArtifactVariant(full);
  const fullStyle = extractBlock(full, '<style>', '</style>');
  const variantStyle = extractBlock(variant, '<style>', '</style>');
  assert.equal(variantStyle, fullStyle);

  const fullScript = extractBlock(full, '<script type="module">', '</script>');
  const variantScript = extractBlock(variant, '<script type="module">', '</script>');
  assert.equal(variantScript, fullScript);
});

test('toArtifactVariant throws when </body> is missing', () => {
  const broken = full.replace('</body>', '');
  assert.throws(() => toArtifactVariant(broken), /no <\/body> marker/);
});

test('toArtifactVariant throws when a marker appears more than once', () => {
  const broken = full.replace('<head>', '<head><head>');
  assert.throws(() => toArtifactVariant(broken), /more than one <head> marker/);
});
