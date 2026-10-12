# Ledger studies

Two standalone pages built in a claude.ai conversation in October 2026, kept here as
reference while deciding what to bring into the Clinical Ledger. Neither is published by
`npm run snapshot`, and neither is in the page list `test/design-conformance.test.js`
sweeps. Each is one self-contained file: open it in a browser (the fonts load from
Google Fonts, so they need a connection).

| File | What it is | Design system |
|---|---|---|
| `surface-receptors.html` | PRITE tutorial on neuronal cell surface receptors: ligand-gated channels, GPCRs, Trk receptors. A simulated GABA-A single-channel trace (benzodiazepine vs barbiturate), an NMDA coincidence-detector model with the Jahr and Stevens Mg²⁺ I–V curve, a stepped G-protein cycle for Gs, Gi/o and Gq, TrkB activation, a 42-receptor finder, clinical correlates, and a quiz. | Its own: light and dark tokens, Newsreader and Atkinson Hyperlegible. Not the Cabinet system, and it uses em dashes in places. |
| `operable-ledger.html` | A format study for Volume III: receptor action traced to clinical presentation. Nine rooms: intrinsic-activity dial, D2 occupancy against Kapur's thresholds, dopamine pathways, off-target body map, toxidrome patient with a Hunter criteria checker, onset clock, adaptation and withdrawal, an index of the 23 Archive specimens, and vignettes. | Cabinet tokens, type and state colours; no em dashes. |

## Candidates for the Ledger

- **Onset clock and the adaptation room.** PRODUCT.md gives the Ledger onset, course,
  risk and monitoring; the live table carries excess and deficit only. These two rooms
  are the closest thing to that missing half.
- **Toxidrome patient, side-by-side table and Hunter checker.** Differential diagnosis
  across receptors, which a per-receptor row cannot show.
- **The dial.** Shows that excess or deficit depends on existing tone and set point, not
  on the drug alone (precipitated withdrawal, varenicline, flumazenil in dependence).
- Likely not worth porting: the index and the off-target body map restate the Ledger's
  columns and lean into the Cabinet's ground (Volume-Boundary Rule).

## Known limits

- The dial's efficacy values are placed so each drug class moves in a recognisable
  direction. They are not measured intrinsic activities, and one variable cannot show
  both precipitated withdrawal and full relief on buprenorphine induction.
- The adaptation curves are illustrative and fitted to nothing.
- All content is hard-coded in each file. None of it reads from the database or
  `db/curator-state.json`, and its sources are not in the source register. The primary
  papers each page cites were checked against PubMed when the page was built; DOIs are
  in each page's Sources section.
- Both are single long-scroll pages. The volumes use the viewport-fit shell above 941px,
  so any room brought across needs to become a panel.
