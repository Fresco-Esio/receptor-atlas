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
  isHumanSpecies, IUPHAR_TARGETS, AFFINITY_SRC, ACTION_SRC, INACTIVE_PKI, cacheFile,
} from './config.mjs';

const pdspRows = JSON.parse(readFileSync(cacheFile('pdsp-rows.json'), 'utf8'));
const iuphar = JSON.parse(readFileSync(cacheFile('iuphar-interactions.json'), 'utf8'));
const matchDrug = drugMatcher();

// --- affinity: median human pKi per (drug, target) ---
const acc = {};
for (const row of pdspRows) {
  const drug = matchDrug(row.test); if (!drug) continue;
  const t = pdspTarget(row.receptor); if (!t) continue;
  if (!isHumanSpecies(row.species)) continue;
  const ki = parseFloat(String(row.ki).replace(/[^0-9.eE+-]/g, ''));
  if (!(ki > 0)) continue;
  ((acc[drug] ??= {})[t] ??= []).push(9 - Math.log10(ki));      // aggregate in log space
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
let cells = 0, withAction = 0, inactive = 0;
const lines = AGENTS.map(a => {
  const parts = [];
  for (const t of TARGETS) {
    const vals = acc[a.name]?.[t];
    if (!vals?.length) continue;
    const pki = +median(vals).toFixed(2);
    const ki = +Math.pow(10, 9 - pki).toPrecision(3);           // nM, PDSP-native of record
    const act = action(a.name, t);
    cells++; if (act) withAction++; if (pki <= INACTIVE_PKI) inactive++;
    const f = [`ki:${ki}`, `pki:${pki}`, `n:${vals.length}`,
      `kiText:'median of ${vals.length} human value${vals.length === 1 ? '' : 's'}'`];
    if (act) f.push(`act:'${act.act}'`, `actFull:${JSON.stringify(act.actFull)}`, `actSrc:'${ACTION_SRC}'`);
    f.push(`src:'${AFFINITY_SRC}'`);
    parts.push(`${t}:{${f.join(', ')}}`);
  }
  return `      { name:${JSON.stringify(a.name)}, g:'${a.g}', cid:${a.cid}, b:{ ${parts.join(', ')} } }`;
}).join(',\n');
const literal = `    const AFF_AGENTS = [\n${lines}\n    ];\n`;
writeFileSync(cacheFile('aff-agents.txt'), literal);

console.log(`cells ${cells} | with IUPHAR action ${withAction} | inactive (pKi<=${INACTIVE_PKI}) ${inactive}`);
console.log(`drugs with >=1 value: ${AGENTS.filter(a => acc[a.name]).length}/${AGENTS.length}`);

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
