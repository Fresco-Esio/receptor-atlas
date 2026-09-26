/**
 * Apply the 2026-08-19 serotonin-hall conservator's review.
 *
 * Companion to docs/2026-08-19-serotonin-hall-review.md. Read that first —
 * every change below is argued there.
 *
 * Two phases, deliberately separate:
 *
 *   --citations   Source-record corrections and new attachments. These are
 *                 factual errors in the catalogue (wrong year, wrong title,
 *                 NULL journal, a specimen with no primary source, claims with
 *                 no paper behind them). Low judgment.
 *
 *   --prose       Rewritten abstract / body / claim / quiz for the five
 *                 specimens. Editorial. This is your writing; read the dossier
 *                 and disagree with it before running this.
 *
 * Neither phase touches review_state. Ticking the checks stays yours.
 *
 * Usage (stop the server first — it holds the DB open):
 *
 *   node scripts/apply-serotonin-review.mjs --dry-run --citations --prose
 *   node scripts/apply-serotonin-review.mjs --citations
 *   node scripts/apply-serotonin-review.mjs --prose
 *   npm run curator:export        # refresh db/curator-state.json
 *
 * Idempotent: safe to run twice. Sources are matched on PMID, attachments on
 * (receptor_id, source_id).
 */
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ATLAS_DB || join(HERE, '..', 'db', 'atlas.db');

const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry-run');
const DO_CITATIONS = argv.has('--citations');
const DO_PROSE = argv.has('--prose');

if (!DO_CITATIONS && !DO_PROSE) {
  console.error('Nothing to do. Pass --citations and/or --prose (add --dry-run to preview).');
  process.exit(1);
}

/* ── 1. Corrections to source records already in the library ──────────────
   Each entry is keyed on the PMID actually stored, so a re-run is a no-op. */
const SOURCE_FIXES = [
  {
    pmid: '31079617',
    why: 'Biochimie 161:34-45 (2019), not 2018; journal was NULL; authors abbreviated.',
    set: {
      authors: 'Albert PR, Vahid-Ansari F',
      year: 2019,
      journal: 'Biochimie',
      title: 'The 5-HT1A receptor: Signaling to behavior',
      url: 'https://pubmed.ncbi.nlm.nih.gov/31079617/',
      notes: '161:34-45.',
    },
  },
  {
    pmid: '26841800',
    why: 'journal was NULL.',
    set: {
      authors: 'Nichols DE',
      year: 2016,
      journal: 'Pharmacol Rev',
      title: 'Psychedelics',
      url: 'https://pubmed.ncbi.nlm.nih.gov/26841800/',
      notes: '68(2):264-355. Covers 5-HT2A agonism; does NOT address antagonism, EPS or atypicality.',
    },
  },
  {
    pmid: '16785265',
    why: 'journal was NULL; author list incomplete.',
    set: {
      authors: 'Reynolds GP, Hill MJ, Kirk SL',
      year: 2006,
      journal: 'J Psychopharmacol',
      url: 'https://pubmed.ncbi.nlm.nih.gov/16785265/',
      notes: 'Supports the weight-gain half of the claim only.',
    },
  },
  {
    pmid: '40789515',
    why: 'Stored title was wrong (singular "transporter", truncated subtitle); journal NULL; a corrigendum exists and was not recorded.',
    set: {
      authors: 'Murthy MK, et al.',
      year: 2025,
      journal: 'Neuroscience',
      title: 'Molecular pathways linking the serotonin transporters (SERT) to depressive disorder: from mechanisms to treatments',
      url: 'https://pubmed.ncbi.nlm.nih.gov/40789515/',
      notes: '584:2-31. CORRIGENDUM PUBLISHED - read the corrected version before this stays "verified".',
    },
  },
];

/* ── 2. Sources the hall's claims need and did not have ───────────────────
   Attached as `provided`: they resolve and they are the right papers, but you
   have not read them yet, and only you can move a source to `verified`. */
