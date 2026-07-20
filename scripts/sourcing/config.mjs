// Shared configuration for the affinity-sourcing pipeline.
//
// The atlas's scope (which drugs and which receptors) is read from the Cabinet's own
// AFF_AGENTS / AFF_TARGETS, so adding a drug to the atlas automatically brings it into
// the next re-sourcing run. Everything else here is the sourcing POLICY — the decisions
// that make the matrix comparable. See README.md.
import { readFileSync } from 'node:fs';

export const DASHBOARD = new URL('../../public/neuroreceptor_pharmacology_explorer_dashboard.html', import.meta.url);

/** Pull a balanced JS array literal out of the dashboard by declaration name. */
export function sliceLiteral(html, decl) {
  const s = html.indexOf(decl);
  if (s < 0) throw new Error('declaration not found: ' + decl);
  const o = html.indexOf('[', s);
  let d = 0;
  for (let i = o; i < html.length; i++) {
    const c = html[i];
    if (c === '[') d++;
    else if (c === ']' && --d === 0) return html.slice(o, i + 1);
  }
  throw new Error('unbalanced literal: ' + decl);
}

const html = readFileSync(DASHBOARD, 'utf8');
/** The agents the atlas displays: { name, g, cid, b } — b is replaced by the pipeline. */
export const AGENTS = eval(sliceLiteral(html, 'const AFF_AGENTS = ['));
/** The 13 receptor columns, by the Cabinet's own alias. */
export const TARGETS = eval(sliceLiteral(html, 'const AFF_TARGETS = [')).map(t => t.id);
export const DRUGS = AGENTS.map(a => a.name);

// ---------------------------------------------------------------------------
// SOURCING POLICY
// ---------------------------------------------------------------------------

/** Affinity spine: PDSP, human receptors only, median of all human values. */
export const AFFINITY_SRC = 'PDSP KiDB (human)';
/** Action (agonist/antagonist) is curated separately by IUPHAR, where it has one. */
export const ACTION_SRC = 'IUPHAR/BPS';
/** PDSP records screening results >= 10 uM as Ki 10000 -> pKi 5: "tested, no binding". */
export const INACTIVE_PKI = 5;

/** PDSP species column values accepted as human. */
export const isHumanSpecies = sp => /^\??\s*HUMAN$/i.test(String(sp).trim());

/** Normalise a ligand name for matching across databases. */
export const norm = s => String(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/** Names that differ between our atlas and the source databases. */
export const NAME_ALIASES = {
  'LSD': ['lysergic acid diethylamide'],
  'Epinephrine': ['adrenaline'],
  'Norepinephrine': ['noradrenaline'],
  'D-Serine': ['d-serine', 'serine, d-'],
};

/** name -> canonical drug, including aliases. */
export function drugMatcher() {
  const want = new Map();
  for (const d of DRUGS) {
    want.set(norm(d), d);
    (NAME_ALIASES[d] || []).forEach(a => want.set(norm(a), d));
  }
  return test => want.get(norm(test)) || null;
}

/** Our target alias -> IUPHAR targetId(s). Subtype families are aggregated. */
export const IUPHAR_TARGETS = {
  dopamine_d2: [215], serotonin_5ht2a: [6], histamine_h1: [262],
  muscarinic_m1: [13], muscarinic_m3: [15], beta_1: [28], mu_opioid: [319],
  sert: [928], net: [926],
  alpha_1: [22, 23, 24],                      // a1A / a1B / a1D
  alpha_2: [25, 26, 27],                      // a2A / a2B / a2C
  gaba_a: [404, 405, 406, 407, 408, 409],     // GABA-A benzodiazepine-site subunits
  nmda_glutamate: [],                         // IUPHAR has no human pKi for NMDA
};

/** PDSP receptor name -> our target alias (subtypes aggregated, combined rows skipped). */
export function pdspTarget(name) {
  const r = String(name).trim();
  if (r.includes(',')) return null;                       // combined rows, e.g. "D2, D4"
  if (/^D2$/i.test(r)) return 'dopamine_d2';
  if (/^5-?HT2A$/i.test(r)) return 'serotonin_5ht2a';
  if (/^H1$/i.test(r)) return 'histamine_h1';
  if (/^M1$/i.test(r)) return 'muscarinic_m1';
  if (/^M3$/i.test(r)) return 'muscarinic_m3';
  if (/^Beta.?1$/i.test(r)) return 'beta_1';
  if (/^SERT$/i.test(r)) return 'sert';
  if (/^NET$/i.test(r)) return 'net';
  if (/^NMDA$/i.test(r)) return 'nmda_glutamate';
  if (/^GABA.?A$/i.test(r)) return 'gaba_a';
  if (/^Alpha.?1[ABCD]?$/i.test(r)) return 'alpha_1';
  if (/^Alpha.?2[ABC]?$/i.test(r)) return 'alpha_2';
  if (/opioid.*mu|^mu$|mu.*opioid|^MOR/i.test(r)) return 'mu_opioid';
  return null;
}

export const median = a => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const cacheFile = name => new URL('./cache/' + name, import.meta.url);
