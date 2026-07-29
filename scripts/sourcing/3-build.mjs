// Step 3 — build AFF_AGENTS: PDSP human median affinity + IUPHAR action.
//
//   node scripts/sourcing/3-build.mjs           # report + write cache/aff-agents.txt
//   node scripts/sourcing/3-build.mjs --write   # also splice it into the dashboard
//
// After --write you must rebuild the database for the app to serve the new numbers:
//   rm db/atlas.db db/atlas.db-wal db/atlas.db-shm && npm run migrate
// (migrations are seed-only, so an existing db is NOT overwritten.)
import { readFileSync, writeFileSync } from 'node:fs';
import {
  AGENTS, TARGETS, DASHBOARD, sliceLiteral, drugMatcher, pdspTarget, median,
  isHumanSpecies, canonReceptor, IUPHAR_TARGETS, AFFINITY_SRC, ACTION_SRC, INACTIVE_PKI,
  MIN_SUBTYPE_MARGIN, cacheFile,
} from './config.mjs';

const pdspRows = JSON.parse(readFileSync(cacheFile('pdsp-rows.json'), 'utf8'));
const iuphar = JSON.parse(readFileSync(cacheFile('iuphar-interactions.json'), 'utf8'));
const matchDrug = drugMatcher();

// --- affinity: human pKi per (drug, target), censoring-aware, subtype-aware ---
//
// Three rules, each of which the earlier median-of-everything got wrong:
//
//   1. AGGREGATE IN LOG SPACE. Ki is log-normally distributed and its error is
//      multiplicative, which is why the field reports pKi at all. (For odd n the
//      median is identical either way — order statistics survive a monotonic
//      transform — so this only bites on even n, where the log-space answer is
//      the geometric mean of the two central values, and that is the right one.)
//   2. A CENSORED SCREEN IS NOT A MEASUREMENT. PDSP writes ">10000" for "tested,
//      nothing there". Folding those in as Ki 10000 dragged 23 cells' medians down
//      by up to 1.2 log units. They are counted, never averaged: a cell is inactive
//      only when EVERY human record for it is censored.
//   3. A GENERIC COLUMN IS NOT A RECEPTOR. alpha_1 pools A/B/D, whose medians can
//      differ 60x. Median-across-subtypes understates a subtype-selective drug —
//      guanfacine's alpha_2 median is 5.97 while its alpha_2A median is 7.16, and
//      alpha_2A selectivity is the whole point of the drug. So: median WITHIN each
//      subtype, then report the tightest subtype and name it. Requiring n >= 2 to
//      be eligible stops a lone outlying measurement from winning on noise.
const MIN_SUBTYPE_N = 2;
const acc = {};
for (const row of pdspRows) {
  const drug = matchDrug(row.test); if (!drug) continue;
  const t = pdspTarget(row.receptor); if (!t) continue;
  if (!isHumanSpecies(row.species)) continue;
  const bucket = ((acc[drug] ??= {})[t] ??= { subs: {}, censored: 0, seen: new Set() });
  // PDSP republishes identical records under several citations; counting them twice
  // inflates n and biases the median toward whichever value got reprinted.
  const sub = canonReceptor(row.receptor);   // collapse gene-symbol spellings
  const key = `${row.censored ? 'C' : row.ki}|${sub}|${row.hot}|${row.cite}`;
  if (bucket.seen.has(key)) continue;
  bucket.seen.add(key);
  if (row.censored) { bucket.censored++; continue; }
  if (!(row.ki > 0)) continue;
  (bucket.subs[sub] ??= []).push(9 - Math.log10(row.ki));
}

/** Collapse one bucket to the number the plate shows, plus the spread behind it. */
function represent(bucket) {
  const subs = Object.entries(bucket.subs).map(([s, v]) => ({ s, m: median(v), v }));
  if (!subs.length) return null;                          // every record censored
  const spread = v => ({ n: v.length, lo: +Math.min(...v).toFixed(2), hi: +Math.max(...v).toFixed(2) });
  if (subs.length === 1) return { pki: subs[0].m, sub: null, weak: false, ...spread(subs[0].v) };
  const eligible = subs.filter(x => x.v.length >= MIN_SUBTYPE_N);
  if (!eligible.length) {
    // Nothing replicated: fall back to the pooled median and mark it low-confidence
    // rather than crowning whichever single reading happened to be tightest.
    const all = subs.flatMap(x => x.v);
    return { pki: median(all), sub: null, weak: true, ...spread(all) };
  }
  const best = eligible.reduce((a, b) => (b.m > a.m ? b : a));
  const others = eligible.filter(x => x !== best).map(x => x.m);
  const runnerUp = others.length ? Math.max(...others) : -Infinity;
  if (others.length && best.m - runnerUp < MIN_SUBTYPE_MARGIN) {
    // Two subtypes are tied within noise. Naming either overstates the precision of
    // the data, so fall back to the pooled median and say it is low-confidence.
    const all = subs.flatMap(x => x.v);
    return { pki: median(all), sub: null, weak: true, ...spread(all) };
  }
  return { pki: best.m, sub: best.s, weak: false, ...spread(best.v) };
}

// --- action: IUPHAR, human preferred, most frequent label ---
// IUPHAR writes allosteric modulation as bare "Positive"/"Negative", and "None" where it
// records no action at all. Everything else is spelled out.
const actCode = a => {
  const s = String(a || '').toLowerCase();
  if (s === 'positive') return 'pa';                  // positive allosteric modulator
  if (s === 'negative') return 'an';                  // negative allosteric modulator
  if (/partial agonist|allosteric|modulator/.test(s)) return 'pa';
  if (/inverse agonist|antagonist|blocker/.test(s)) return 'an';
  if (/agonist/.test(s)) return 'ag';
  if (/inhibit/.test(s)) return 'ri';
  return '';
};
const actLabel = a => /^positive$/i.test(a) ? 'Positive allosteric modulator'
  : /^negative$/i.test(a) ? 'Negative allosteric modulator' : a;
