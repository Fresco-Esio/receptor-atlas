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
/** The receptor columns, by the Cabinet's own alias. */
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

/** How far a subtype must lead the runner-up before the plate names it.
 *  Between-laboratory pKi noise is routinely a few tenths of a log unit, so a lead
 *  smaller than this is not evidence of selectivity — it is the ordering of two
 *  indistinguishable numbers. Mirtazapine's alpha2C leads alpha2A by 0.04 and would
 *  flip on one new measurement. */
export const MIN_SUBTYPE_MARGIN = 0.3;

/** PDSP species column values accepted as human. */
export const isHumanSpecies = sp => /^\??\s*HUMAN$/i.test(String(sp).trim());

/** PDSP stores the radioligand in the hot-ligand column, and the literal "Functional"
 *  where the row is a functional-assay result rather than a binding measurement. Ki and
 *  functional potency are different quantities; a table headed "binding affinity" must
 *  not average them together. ~1720 human rows in the current export are functional. */
export const isBindingAssay = row => !/^functional$/i.test(String(row.hot || '').trim());

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
  dopamine_d2: [215], dopamine_d3: [216],
  serotonin_5ht1a: [1], serotonin_5ht2a: [6], serotonin_5ht2c: [8],
  histamine_h1: [262], muscarinic_m1: [13], muscarinic_m3: [15], mu_opioid: [319],
  sert: [928], net: [926], dat: [927], beta_1: [28],
  alpha_1: [22, 23, 24],                      // a1A / a1B / a1D
  alpha_2: [25, 26, 27],                      // a2A / a2B / a2C
  gaba_a: [404, 405, 406, 407, 408, 409],     // GABA-A benzodiazepine-site subunits
};

/** Gene symbol -> the pharmacological name for the SAME receptor.
 *
 * These are aliases, not subtypes, and the distinction matters: the subtype logic reports
 * the tightest subtype, so leaving "SERT" and "SLC6A4" as separate buckets would make the
 * plate pick whichever NAME happened to carry the tighter values and label it a subtype.
 * Alpha1A/1B/1D are genuinely different receptors; SERT and SLC6A4 are one receptor with
 * two spellings. Collapse the spellings, keep the receptors apart.
 */
const GENE_ALIAS = {
  SLC6A4: 'SERT', SLC6A2: 'NET', SLC6A3: 'DAT',
  HRH1: 'H1', CHRM1: 'M1', CHRM3: 'M3',
  DRD2: 'D2', DRD3: 'D3',
  HTR1A: '5-HT1A', HTR2A: '5-HT2A', HTR2C: '5-HT2C',
};
export const canonReceptor = name => {
  const r = String(name).trim();
  return GENE_ALIAS[r.toUpperCase()] || r;
};

/** PDSP receptor name -> our target alias (subtypes aggregated, combined rows skipped).
 *
 * PDSP files the same receptor under BOTH a pharmacological name and a gene symbol, and
 * the two are not interchangeable in the data — they are separate rows. Matching only the
 * pharmacological name silently discarded most of the transporter data: the serotonin
 * transporter has 216 human values under "SERT" and 607 more under "SLC6A4", so the atlas
 * was built on a quarter of it and showed NO SERT value at all for sertraline, paroxetine,
 * escitalopram, venlafaxine or duloxetine. Every alias a target is known by belongs here.
 */
export function pdspTarget(name) {
  const r = String(name).trim();
  if (!r) return null;                                    // 8476 rows carry no receptor
  if (r.includes(',')) return null;                       // combined rows, e.g. "D2, D4"
  if (/^(D2|DRD2)$/i.test(r)) return 'dopamine_d2';
  if (/^(D3|DRD3)$/i.test(r)) return 'dopamine_d3';
  if (/^(5-?HT1A|HTR1A)$/i.test(r)) return 'serotonin_5ht1a';
  if (/^(5-?HT2A|HTR2A)$/i.test(r)) return 'serotonin_5ht2a';
  if (/^(5-?HT2C|HTR2C)$/i.test(r)) return 'serotonin_5ht2c';
  if (/^(H1|HRH1)$/i.test(r)) return 'histamine_h1';
  if (/^(M1|CHRM1)$/i.test(r)) return 'muscarinic_m1';
  if (/^(M3|CHRM3)$/i.test(r)) return 'muscarinic_m3';
  if (/^Beta.?1$/i.test(r)) return 'beta_1';
  if (/^(SERT|SLC6A4)$/i.test(r)) return 'sert';
  if (/^(NET|SLC6A2)$/i.test(r)) return 'net';
  if (/^(DAT|SLC6A3)$/i.test(r)) return 'dat';
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
