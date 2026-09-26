// scripts/desk-build.mjs — one file out: desk/desk.html = template + core + seed.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const DESK = join(HERE, '..', 'desk');
const core = readFileSync(join(DESK, 'desk-core.mjs'), 'utf8').replace(/^export (const|let|function|async function|class) /gm, '$1 ');
// Anything the strip missed (export default, export { … }, import) would break the inlined module; refuse it.
if (/^\s*(export|import)\b/m.test(core)) throw new Error('desk-core.mjs has an export/import form the build does not strip');
const seedText = readFileSync(join(DESK, 'seed.json'), 'utf8').trim();
if (/<\/script/i.test(seedText)) throw new Error('seed.json contains </script>; refusing to inline');
if (/<\/script/i.test(core)) throw new Error('desk-core.mjs contains </script>; refusing to inline');
const tpl = readFileSync(join(DESK, 'desk.template.html'), 'utf8');
for (const ph of ['/*__CORE__*/', '/*__SEED__*/', '__BUILT_AT__']) if (!tpl.includes(ph)) throw new Error(`template lacks ${ph}`);
const out = tpl.replace('/*__CORE__*/', () => core).replace('/*__SEED__*/', () => seedText).replace('__BUILT_AT__', () => new Date().toISOString());
writeFileSync(join(DESK, 'desk.html'), out);
console.log(`wrote desk/desk.html: ${(out.length / 1024).toFixed(0)} KB`);
