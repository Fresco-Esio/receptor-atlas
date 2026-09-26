# The Conservator's Review Protocol

**Status:** working standard, v1. Derived from the serotonin hall pass of 2026-08-19.
**Applies to:** every specimen in the Archive, and by extension the Cabinet and Ledger.

The desk already tells you *what* to tick. It does not tell you what "verified" means,
what belongs in which field, or when a source is enough. This is that missing half.

The governing sentence is in `PRODUCT.md`: **a claim the code cannot support does not
ship, however good it sounds.** Everything below is that sentence made checkable.

---

## 0. The three questions this protocol answers

1. What belongs in the **abstract** vs the **body** vs the **claim** vs the **quiz**?
2. Is a **quiz** a real test of the specimen, or a flashcard about a textbook?
3. Do the **papers actually back the text they are attached to**?

---

## 1. The field contract

Each field has one job. A field doing two jobs is the commonest defect in the archive.

| Field | Its one job | Length | Fails when |
|---|---|---|---|
| `claim` | The single load-bearing assertion. Everything else on the page exists to support it. | 1 sentence | It asserts two things joined by a semicolon and only one has a source. |
| `abstract` | The claim expanded to a paragraph — identity, transduction, direction of effect. | 3–4 sentences, ≤ 90 words | It contains a fact the body does not, or the body restates it. |
| `body[]` | The mechanism narrative. **An array — use it.** | 3 paragraphs | It is one paragraph that paraphrases the abstract and appends orphan facts. |
| `presentation` | The one-line phenotype. | 1 line | It reads as bedside guidance (that is Ledger). |
| `effect` | Transduction in six words. | fragment | It editorialises. |
| `tags[]` | Retrieval handles. | 2–4 | They restate the abstract's nouns. |
| `quiz` | An instrument that tests whether the claim survives being asked back. | 1 question | It cannot be answered from `abstract` + `body` alone. |

### 1.1 The body's three paragraphs

`body_json` is stored as an array of paragraphs and every serotonin specimen used
exactly one. The array exists because the narrative has three distinguishable jobs:

- **¶1 — Mechanism.** How the signal is transduced and what that does to the host cell.
  Concrete: which G protein, which second messenger, which ion, which direction.
- **¶2 — Range.** What adequate, excessive and deficient tone look like *at the circuit
  level*. This is where the "what does it do" of the Archive actually lives.
- **¶3 — The unsettled part.** What is disputed, what the evidence does not yet reach,
  what a careful reader should not take from the paragraphs above.

**¶3 is not optional.** A reference work that carries only the settled account is a
textbook summary. The serotonin hall had no ¶3 anywhere, and every substantive error
found in the pass was an unhedged claim that a ¶3 would have caught.

### 1.2 The two tests

**Redundancy test.** Delete the body — does the abstract still stand alone? Delete the
abstract — does the body lose anything? Both answers must be yes. If deleting the
abstract loses nothing, the abstract is a duplicate and not a summary.

**Scope test (from `PRODUCT.md`).** The Archive explains *what a receptor does*.

- A sentence naming a **drug or drug class** belongs to the **Cabinet**.
- A sentence about **onset, course, risk or monitoring** belongs to the **Ledger**.
- The Archive may say what *blocking or activating the receptor* does to its circuit.
  It may not say which agents do the blocking.

*"Antagonism reduces cortical excitability"* — Archive.
*"which accounts for the antipsychotic effect of agents that block it"* — Cabinet.

---

## 2. The quiz standard

The desk's own help text: *"Used to check the claim holds up when it is asked back."*
That makes the quiz a verification instrument, not a study aid. Four requirements:

1. **Answerable from the specimen.** If `abstract` + `body` do not contain the answer,
   either the quiz is wrong or the narrative is incomplete. Fix the narrative first.
2. **Non-leading.** *"Why does X cause Y?"* presupposes Y and cannot be failed.
   Ask *"what does X do to Y"* or *"what sits between X and Y"*.
3. **No unsourced quantities.** If the expected answer contains a number, a source
   reporting that number must be attached to the specimen. Not to Stahl — to the study.
4. **Tests mechanism, not inventory.** *"Which drugs do X?"* is a Cabinet question
   wearing an Archive coat.

A good quiz is usually one that points at an *apparent contradiction in the specimen*
and asks the reader to resolve it — because that is exactly what the body's ¶1 exists
to explain.

---

## 3. Source sufficiency

### 3.1 What each status means