const NEW_SOURCES = [
  {
    pmid: '2571717',
    kind: 'article',
    authors: 'Meltzer HY, Matsubara S, Lee JC',
    year: 1989,
    journal: 'J Pharmacol Exp Ther',
    title: 'Classification of typical and atypical antipsychotic drugs on the basis of dopamine D-1, D-2 and serotonin2 pKi values',
    doi: null,
    url: 'https://pubmed.ncbi.nlm.nih.gov/2571717/',
    notes: 'Origin of the 5-HT2A:D2 ratio account of atypicality. Contested - see the dossier.',
    attach: [{ receptor: 'ht2a', primary: false }],
  },
  {
    pmid: '18761359',
    kind: 'article',
    authors: 'Barnes NM, Hales TG, Lummis SCR, Peters JA',
    year: 2009,
    journal: 'Neuropharmacology',
    title: 'The 5-HT3 receptor - the relationship between structure and function',
    doi: '10.1016/j.neuropharm.2008.08.003',
    url: 'https://pubmed.ncbi.nlm.nih.gov/18761359/',
    notes: '56(1):273-84. Carries the Cys-loop pentamer architecture and subunit pharmacology ht3 asserts.',
    attach: [{ receptor: 'ht3', primary: true }],
  },
  {
    pmid: '15121647',
    kind: 'article',
    authors: 'Meyer JH, et al.',
    year: 2004,
    journal: 'Am J Psychiatry',
    title: 'Serotonin transporter occupancy of five selective serotonin reuptake inhibitors at different doses: an [11C]DASB positron emission tomography study',
    doi: '10.1176/appi.ajp.161.5.826',
    url: 'https://pubmed.ncbi.nlm.nih.gov/15121647/',
    notes: '161(5):826-35. The occupancy measurement behind the ~80% figure.',
    attach: [{ receptor: 'sert', primary: false }],
  },
  {
    pmid: '9776391',
    kind: 'article',
    authors: 'Millan MJ, Dekeyne A, Gobert A',
    year: 1998,
    journal: 'Neuropharmacology',
    title: 'Serotonin (5-HT)2C receptors tonically inhibit dopamine (DA) and noradrenaline (NA), but not 5-HT, release in the frontal cortex in vivo',
    doi: null,
    url: 'https://pubmed.ncbi.nlm.nih.gov/9776391/',
    notes: 'Backs the frontocortical DA/NA half of the ht2c claim, which Reynolds 2006 does not.',
    attach: [{ receptor: 'ht2c', primary: false }],
  },
  {
    pmid: '9153397',
    kind: 'article',
    authors: 'Burns CM, et al.',
    year: 1997,
    journal: 'Nature',
    title: 'Regulation of serotonin-2C receptor G-protein coupling by RNA editing',
    doi: '10.1038/387303a0',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9153397/',
    notes: 'Backs the RNA-editing paragraph proposed for ht2c.',
    attach: [{ receptor: 'ht2c', primary: false }],
  },
];

