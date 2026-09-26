# Serotonin Hall — Conservator's Review

**Date:** 2026-08-19 · **Specimens:** `ht1a` `ht2a` `ht2c` `ht3` `sert`
**Method:** [The Conservator's Review Protocol](./conservators-review-protocol.md)
**State at time of review:** all five had `review_state.citation = 0`; four carried a
source already marked `verified`.

---

## Summary

| | ht1a | ht2a | ht2c | ht3 | sert |
|---|---|---|---|---|---|
| Primary source resolves | yes | yes | yes | **none attached** | yes |
| Stored metadata correct | **no** | partial | partial | — | **no** |
| Primary supports the claim | partial | **no** | partial | — | partial |
| Claim fully sourced | **no** | **no** | **no** | **no** | **no** |
| Quiz answerable from entry | **no** | **no** | **no** | **no** | **no** |
| Body uses >1 paragraph | no | no | no | no | no |
| Scope violation (Cabinet) | no | **yes** | **yes** | **yes** | no |

Five for five on the quiz row is the headline. Every quiz in the hall was written
against the `claim`, and every claim asserts more than its narrative says and more
than its sources carry. The quizzes are testing your memory of Stahl, not the specimen.

---

## Cross-cutting findings

**F1 — The claim outruns the sources, systematically.** Every claim in the hall is a
compound sentence whose halves have different evidentiary standing. `ht2c`'s *"5-HT2C
antagonism disinhibits prefrontal DA/NE (antidepressant) but drives weight gain"* has
a primary source for the second half and nothing for the first. Same shape in all five.

**F2 — The quiz asks for what the entry does not contain.** `sert`'s quiz asks for a
SERT-occupancy percentage. The figure appears in no field of the entry and in none of
its three attached sources. `ht2a`'s quiz asks about nigrostriatal dopamine and EPS —
neither word appears in its abstract or body.

**F3 — Leading questions.** *"Why does 5-HT2C antagonism cause weight gain yet also
contribute to antidepressant effects?"* presupposes both effects. A question that cannot
be failed is not a verification instrument.

**F4 — Abstract and body are near-duplicates.** `ht2a` states the same antagonism
sentence in both fields. Across the hall, each body's genuinely new content is one or
two orphan sentences. `body_json` is an array; all five hold a single element.

**F5 — `PRODUCT.md` scope violations.** The Archive explains what a receptor does;
drug-class talk belongs to the Cabinet. Three specimens cross it: *"the antipsychotic
effect of agents that block it"* (ht2a), *"medications that block 5-HT2C"* (ht2c),
*"the basis of 5-HT3 receptor antiemetics"* (ht3).

**F6 — Nothing is hedged.** Not one paragraph in the hall marks a disputed claim as
disputed — and the hall contains at least three live disputes (below).

**F7 — `verified` without a citation review.** Four specimens carry a `verified` source
while their Citation check is unticked. The desk permits this; the standard should not.

**F8 — `journal` is NULL on every article source in the hall.** Metadata was entered
from memory rather than from the record.

---

## ht1a — Serotonin 5-HT1A

### Citations

**Albert PR & Vahid-Ansari F — "The 5-HT1A receptor: Signaling to behavior"**
PMID `31079617` **resolves; title matches.** Errors in the stored record:

- Year stored `2018`; the article is *Biochimie* **161:34–45 (2019)** (online-first 2018).
- `journal` NULL → `Biochimie`.
- Authors stored as `Albert & Vahid-Ansari` → `Albert PR, Vahid-Ansari F`.

**Coverage.** Genuinely supports the autoreceptor/heteroreceptor architecture and the
signalling-to-behaviour arc — it is the right primary. It does **not** support the
claim's *"reduces parkinsonism"* or *"augments SSRI/antipsychotic effect"*. Those are
Stahl's clinical synthesis and currently rest on nothing but the book rows.

### Content

The body's third sentence — *"Activation of postsynaptic 5-HT1A receptors in prefrontal
cortex inhibit GABA interneurons leading to increased release of dopamine, acetylcholine,
and norepinephrine downstream"* — has a subject-verb disagreement (`inhibit` → `inhibits`),
and states as settled a mechanism whose net direction is preparation-dependent.

The abstract carries three jobs (distribution, transduction, clinical consequence);
the body then restates two of them. Deleting the abstract loses only the word "raphe."

### Quiz

*"Contrast 5-HT1A as somatodendritic autoreceptor vs postsynaptic heteroreceptor in
antidepressant onset."* — **The best quiz in the hall**, and still fails §2.1: neither
"antidepressant" nor "desensitisation" appears anywhere in the abstract or body. The
narrative needs the desensitisation account, or the quiz drops that clause.

### Proposed

**Claim** — 5-HT1A inhibits its host cell through Gi/o; the same inhibition is negative
feedback on raphe neurons and circuit damping postsynaptically, and desensitisation of
the autoreceptor population is the standard account of delayed antidepressant onset.

**Abstract** — A Gi/o-coupled serotonin receptor that appears in two functionally
opposite places: on raphe serotonin neurons themselves, where it acts as a
somatodendritic autoreceptor and suppresses firing, and on postsynaptic targets in
hippocampus and limbic cortex, where it damps excitability. Both populations lower cAMP
and open potassium channels; what differs is whether the inhibition falls on the
serotonin system or on the circuits it addresses. Adequate postsynaptic tone is
associated with a stable affective baseline.

**Body ¶1 (mechanism)** — Ligand binding couples 5-HT1A to Gi/o: adenylyl cyclase is
inhibited, cAMP falls, and G-protein-gated inwardly rectifying potassium channels open,
hyperpolarising the cell. The consequence depends entirely on which cell carries the
receptor. On raphe serotonin neurons it is somatodendritic and the hyperpolarisation is
negative feedback — serotonin release across the forebrain is throttled by serotonin
itself. On postsynaptic neurons in hippocampus and limbic cortex, the same
hyperpolarisation reduces the excitability of the target circuit.

**Body ¶2 (range)** — Sustained occupancy of the somatodendritic population desensitises
it over weeks, lifting the brake on raphe firing and raising forebrain serotonin — the
standard account of why serotonergic antidepressant action appears on a delay rather
than immediately. Postsynaptic tone runs on a different timescale: when adequate,
affective responses stay proportionate to the stressor; when low, vigilance and
irritability predominate.

**Body ¶3 (unsettled)** — The prefrontal picture is less settled. 5-HT1A activation in
prefrontal cortex has been reported to raise downstream dopamine, acetylcholine and
noradrenaline, usually attributed to inhibition of GABAergic interneurons; but the
receptor also sits directly on pyramidal neurons, and the net direction depends on which
population dominates in a given preparation.

**Quiz** — The same receptor, the same transduction: why does 5-HT1A activation reduce
serotonergic signalling in one location and reduce limbic excitability in another?

---

## ht2a — Serotonin 5-HT2A

### Citations

**Nichols DE — "Psychedelics"** PMID `26841800` **resolves.** *Pharmacol Rev*
68(2):264–355 (2016). `journal` NULL → `Pharmacol Rev`.

**Coverage — this is the hall's most serious citation problem.** Nichols supports the
abstract's and body's agonism/perception/ego-dissolution material well. It has nothing
to do with the claim, which is entirely about *antagonism*, nigrostriatal dopamine, EPS
and atypicality. **The primary source and the claim are about different pharmacology.**

The claim's real origin is Meltzer HY, Matsubara S & Lee JC, *Classification of typical
and atypical antipsychotic drugs on the basis of dopamine D-1, D-2 and serotonin2 pKi
values*, J Pharmacol Exp Ther 1989 — PMID `2571717`. Attach it.

**And carry the dispute.** The serotonin–dopamine hypothesis of atypicality is not
settled: selective 5-HT2A inverse agonism has not proved an effective standalone
antipsychotic in schizophrenia, and the fast-dissociation account is the main rival
explanation for low EPS. A reference work should hold both. Suggested status for the
Meltzer attachment: `provided` until you have read it against the counter-literature.

### Content

Scope violation (F5): *"which accounts for much of the antipsychotic effect of agents
that block it."* Cabinet. The Archive may say antagonism lowers cortical excitability;
naming what does the blocking is the Cabinet's job.

The antagonism sentence appears in both abstract and body, near-verbatim.

### Quiz

*"What does 5-HT2A antagonism do to nigrostriatal dopamine, and how does that reduce
EPS?"* — **Fails three of four requirements.** Leading (presupposes both links);
unanswerable from the entry (neither term appears); and it tests a contested claim as
if settled. Replace.

### Proposed

**Claim** — 5-HT2A is the cortex's excitatory serotonin receptor; Gq coupling on layer V
pyramidal neurons sets perceptual gain, and driving it far above physiological range
produces the hallucinatory state.

**Abstract** — The principal excitatory serotonin receptor of cortex, densely expressed
on layer V pyramidal neurons. Gq coupling raises IP3 and DAG and increases the
excitability of the cell, which at physiological serotonin concentrations sharpens
sensory contrast and weights which stimuli feel salient. Driven far beyond that range it
destabilises the perceptual system itself: sensory boundaries loosen, ordinary stimuli
acquire overwhelming significance, and frank hallucination becomes possible.

**Body ¶1 (mechanism)** — 5-HT2A couples to Gq/11: phospholipase C is activated,
phosphatidylinositol bisphosphate is cleaved to IP3 and DAG, intracellular calcium rises
and protein kinase C is engaged. On layer V cortical pyramidal neurons this depolarises
the cell and increases the frequency of spontaneous excitatory postsynaptic currents,
raising the gain on cortical input.

**Body ¶2 (range)** — Within its normal operating range that gain is what gives
perception contrast and assigns salience. Pushed well beyond it, the same gain becomes
the pathology: the boundary between self and surroundings loosens, ordinary stimuli
acquire meaning out of proportion to them, and perception can detach from input
entirely. Reducing receptor activity moves the system the other way, lowering cortical
excitability and attenuating perceptual distortion.

**Body ¶3 (unsettled)** — Whether reducing 5-HT2A activity is by itself sufficient to
quiet psychosis is not settled: selective 5-HT2A inverse agonism has not proved an
effective standalone treatment in schizophrenia, which argues the receptor modulates the
psychotic state rather than seats it. The receptor also shapes sleep architecture, and
excessive activity fragments slow-wave sleep.

**Quiz** — 5-HT2A raises the gain on cortical input. Describe what that does at
physiological serotonin levels, and what changes when the receptor is driven well past
that range.

---

## ht2c — Serotonin 5-HT2C

### Citations

**Reynolds GP, Hill MJ & Kirk SL — "The 5-HT2C receptor and antipsychotic-induced weight
gain — mechanisms and genetics"** PMID `16785265` **resolves.** *J Psychopharmacol*
(2006). `journal` NULL → `J Psychopharmacol`; authors → full list.

**Coverage.** Supports the weight-gain half of the claim and the satiety material.
Does **not** support *"disinhibits prefrontal DA/NE (antidepressant)"* — that is a
separate literature. Attach Millan MJ, Dekeyne A & Gobert A, *Serotonin (5-HT)2C
receptors tonically inhibit dopamine (DA) and noradrenaline (NA), but not 5-HT, release
in the frontal cortex in vivo*, Neuropharmacology 1998 — PMID `9776391`.

The body's *"via GABAergic relays"* is a specific mechanistic assertion with no attached
source that makes it.

### Content

Scope violation (F5): *"the weight gain associated with medications that block 5-HT2C."*

The abstract and body are paraphrases of each other; between them they say one thing
twice. And the hall's most distinctive fact about this receptor is missing entirely:
5-HT2C is the only serotonin receptor known to undergo **RNA editing**, which changes
constitutive activity and agonist potency between isoforms — Burns CM et al., *Regulation
of serotonin-2C receptor G-protein coupling by RNA editing*, Nature 1997, PMID `9153397`.
That is what makes "how much 5-HT2C tone" a genuinely hard quantity, and it belongs in ¶3.

### Quiz

*"Why does 5-HT2C antagonism cause weight gain yet also contribute to antidepressant
effects?"* — Leading on both halves; the antidepressant half is in neither the narrative
nor the sources. Replace.

### Proposed

**Claim** — Tonic 5-HT2C excitation of GABAergic relays restrains mesolimbic dopamine and
drives hypothalamic satiety signalling; losing that restraint is the mechanism behind
weight gain under sustained 5-HT2C blockade.

**Abstract** — A Gq-coupled serotonin receptor concentrated in hypothalamus, choroid
plexus and midbrain, where it does two related jobs: it signals satiation, and it holds
a tonic brake on mesolimbic dopamine outflow through GABAergic relays. Reduced 5-HT2C
tone releases both — appetite rises and appetitive drive becomes less restrained. It is
also the only serotonin receptor known to be edited at the RNA level, which sets how
efficiently a given cell's receptors couple at all.

**Body ¶1 (mechanism)** — 5-HT2C couples to Gq and excites the neurons that carry it. Its
restraint on dopamine is therefore indirect: the receptor sits on GABAergic interneurons
in the ventral tegmental area, and exciting them inhibits the dopamine neurons
downstream. In the hypothalamus the same excitatory coupling drives pro-opiomelanocortin
neurons and produces satiety signalling.

**Body ¶2 (range)** — When that tone is adequate, meals terminate and appetitive drive
stays bounded. When it is reduced, hunger persists past satiation and reward-seeking is
less inhibited — the mechanism behind weight gain under sustained 5-HT2C blockade. The
receptor's influence on mood appears to run through the same interoceptive and
dopaminergic routes rather than through a separate affective pathway.

**Body ¶3 (unsettled)** — 5-HT2C transcripts undergo adenosine-to-inosine editing at up to
five sites, producing isoforms that differ substantially in constitutive activity and
agonist potency. Editing patterns vary by brain region and have been reported to differ
in depression and suicide, which makes "how much 5-HT2C tone" a harder quantity to state
than for most receptors.

**Quiz** — 5-HT2C is an excitatory receptor, yet its net effect on mesolimbic dopamine is
inhibitory. What sits between the receptor and the dopamine neuron that makes that true?

---

## ht3 — Serotonin 5-HT3

### Citations — the structural defect

**No article source at all.** Three Stahl chapters, every one `provided`, none
`verified`, and **no attached source carries `is_primary = 1`.** The schema comment says
exactly one is expected; `/api/atlas/:volume` surfaces the primary; this specimen
therefore renders **with no citation.** `ht3` is one of only three receptors in the
entire database in this state (with `d3` and `dat`).

Attach as primary: Barnes NM, Hales TG, Lummis SCR & Peters JA, *The 5-HT3 receptor —
the relationship between structure and function*, Neuropharmacology 2009;56(1):273–84 —
PMID `18761359`, DOI `10.1016/j.neuropharm.2008.08.003`. It carries the pentameric
Cys-loop architecture, subunit composition, and the pharmacology the body asserts.

### Content

Scope violation (F5): *"is the basis of 5-HT3 receptor antiemetics."*

The body's structural claims (Cys-loop pentamer, relatives of nicotinic and GABA-A) are
correct and currently uncited. The closing hedge — *"may modulate mood and cognition
through interoceptive pathways"* — is the right instinct but too vague to be checkable.

### Quiz

*"Which antidepressants' 5-HT3 antagonism contributes to an antiemetic / pro-cognitive
profile?"* — **A Cabinet question in the Archive.** It asks for a drug inventory, not a
mechanism, and "pro-cognitive" is the weakest assertion on the page: the pro-cognitive
signal usually cited is not attributable to 5-HT3 action specifically. Replace.

### Proposed

**Claim** — 5-HT3 is serotonin's only ligand-gated ion channel — a Cys-loop cation
pentamer — and its opening on vagal afferents and in the area postrema is the proximate
trigger for nausea and emesis.

**Abstract** — Serotonin's only ionotropic receptor: a Cys-loop pentameric cation channel
of the same family as nicotinic acetylcholine and GABA-A receptors, and unrelated in
architecture to every other 5-HT receptor. It opens in milliseconds rather than
signalling through a G protein. Its densest expression is on vagal afferents and in the
area postrema, where opening it produces nausea, retching and vomiting.

**Body ¶1 (structure)** — Five subunits assemble around a central pore; serotonin binds at
the interfaces between adjacent subunits and the channel opens to sodium, potassium and
calcium, depolarising the cell within milliseconds. Homomeric 5-HT3A and heteromeric
5-HT3A/B channels differ markedly in single-channel conductance and desensitisation
kinetics, so "the 5-HT3 receptor" is really a small family whose properties depend on
subunit composition.

**Body ¶2 (where it matters)** — Enterochromaffin cells in the gut wall release serotonin
in response to luminal irritation; that serotonin opens 5-HT3 channels on vagal afferent
terminals and the signal arrives at the nucleus tractus solitarius. The area postrema,
which sits outside the blood-brain barrier, carries the same receptor and can be
activated by circulating emetogens directly. Closing the channel silences both routes.

**Body ¶3 (unsettled)** — Central 5-HT3 receptors are expressed on GABAergic interneurons
in cortex and hippocampus, but what they contribute to mood and cognition is far less
well characterised than the emetic pathway, and claims of pro-cognitive effect should be
treated as provisional.

**Quiz** — Every other serotonin receptor is a GPCR. What follows, functionally, from
5-HT3 being a ligand-gated cation channel instead?

---

## sert — Serotonin Transporter

This is the entry you are actively editing, and it has the hall's two sharpest problems.

### Citations

**PMID `40789515` resolves — but the stored title is wrong.**

- Stored: *"Molecular pathways linking the serotonin transporter (SERT) to depression"*
- Actual: *"Molecular pathways linking the serotonin transporter**s** (SERT) to
  depressive disorder: from mechanisms to treatments"* — *Neuroscience* **584:2–31 (2025)**
- `journal` NULL → `Neuroscience`.
- **A corrigendum has been published for this article.** The record marks it `verified`
  and `is_primary` with no note of the correction. Read the corrected version before the
  status stands.

**Single-source dependency.** The body is a paragraph-level compression of this one
review: cytokines, growth factors, environmental exposure, diet, gut microbiota, SLC6A4
variation — the review's own section headings, in the review's own order. One 2025
review carrying an entire specimen is a single point of failure (§3.2). It is also,
structurally, close paraphrase.

**The ~80% figure is unsourced.** The claim and quiz both turn on SERT occupancy needed
for SSRI efficacy. None of the three attached sources reports an occupancy measurement.
Attach Meyer JH et al., *Serotonin transporter occupancy of five selective serotonin
reuptake inhibitors at different doses: an [11C]DASB positron emission tomography study*,
Am J Psychiatry 2004;161(5):826–35 — PMID `15121647`, DOI `10.1176/appi.ajp.161.5.826`.

### Content

- Trailing whitespace on the abstract.
- `serotinergic` → `serotonergic` in the body.
- The abstract is two sentences where the hall's others run four; it does not carry the
  transporter's identity (SLC6 family, sodium/chloride coupling) at all.
- *"Serotonin system activity is thought to be central to the pathophysiology of
  depression"* is the hall's most exposed sentence. It is stated flatly, and it is
  precisely the proposition that the 2022 serotonin-hypothesis umbrella review put into
  public dispute. **A reference work that states this without a hedge is taking a side
  in an argument it has not shown the reader.** This is the single change I would make
  first.

### Quiz

*"Roughly what SERT occupancy is needed for SSRI efficacy, and what explains the
therapeutic delay?"* — Asks for a number the entry does not contain and no attached
source reports (§2.3). Fix by attaching Meyer *and* putting the figure in ¶2, or by
replacing the quiz. Proposed below: replace, and let the occupancy figure live in the
Cabinet where dose-response belongs.

### Proposed

**Claim** — SERT terminates serotonergic transmission by sodium-coupled reuptake, so
transporter availability sets the duration and spread of every serotonergic signal; it
is the target of the most widely used antidepressants, and its causal role in depression
itself remains disputed.

**Abstract** — A sodium- and chloride-coupled member of the SLC6 transporter family that
clears serotonin from the extracellular space back into the presynaptic terminal.
Because reuptake rather than degradation terminates serotonergic transmission, SERT
density and activity set the amplitude and duration of every serotonergic signal in the
brain. It is the point at which serotonergic signalling is most readily altered
pharmacologically, and the most-studied molecular link between serotonin and depression.

**Body ¶1 (mechanism)** — SERT co-transports serotonin with sodium and chloride down the
sodium gradient established by the Na+/K+-ATPase, with potassium counter-transported.
Because clearance rather than enzymatic breakdown ends the signal, the number and
activity of transporters at a terminal — not the amount released — is what sets how long
each pulse of serotonin persists and how far it spreads from the release site.

**Body ¶2 (regulation)** — Transporter availability is not fixed. Surface expression is
regulated minute to minute by phosphorylation and trafficking, and over longer timescales
by pro-inflammatory cytokines and growth factors. Common variation in SLC6A4, notably the
promoter length polymorphism, alters expression and has been studied extensively in
relation to depression risk and treatment response — though reported effect sizes have
fallen substantially as sample sizes have grown.

**Body ¶3 (unsettled)** — How much of depression is a serotonin story remains actively
disputed. SERT is unambiguously the target through which the most widely used
antidepressants act; that is a statement about the drugs, not a demonstration that
reduced serotonergic transmission causes the illness.

**Quiz** — Serotonergic transmission is terminated by reuptake rather than enzymatic
breakdown. What does that imply about which variable — release or clearance — sets the
duration of a serotonergic signal?

---

## Applying this

Two phases, run separately on purpose (`scripts/apply-serotonin-review.mjs`):

- **`--citations`** — metadata corrections, four new sources with attachments, `ht3`'s
  primary. Low-judgment; these are record errors.
- **`--prose`** — the rewritten abstracts, bodies, claims and quizzes. Editorial. Read
  this document first; your voice, your call.

Neither phase touches `review_state`. Ticking the checks is yours — that is the point
of the desk.
