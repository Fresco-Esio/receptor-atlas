# Affinity sourcing

How the Cabinet's binding-affinity matrix gets its numbers. Run these when you want to
refresh the data, add drugs, or revisit a sourcing decision. Nothing here runs at app
startup — the output is baked into `AFF_AGENTS` in the dashboard and seeded to the database.

## The rule that matters

**Relative affinity only means something within one methodology.** Different labs use
different radioligands, cell systems and conditions, so mixing sources silently produces a
table whose columns can't be compared. Everything below exists to keep a single spine.

| What | Source | Why |
| --- | --- | --- |
| **Affinity** | **NIMH PDSP Kᵢ Database**, human receptors only, median of all human values for the pair | One standardised program, built for psychoactive-drug receptor profiles, and comprehensive enough to cover the atlas |
| **Action** (agonist / antagonist) | **IUPHAR/BPS**, human preferred | PDSP is a *binding* database and records no direction. Shown only where IUPHAR curates one |
| **Assay type** | Radioligand **binding** only | The hot-ligand column reads `Functional` for functional-assay rows (~1720 human). Ki and functional potency are different quantities and are never averaged together |

Affinity is displayed as **pKi** (−log₁₀ of the molar Kᵢ): unitless, the field standard, and
log-scaled so "10× tighter" reads directly. **pKi is the number of record.** Kᵢ in nM is
re-derived from it for readers who think in Kᵢ — not the other way round. (An earlier version
of this file claimed the opposite; the code always did it this way.)

### Why median, and why in log space

Kᵢ is approximately log-normally distributed and its measurement error is multiplicative, not
additive — which is the reason the field reports pKi at all. So values are aggregated on the
log scale. For an odd number of values the median is identical either way, since order
statistics survive any monotonic transform; the choice only bites on an even count, where the
median averages the two central values, and the log-space answer (their geometric mean) is the
correct one under log-normality. The **median** rather than the mean because between-laboratory
Kᵢ data contain genuine outliers — different radioligands, non-equilibrium conditions,
transcription errors — and a robust estimator is the honest one.

Each cell therefore records its spread, not just its centre: `n`, `lo`, `hi`, and `nc` (how many
screens found nothing). A median with no dispersion behind it is not a reportable statistic.

### Three states that are not the same thing

- **Measured** — one or more real human Kᵢ values. `n` says how many, `lo`/`hi` the range.
- **Tested, nothing there** (`n:0`, `nc` > 0) — every human record for the pair is a censored
  `>10000` screen. Real evidence of selectivity; renders as a hollow ring. Censored screens are
  **counted, never averaged**: folding them into the median as if they were measurements dragged
  23 cells down by up to 1.2 log units.
- **Blank cell** — PDSP has **no human record at all**. Says nothing about whether the drug binds.

### Subtypes

A generic column is not a receptor. `alpha_1` pools A/B/D, whose medians can differ 60×, and a
median-across-subtypes understates a subtype-selective drug: guanfacine's pooled α2 median was
5.97 while its α2A median is 7.16 — and α2A selectivity is the entire point of the drug.

So: median **within** each subtype, then report the **tightest** subtype and name it in `sub`.
A subtype needs `n ≥ 2` (`MIN_SUBTYPE_N`) to be eligible, so a lone outlying reading cannot win
on noise; where nothing is replicated the cell falls back to the pooled median and is flagged
`weak:1`.

A subtype must also lead the runner-up by at least `MIN_SUBTYPE_MARGIN` (0.3 log units)
to be named. Below that the two are tied within between-laboratory noise, so the cell
reports the pooled median flagged `weak:1` rather than ordering two indistinguishable
numbers. Mirtazapine's alpha-2 is the worked example: alpha2C 7.74 against alpha2A 7.70.

24 cells currently report at a named subtype, 39 are low-confidence.

## Running it

```bash
node   scripts/sourcing/1-iuphar-fetch.mjs                 # action labels   (~2 min, cached)
python scripts/sourcing/2-pdsp-import.py KiDatabase_*.xlsx # affinity spine  (from the XLSX export)
node   scripts/sourcing/3-build.mjs           # report + diff, writes cache/aff-agents.txt
node   scripts/sourcing/3-build.mjs --write   # splice into the dashboard

# the app serves the database, not the HTML literal, so rebuild it:
rm db/atlas.db db/atlas.db-wal db/atlas.db-shm && npm run migrate
```

Steps 1 and 2 cache to `scripts/sourcing/cache/` (gitignored, re-fetchable) and skip anything
already fetched, so re-running is cheap. Stop the app before rebuilding the database.

**The database rebuild is not optional and not automatic.** Migrations are seed-only, so
`npm run migrate` against an existing `db/atlas.db` is a genuine no-op — you must delete the
file to load new numbers. That is deliberate: it's what stops a restart from wiping curation.

## Scope

`config.mjs` reads the drug list and the receptor columns from the dashboard's own
`AFF_AGENTS` / `AFF_TARGETS`, so adding a drug to the atlas automatically includes it in the
next run. `config.mjs` also holds every policy knob: species filter, name aliases, the
IUPHAR target-id map, the PDSP receptor-name matcher, and the inactive threshold.

Receptor subtypes are aggregated by median where the atlas shows a generic column: α1 covers
α1A/α1B/α1C/α1D, α2 covers α2A/α2B/α2C, and GABA-A covers the benzodiazepine-site subunits.

## What the current data looks like

282 of 923 cells filled, across 57 of 71 drugs.

- 84 cells carry an IUPHAR action; the rest render neutral and say *action not curated*
- 86 cells are tested-but-inactive (pKi ≤ 5)
- **NMDA is nearly empty** — most NMDA work is rodent or reported as pIC₅₀, not human Kᵢ
- 14 drugs come back blank, including fentanyl, atropine, doxazosin and memantine, whose PDSP
  data is rat-dominant

That last point is the live trade-off. Strict human-only keeps every number comparable at the
cost of those gaps; allowing flagged rat values would reach ~354 cells and recover 7 of the 14
drugs. The strict rule is the current deliberate choice — change `isHumanSpecies` in
`config.mjs` if you decide coverage matters more, but flag the substituted cells in the UI if
you do, or the table stops being apples-to-apples.

## Known source quirks

- `pdspdb.unc.edu` is the reachable PDSP host. `pdsp.unc.edu` has an incomplete TLS chain and
  `kidbdev.med.unc.edu` refuses connections. The bulk-CSV download links are dead, so step 2
  pages the results grid (`per-page=5000`; 50000 returns HTTP 500) and filters locally.
- IUPHAR's `affinity` field is sometimes a range (`"7.4 - 8.8"`) — take the midpoint, not the
  first number.
- IUPHAR writes allosteric modulation as bare `"Positive"`/`"Negative"`, and `"None"` where it
  records no action. Handled in `3-build.mjs`; benzodiazepines at GABA-A depend on it.
- IUPHAR is curated and selective, not exhaustive — it was evaluated as the spine and rejected
  for coverage (95 cells, no NMDA, no propranolol β1). It remains the right source for action.