The desk offers `verified` / `provided` / `conflicting`. Bind them to conduct:

- **`provided`** — attached, not yet examined. The default. Not an accusation.
- **`verified`** — **all four** of: the identifier resolves; the stored metadata
  (authors, year, journal, title) matches the record exactly; you opened it; and it
  supports *the specific sentences it is attached for*. Failing any one, it stays
  `provided`.
- **`conflicting`** — it resolves and is real, but says something the specimen does not.
  This status is under-used. A source that contradicts you is more valuable than one
  that agrees, and burying it is the failure mode a reference work cannot afford.

### 3.2 Coverage, not count

Four sources on a specimen means nothing if all four are chapters of the same textbook.
Run the **claim-to-source map**: split the claim at its conjunctions, and for each half
name the attached source that carries it. A half with no source is either cut or sourced.

Three structural rules:

- **Exactly one `is_primary`.** The schema expects it and `/api/atlas/:volume` surfaces
  it. A specimen with zero primary sources renders with no citation at all.
- **At least one peer-reviewed article.** A specimen carrying only `kind='book'` rows is
  a specimen whose entire evidence base is one author's synthesis.
- **No single review carries a whole specimen.** If ¶1, ¶2 and ¶3 all trace to the same
  review, the specimen inherits that review's blind spots wholesale.

### 3.3 Metadata hygiene

A resolving PMID is necessary, not sufficient. Check that the *stored* record matches:

- Title character-for-character (singular/plural and subtitles get silently dropped).
- Year — for the *issue*, not the online-first date; these differ by a year routinely.
- `journal` populated. It was NULL on every serotonin article source.
- **Search the DOI for a corrigendum or erratum before marking `verified`.** One of the
  five serotonin primaries has a published corrigendum that the record did not note.

---

## 4. The pass order

Per specimen, in this order. Reversing it wastes work — editing prose before you know
what the sources support means editing twice.

1. **Resolve.** Every attached source: identifier resolves, metadata matches, no
   erratum. Fix records. → sets nothing yet.
2. **Map.** Split the claim; name the source behind each half. Unbacked halves get cut,
   hedged, or sourced. → settles the `claim` field.
3. **Read against.** For each source, does it support the sentences it is attached for?
   Set `verified` / `provided` / `conflicting` honestly. → tick **Citation**.
4. **Rewrite.** Abstract to the contract; body into its three paragraphs; run the
   redundancy and scope tests. → tick **Mechanism**.
5. **Re-quiz.** Rewrite the quiz against the *new* narrative under the four
   requirements in §2.
6. **Rate.** Mastery is your confidence in your own reading, not the entry's quality.
   Rate it last, when you have actually read the papers.

### 4.1 The invariant the desk does not enforce

Four of the five serotonin specimens carried a source marked `verified` while
`review_state.citation` was still `0`. **A source may not be `verified` on a specimen
whose Citation check is unticked** — otherwise "verified" degrades into "someone clicked
a chip." Until the desk enforces this (§5), enforce it by hand: never set a source
status without finishing step 3 for that specimen.

---

## 5. What the desk should enforce

Standing gaps, in the order they would pay off:

1. **Citation check gates source status.** Block `verified` on a specimen whose Citation
   check is unticked, or auto-untick Citation when a source is downgraded.
2. **Primary-source invariant.** Flag any specimen with zero or several `is_primary=1`.
   `ht3` currently has zero and renders uncited.
3. **Book-only warning.** Flag specimens whose sources are all `kind='book'`.
4. **Claim-to-source note.** A short free-text field on `receptor_sources` recording
   *which part of the claim* this source carries. Turns §3.2 from discipline into data.
5. **Corrigendum flag.** A boolean on `sources` plus a nudge to check before verifying.
6. **Scope lint.** Warn when Archive prose matches drug-class or onset/monitoring
   vocabulary — the `PRODUCT.md` boundary, made mechanical.
7. **Paragraph-count nudge.** Warn on a one-element `body_json`.

---

## 6. Housekeeping found during the pass

- `db/schema.sql` does **not** match the live database. The live `archive_entries`
  carries a `template TEXT` column added by `ALTER TABLE`, absent from `schema.sql`,
  unread by `lib/router.js`, and populated on exactly one receptor (`d2` = `'gpcr'`).
  Deleting `atlas.db` and re-migrating — a documented workflow — silently drops it.
  Either land it in `schema.sql` and the router, or drop it.
