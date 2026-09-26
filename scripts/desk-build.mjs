// scripts/desk-build.mjs — two files out: desk/desk.html = template + core + seed, and
// desk/desk.artifact.html, the same page without the doctype/html/head/body wrapper the
// claude.ai Artifact tool supplies its own version of when it publishes a page.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, '..', 'desk');

// Find `tag` in `html`, requiring it to appear exactly once. Used only against our own
// template's known markers, never as a general HTML parser.
function markerIndex(html, tag) {
  const first = html.indexOf(tag);
  if (first === -1) throw new Error(`toArtifactVariant: no ${tag} marker`);
  if (html.indexOf(tag, first + 1) !== -1) throw new Error(`toArtifactVariant: more than one ${tag} marker`);
  return first;
}

// Derive the artifact-safe variant of a built desk.html: everything between <head> and
// </head> with the <meta …> tags dropped (keeping <title>, <link …>, <style>…</style>),
// followed by everything between <body> and </body> (the markup and the module script).
export function toArtifactVariant(html) {
  const headOpenAt = markerIndex(html, '<head>');
  const headCloseAt = markerIndex(html, '</head>');
  const bodyOpenAt = markerIndex(html, '<body>');
  const bodyCloseAt = markerIndex(html, '</body>');
  if (!(headOpenAt < headCloseAt && headCloseAt < bodyOpenAt && bodyOpenAt < bodyCloseAt)) {
    throw new Error('toArtifactVariant: <head>/</head>/<body>/</body> markers are not in the expected order');
  }
  const headInner = html.slice(headOpenAt + '<head>'.length, headCloseAt);
  const headKept = headInner.replace(/[ \t]*<meta\b[^>]*>[ \t]*\n?/gi, '').trim();
  const bodyInner = html.slice(bodyOpenAt + '<body>'.length, bodyCloseAt).trim();
  return `${headKept}\n${bodyInner}\n`;
}

export function buildDesk() {
  const core = readFileSync(join(DESK, 'desk-core.mjs'), 'utf8').replace(/^export (const|let|function|async function|class) /gm, '$1 ');
  // Anything the strip missed (export default, export { … }, import) would break the inlined module; refuse it.
  if (/^\s*(export|import)\b/m.test(core)) throw new Error('desk-core.mjs has an export/import form the build does not strip');
  const seedText = readFileSync(join(DESK, 'seed.json'), 'utf8').trim();
  if (/<\/script/i.test(seedText)) throw new Error('seed.json contains </script>; refusing to inline');
  if (/<\/script/i.test(core)) throw new Error('desk-core.mjs contains </script>; refusing to inline');
  const tpl = readFileSync(join(DESK, 'desk.template.html'), 'utf8');
  for (const ph of ['/*__CORE__*/', '/*__SEED__*/', '__BUILT_AT__']) if (!tpl.includes(ph)) throw new Error(`template lacks ${ph}`);
  const out = tpl.replace('/*__CORE__*/', () => core).replace('/*__SEED__*/', () => seedText).replace('__BUILT_AT__', () => new Date().toISOString());
  const artifactOut = toArtifactVariant(out);
  writeFileSync(join(DESK, 'desk.html'), out);
  writeFileSync(join(DESK, 'desk.artifact.html'), artifactOut);
  console.log(`wrote desk/desk.html: ${(out.length / 1024).toFixed(0)} KB, desk/desk.artifact.html: ${(artifactOut.length / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildDesk();
}
