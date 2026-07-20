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

Affinity is displayed as **pKi** (−log₁₀ of the molar Kᵢ): unitless, the field standard, and
log-scaled so "10× tighter" reads directly. The stored number stays **Kᵢ in nM** — PDSP's
native unit — and pKi is derived for display, so the record never drifts from the source.

Two states that are not the same thing, and must never be conflated:

- **pKi ≤ 5** (`INACTIVE_PKI`) — PDSP records screening results at ≥ 10 µM as Kᵢ 10000. The
  pair was **tested and showed no meaningful binding**. Real evidence of selectivity; renders
  as a hollow ring.
- **Blank cell** — PDSP has **no human value**. Says nothing about whether the drug binds.

## Running it

```bash
node scripts/sourcing/1-iuphar-fetch.mjs    # action labels        (~2 min, cached)
node scripts/sourcing/2-pdsp-pull.mjs       # affinity spine       (~2 min, cached)
node scripts/sourcing/3-build.mjs           # report only, writes cache/aff-agents.txt
node scripts/sourcing/3-build.mjs --write   # splice into the dashboard

# the app serves the database, not the HTML literal, so rebuild it:
rm db/atlas.db db/atlas.db-wal db/atlas.db-shm && npm run migrate
```

Steps 1 and 2 cache to `scripts/sourcing/cache/` (gitignored, re-fetchable) and skip anything
already fetched, so re-running is cheap. Stop the app before rebuilding the database.

**The database rebuild is not optional and not automatic.** Migrations are seed-only, so
`npm run migrate` against an existing `db/atlas.db` is a genuine no-op — you must delete the
file to load new numbers. That is deliberate: it's what stops a restart from wiping curation.

## Scope

`config.mjs` reads the drug list and the 13 receptor columns from the dashboard's own
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