/* ── 3. Rewritten narrative. See the dossier for the argument behind each. ── */
const PROSE = {
  ht1a: {
    claim: '5-HT1A inhibits its host cell through Gi/o; the same inhibition is negative feedback on raphe neurons and circuit damping postsynaptically, and desensitisation of the autoreceptor population is the standard account of delayed antidepressant onset.',
    quiz: 'The same receptor, the same transduction: why does 5-HT1A activation reduce serotonergic signalling in one location and reduce limbic excitability in another?',
    abstract: 'A Gi/o-coupled serotonin receptor that appears in two functionally opposite places: on raphe serotonin neurons themselves, where it acts as a somatodendritic autoreceptor and suppresses firing, and on postsynaptic targets in hippocampus and limbic cortex, where it damps excitability. Both populations lower cAMP and open potassium channels; what differs is whether the inhibition falls on the serotonin system or on the circuits it addresses. Adequate postsynaptic tone is associated with a stable affective baseline.',
    body: [
      'Ligand binding couples 5-HT1A to Gi/o: adenylyl cyclase is inhibited, cAMP falls, and G-protein-gated inwardly rectifying potassium channels open, hyperpolarising the cell. The consequence depends entirely on which cell carries the receptor. On raphe serotonin neurons it is somatodendritic and the hyperpolarisation is negative feedback — serotonin release across the forebrain is throttled by serotonin itself. On postsynaptic neurons in hippocampus and limbic cortex, the same hyperpolarisation reduces the excitability of the target circuit.',
      'Sustained occupancy of the somatodendritic population desensitises it over weeks, lifting the brake on raphe firing and raising forebrain serotonin — the standard account of why serotonergic antidepressant action appears on a delay rather than immediately. Postsynaptic tone runs on a different timescale: when adequate, affective responses stay proportionate to the stressor; when low, vigilance and irritability predominate.',
      'The prefrontal picture is less settled. 5-HT1A activation in prefrontal cortex has been reported to raise downstream dopamine, acetylcholine and noradrenaline, usually attributed to inhibition of GABAergic interneurons; but the receptor also sits directly on pyramidal neurons, and the net direction depends on which population dominates in a given preparation.',
    ],
  },
  ht2a: {
    claim: "5-HT2A is the cortex's excitatory serotonin receptor; Gq coupling on layer V pyramidal neurons sets perceptual gain, and driving it far above physiological range produces the hallucinatory state.",
    quiz: '5-HT2A raises the gain on cortical input. Describe what that does at physiological serotonin levels, and what changes when the receptor is driven well past that range.',
    abstract: 'The principal excitatory serotonin receptor of cortex, densely expressed on layer V pyramidal neurons. Gq coupling raises IP3 and DAG and increases the excitability of the cell, which at physiological serotonin concentrations sharpens sensory contrast and weights which stimuli feel salient. Driven far beyond that range it destabilises the perceptual system itself: sensory boundaries loosen, ordinary stimuli acquire overwhelming significance, and frank hallucination becomes possible.',
    body: [
      '5-HT2A couples to Gq/11: phospholipase C is activated, phosphatidylinositol bisphosphate is cleaved to IP3 and DAG, intracellular calcium rises and protein kinase C is engaged. On layer V cortical pyramidal neurons this depolarises the cell and increases the frequency of spontaneous excitatory postsynaptic currents, raising the gain on cortical input.',
      'Within its normal operating range that gain is what gives perception contrast and assigns salience. Pushed well beyond it, the same gain becomes the pathology: the boundary between self and surroundings loosens, ordinary stimuli acquire meaning out of proportion to them, and perception can detach from input entirely. Reducing receptor activity moves the system the other way, lowering cortical excitability and attenuating perceptual distortion.',
      'Whether reducing 5-HT2A activity is by itself sufficient to quiet psychosis is not settled: selective 5-HT2A inverse agonism has not proved an effective standalone treatment in schizophrenia, which argues the receptor modulates the psychotic state rather than seats it. The receptor also shapes sleep architecture, and excessive activity fragments slow-wave sleep.',
    ],
  },
  ht2c: {
    claim: 'Tonic 5-HT2C excitation of GABAergic relays restrains mesolimbic dopamine and drives hypothalamic satiety signalling; losing that restraint is the mechanism behind weight gain under sustained 5-HT2C blockade.',
    quiz: '5-HT2C is an excitatory receptor, yet its net effect on mesolimbic dopamine is inhibitory. What sits between the receptor and the dopamine neuron that makes that true?',
    abstract: "A Gq-coupled serotonin receptor concentrated in hypothalamus, choroid plexus and midbrain, where it does two related jobs: it signals satiation, and it holds a tonic brake on mesolimbic dopamine outflow through GABAergic relays. Reduced 5-HT2C tone releases both — appetite rises and appetitive drive becomes less restrained. It is also the only serotonin receptor known to be edited at the RNA level, which sets how efficiently a given cell's receptors couple at all.",
    body: [
      'Its restraint on dopamine is indirect. 5-HT2C couples to Gq and excites the neurons that carry it; the receptor sits on GABAergic interneurons in the ventral tegmental area, and exciting them inhibits the dopamine neurons downstream. In the hypothalamus the same excitatory coupling drives pro-opiomelanocortin neurons and produces satiety signalling.',
      'When that tone is adequate, meals terminate and appetitive drive stays bounded. When it is reduced, hunger persists past satiation and reward-seeking is less inhibited — the mechanism behind weight gain under sustained 5-HT2C blockade. The receptor’s influence on mood appears to run through the same interoceptive and dopaminergic routes rather than through a separate affective pathway.',
      'Its transcripts undergo adenosine-to-inosine editing at up to five sites, producing isoforms that differ substantially in constitutive activity and agonist potency. Editing patterns vary by brain region and have been reported to differ in depression and suicide, which makes “how much 5-HT2C tone” a harder quantity to state than for most receptors.',
    ],
  },
  ht3: {
    claim: "5-HT3 is serotonin's only ligand-gated ion channel — a Cys-loop cation pentamer — and its opening on vagal afferents and in the area postrema is the proximate trigger for nausea and emesis.",
    quiz: 'Every other serotonin receptor is a GPCR. What follows, functionally, from 5-HT3 being a ligand-gated cation channel instead?',
    abstract: "Serotonin's only ionotropic receptor: a Cys-loop pentameric cation channel of the same family as nicotinic acetylcholine and GABA-A receptors, and unrelated in architecture to every other 5-HT receptor. It opens in milliseconds rather than signalling through a G protein. Its densest expression is on vagal afferents and in the area postrema, where opening it produces nausea, retching and vomiting.",
    body: [
      'Five subunits assemble around a central pore; serotonin binds at the interfaces between adjacent subunits and the channel opens to sodium, potassium and calcium, depolarising the cell within milliseconds. Homomeric 5-HT3A and heteromeric 5-HT3A/B channels differ markedly in single-channel conductance and desensitisation kinetics, so “the 5-HT3 receptor” is really a small family whose properties depend on subunit composition.',
      'Enterochromaffin cells in the gut wall release serotonin in response to luminal irritation; that serotonin opens 5-HT3 channels on vagal afferent terminals and the signal arrives at the nucleus tractus solitarius. The area postrema, which sits outside the blood-brain barrier, carries the same receptor and can be activated by circulating emetogens directly. Closing the channel silences both routes.',
      'Central 5-HT3 receptors are expressed on GABAergic interneurons in cortex and hippocampus, but what they contribute to mood and cognition is far less well characterised than the emetic pathway, and claims of pro-cognitive effect should be treated as provisional.',
    ],
  },
  sert: {
    claim: 'SERT terminates serotonergic transmission by sodium-coupled reuptake, so transporter availability sets the duration and spread of every serotonergic signal; it is the target of the most widely used antidepressants, and its causal role in depression itself remains disputed.',
    quiz: 'Serotonergic transmission is terminated by reuptake rather than enzymatic breakdown. What does that imply about which variable — release or clearance — sets the duration of a serotonergic signal?',
    abstract: 'A sodium- and chloride-coupled member of the SLC6 transporter family that clears serotonin from the extracellular space back into the presynaptic terminal. Because reuptake rather than degradation terminates serotonergic transmission, SERT density and activity set the amplitude and duration of every serotonergic signal in the brain. It is the point at which serotonergic signalling is most readily altered pharmacologically, and the most-studied molecular link between serotonin and depression.',
    body: [
      'SERT co-transports serotonin with sodium and chloride down the sodium gradient established by the Na+/K+-ATPase, with potassium counter-transported. Because clearance rather than enzymatic breakdown ends the signal, the number and activity of transporters at a terminal — not the amount released — is what sets how long each pulse of serotonin persists and how far it spreads from the release site.',
      'Transporter availability is not fixed. Surface expression is regulated minute to minute by phosphorylation and trafficking, and over longer timescales by pro-inflammatory cytokines and growth factors. Common variation in SLC6A4, notably the promoter length polymorphism, alters expression and has been studied extensively in relation to depression risk and treatment response — though reported effect sizes have fallen substantially as sample sizes have grown.',
      'How much of depression is a serotonin story remains actively disputed. SERT is unambiguously the target through which the most widely used antidepressants act; that is a statement about the drugs, not a demonstration that reduced serotonergic transmission causes the illness.',
    ],
  },
};

