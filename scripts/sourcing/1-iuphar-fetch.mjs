// Step 1 — fetch IUPHAR/BPS interactions for every atlas drug (supplies ACTION only).
//
//   node scripts/sourcing/1-iuphar-fetch.mjs
//
// Writes cache/iuphar-ligands.json and cache/iuphar-interactions.json. Resumable:
// anything already cached is skipped, so re-running only fetches what's missing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { DRUGS, NAME_ALIASES, cacheFile } from './config.mjs';

mkdirSync(new URL('./cache/', import.meta.url), { recursive: true });
const LIGANDS = cacheFile('iuphar-ligands.json');
const INTERACTIONS = cacheFile('iuphar-interactions.json');
const load = f => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const API = 'https://www.guidetopharmacology.org/services';

// --- resolve names -> ligand ids ---
const ligands = load(LIGANDS);
const search = async name => {
  const r = await fetch(`${API}/ligands?name=${encodeURIComponent(name)}`);
  return r.ok ? r.json() : [];
};
for (const d of DRUGS) {
  if (ligands[d]?.ligandId) continue;
  let hits = await search(d);
  let pick = hits.find(h => h.name?.toLowerCase() === d.toLowerCase() || h.inn?.toLowerCase() === d.toLowerCase());
  for (const alias of (NAME_ALIASES[d] || [])) {
    if (pick) break;
    await sleep(120);
    hits = await search(alias);
    pick = hits.find(h => h.name?.toLowerCase() === alias.toLowerCase()) || hits[0];
  }
  if (!pick && hits.length === 1) pick = hits[0];
  ligands[d] = pick ? { ligandId: pick.ligandId, iupharName: pick.name } : { ligandId: null };
  process.stdout.write(ligands[d].ligandId ? '.' : 'x');
  await sleep(140);
}
writeFileSync(LIGANDS, JSON.stringify(ligands, null, 2));
console.log(`\nresolved ${Object.values(ligands).filter(v => v.ligandId).length}/${DRUGS.length} ligands`);

// --- fetch each ligand's interactions ---
const interactions = load(INTERACTIONS);
for (const [drug, info] of Object.entries(ligands)) {
  if (!info.ligandId || interactions[drug]) continue;
  const r = await fetch(`${API}/ligands/${info.ligandId}/interactions`);
  interactions[drug] = r.ok ? await r.json() : [];
  process.stdout.write('.');
  await sleep(140);
}
writeFileSync(INTERACTIONS, JSON.stringify(interactions));
const rows = Object.values(interactions).reduce((n, a) => n + a.length, 0);
console.log(`\ncached interactions for ${Object.keys(interactions).length} drugs (${rows} rows)`);