function action(drug, target) {
  const ids = IUPHAR_TARGETS[target] || [];
  const rows = (iuphar[drug] || []).filter(x => ids.includes(x.targetId));
  if (!rows.length) return null;
  const human = rows.filter(x => x.targetSpecies === 'Human');
  const pool = (human.length ? human : rows)
    .map(x => x.action || x.type)
    .filter(a => a && !/^none$/i.test(a));            // "None" = IUPHAR records no action
  if (!pool.length) return null;
  const top = pool.sort((a, b) => pool.filter(x => x === b).length - pool.filter(x => x === a).length)[0];
  const code = actCode(top);
  if (!code) return null;                             // don't claim a direction we can't classify
  return { act: code, actFull: actLabel(top) };
}

// --- emit ---
let cells = 0, withAction = 0, inactive = 0, subtyped = 0, lowConf = 0;
const lines = AGENTS.map(a => {
  const parts = [];
  for (const t of TARGETS) {
    const bucket = acc[a.name]?.[t];
    if (!bucket) continue;
    const rep = represent(bucket);
    const act = action(a.name, t);
    cells++; if (act) withAction++;

    const f = [];
    if (!rep) {
      // Every human record for this pair is a ">10000" screen. That is real evidence
      // of selectivity, so it is kept as a cell — pinned at the inactive threshold,
      // with n:0 saying plainly that nothing was ever measured here.
      inactive++;
      f.push(`ki:10000`, `pki:${INACTIVE_PKI}`, `n:0`, `nc:${bucket.censored}`,
        `kiText:'${bucket.censored} human screen${bucket.censored === 1 ? '' : 's'}, none showed binding'`);
    } else {
      const pki = +rep.pki.toFixed(2);
      // Derived, not of record: PDSP's own Ki values are the source, and this is the
      // median re-expressed in nM for readers who think in Ki. pKi is the stored truth.
      const ki = +Math.pow(10, 9 - pki).toPrecision(3);
      if (pki <= INACTIVE_PKI) inactive++;
      if (rep.sub) subtyped++;
      if (rep.weak) lowConf++;
      f.push(`ki:${ki}`, `pki:${pki}`, `n:${rep.n}`, `lo:${rep.lo}`, `hi:${rep.hi}`);
      if (rep.sub) f.push(`sub:${JSON.stringify(rep.sub)}`);
      if (bucket.censored) f.push(`nc:${bucket.censored}`);
      if (rep.weak) f.push(`weak:1`);
      f.push(`kiText:'median of ${rep.n} human value${rep.n === 1 ? '' : 's'}`
        + `${rep.sub ? ` at ${rep.sub}` : ''}${bucket.censored ? `, plus ${bucket.censored} screen${bucket.censored === 1 ? '' : 's'} with no binding` : ''}'`);
    }
    if (act) f.push(`act:'${act.act}'`, `actFull:${JSON.stringify(act.actFull)}`, `actSrc:'${ACTION_SRC}'`);
    f.push(`src:'${AFFINITY_SRC}'`);
    parts.push(`${t}:{${f.join(', ')}}`);
  }
  return `      { name:${JSON.stringify(a.name)}, g:'${a.g}', cid:${a.cid}, b:{ ${parts.join(', ')} } }`;
}).join(',\n');
const literal = `    const AFF_AGENTS = [\n${lines}\n    ];\n`;
writeFileSync(cacheFile('aff-agents.txt'), literal);

console.log(`cells ${cells} | with IUPHAR action ${withAction} | inactive (all records censored) ${inactive}`);
console.log(`reported at a named subtype: ${subtyped} | low-confidence (unreplicated or tied): ${lowConf}`);
console.log(`drugs with >=1 value: ${AGENTS.filter(a => acc[a.name]).length}/${AGENTS.length}`);

// Diff against what the dashboard currently ships, so a refresh never lands silently.
const movers = [];
for (const a of AGENTS) {
  for (const t of TARGETS) {
    const bucket = acc[a.name]?.[t], old = a.b[t];
    const rep = bucket ? represent(bucket) : undefined;
    const now = bucket ? (rep ? +rep.pki.toFixed(2) : INACTIVE_PKI) : null;
    if (old && now === null) movers.push(`  - ${a.name}/${t}  ${old.pki} -> dropped`);
    else if (!old && now !== null) movers.push(`  + ${a.name}/${t}  new ${now}`);
    else if (old && Math.abs(now - old.pki) >= 0.01)
      movers.push(`  ~ ${a.name}/${t}  ${old.pki} -> ${now}${rep?.sub ? `  (${rep.sub})` : ''}`);
  }
}
console.log(`\nchanges vs the shipping dashboard: ${movers.length}`);
movers.forEach(m => console.log(m));

if (process.argv.includes('--write')) {
  const html = readFileSync(DASHBOARD, 'utf8');
  const old = sliceLiteral(html, 'const AFF_AGENTS = [');
  const start = html.indexOf(old);
  const lineStart = html.lastIndexOf('\n', html.indexOf('const AFF_AGENTS = [')) + 1;
  let end = start + old.length;
  while (html[end] === ';' || html[end] === '\r') end++;
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  writeFileSync(DASHBOARD, html.slice(0, lineStart) + literal.split(/\r?\n/).join(eol) + html.slice(end));
  console.log('spliced into the dashboard — now rebuild the db (see header)');
}
