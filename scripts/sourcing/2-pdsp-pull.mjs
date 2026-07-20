// Step 2 — pull the PDSP Ki Database (the AFFINITY spine).
//
//   node scripts/sourcing/2-pdsp-pull.mjs
//
// PDSP's grid filters need internal ligand ids, so rather than reverse-engineer them we
// page the whole database (~98k rows, 20 pages) and stream-filter to the atlas's drugs.
// Writes cache/pdsp-rows.json. Resumable: already-seen Ki ids are skipped.
//
// NOTE: pdspdb.unc.edu is the reachable host; pdsp.unc.edu has an incomplete TLS chain
// and kidbdev.med.unc.edu refuses connections.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { drugMatcher, cacheFile } from './config.mjs';

mkdirSync(new URL('./cache/', import.meta.url), { recursive: true });
const OUT = cacheFile('pdsp-rows.json');
const PER = 5000;                                   // per-page=50000 returns HTTP 500
const MAXPAGES = Number(process.env.MAXPAGES || 20);
const GRID = 'https://pdspdb.unc.edu/kidb2/kidb/web/kis-results/index';

const matchDrug = drugMatcher();
const kept = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : [];
const seen = new Set(kept.map(r => r.kiId));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cells = row => [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)]
  .map(m => m[1].replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim());

let scanned = 0;
for (let p = 1; p <= MAXPAGES; p++) {
  const r = await fetch(`${GRID}?per-page=${PER}&page=${p}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) { console.log(`\npage ${p} -> ${r.status}, stopping`); break; }
  const body = await r.text();
  const tbody = body.match(/<tbody>(.*?)<\/tbody>/s);
  if (!tbody) { console.log(`\npage ${p}: no rows`); break; }
  let rows = 0, hit = 0;
  for (const m of tbody[1].matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    rows++;
    // columns: Ki ID | Receptors | Sources | Species | Hot ligand | Test ligand | Ki | Citation
    const c = cells(m[1]);
    if (c.length < 7) continue;
    const drug = matchDrug(c[5]);
    if (!drug || seen.has(c[0])) continue;
    seen.add(c[0]);
    kept.push({ kiId: c[0], drug, receptor: c[1], tissue: c[2], species: c[3], hot: c[4], test: c[5], ki: c[6], cite: c[7] });
    hit++;
  }
  scanned += rows;
  process.stdout.write(`p${p}:${hit} `);
  writeFileSync(OUT, JSON.stringify(kept));         // incremental save
  if (rows < PER) break;
  await sleep(300);
}
console.log(`\nscanned ${scanned} rows; kept ${kept.length} for ${new Set(kept.map(r => r.drug)).size} atlas drugs`);