/* ── runner ───────────────────────────────────────────────────────────────── */

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
const log = [];
const note = (s) => { log.push(s); console.log(s); };

function applyCitations() {
  note('\n── source-record corrections ───────────────────────────────');
  for (const fix of SOURCE_FIXES) {
    const row = db.prepare('SELECT * FROM sources WHERE pmid = ?').get(fix.pmid);
    if (!row) { note(`  ! PMID ${fix.pmid} not in library — skipped`); continue; }
    const changed = Object.entries(fix.set).filter(([k, v]) => String(row[k] ?? '') !== String(v ?? ''));
    if (!changed.length) { note(`  = PMID ${fix.pmid} already correct`); continue; }
    note(`  ~ PMID ${fix.pmid} (${fix.why})`);
    for (const [k, v] of changed) note(`      ${k}: ${JSON.stringify(row[k])} → ${JSON.stringify(v)}`);
    if (!DRY) {
      const sets = Object.keys(fix.set).map((k) => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE sources SET ${sets} WHERE id = @id`).run({ ...fix.set, id: row.id });
    }
  }

  note('\n── sources the claims needed and did not have ──────────────');
  for (const s of NEW_SOURCES) {
    let row = db.prepare('SELECT * FROM sources WHERE pmid = ?').get(s.pmid);
    if (!row) {
      note(`  + ${s.authors} (${s.year}) — PMID ${s.pmid}`);
      if (!DRY) {
        const info = db.prepare(
          `INSERT INTO sources (kind, authors, year, title, journal, pmid, doi, url, notes)
           VALUES (@kind, @authors, @year, @title, @journal, @pmid, @doi, @url, @notes)`
        ).run({ ...s, doi: s.doi ?? null });
        row = { id: info.lastInsertRowid };
      } else { row = { id: '(new)' }; }
    } else {
      note(`  = PMID ${s.pmid} already in library (id ${row.id})`);
    }
    for (const a of s.attach) {
      const existing = DRY && row.id === '(new)'
        ? null
        : db.prepare('SELECT * FROM receptor_sources WHERE receptor_id = ? AND source_id = ?').get(a.receptor, row.id);
      if (existing) {
        if (a.primary && !existing.is_primary) {
          note(`      ~ ${a.receptor}: promoting to primary`);
          if (!DRY) {
            db.prepare('UPDATE receptor_sources SET is_primary = 0 WHERE receptor_id = ?').run(a.receptor);
            db.prepare('UPDATE receptor_sources SET is_primary = 1 WHERE receptor_id = ? AND source_id = ?').run(a.receptor, row.id);
          }
        } else { note(`      = ${a.receptor}: already attached`); }
        continue;
      }
      note(`      → attach to ${a.receptor} as "provided"${a.primary ? ' (PRIMARY)' : ''}`);
      if (!DRY) {
        if (a.primary) db.prepare('UPDATE receptor_sources SET is_primary = 0 WHERE receptor_id = ?').run(a.receptor);
        db.prepare(
          `INSERT INTO receptor_sources (receptor_id, source_id, status, is_primary)
           VALUES (?, ?, 'provided', ?)`
        ).run(a.receptor, row.id, a.primary ? 1 : 0);
      }
    }
  }

  note(`\n── primary-source invariant ${DRY ? '(pre-run state; --dry-run inserts nothing) ' : ''}──────`);
  for (const id of Object.keys(PROSE)) {
    const n = db.prepare('SELECT COALESCE(SUM(is_primary),0) AS n FROM receptor_sources WHERE receptor_id = ?').get(id).n;
    note(`  ${n === 1 ? '✓' : '!'} ${id}: ${n} primary source${n === 1 ? '' : 's'}`);
  }
}

function applyProse() {
  note('\n── narrative rewrite ───────────────────────────────────────');
  for (const [id, p] of Object.entries(PROSE)) {
    const cur = db.prepare('SELECT * FROM archive_entries WHERE receptor_id = ?').get(id);
    if (!cur) { note(`  ! ${id}: no archive_entries row — skipped`); continue; }
    const bodyJson = JSON.stringify(p.body);
    const same = cur.abstract === p.abstract && cur.body_json === bodyJson;
    note(`  ${same ? '=' : '~'} ${id}: abstract ${cur.abstract?.length ?? 0}→${p.abstract.length} chars, body ${JSON.parse(cur.body_json || '[]').length}→${p.body.length} paragraphs`);
    if (DRY) continue;
    db.prepare('UPDATE archive_entries SET abstract = ?, body_json = ? WHERE receptor_id = ?')
      .run(p.abstract, bodyJson, id);
    db.prepare(`INSERT INTO claims (receptor_id, text) VALUES (?, ?)
                ON CONFLICT(receptor_id) DO UPDATE SET text = excluded.text`).run(id, p.claim);
    db.prepare(`INSERT INTO quizzes (receptor_id, prompt) VALUES (?, ?)
                ON CONFLICT(receptor_id) DO UPDATE SET prompt = excluded.prompt`).run(id, p.quiz);
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO section_activity (receptor_id, volume, last_edited_at)
                VALUES (?, 'archive', ?)
                ON CONFLICT(receptor_id, volume) DO UPDATE SET last_edited_at = excluded.last_edited_at`)
      .run(id, now);
  }
}

const run = db.transaction(() => {
  if (DO_CITATIONS) applyCitations();
  if (DO_PROSE) applyProse();
});

try {
  run();
  note(`\n${DRY ? 'DRY RUN — nothing written.' : 'Committed.'} Next: npm run curator:export, then restart the server.`);
} catch (e) {
  console.error('\nFAILED, rolled back:', e.message);
  process.exit(1);
} finally {
  db.close();
}
