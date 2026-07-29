---
name: The Receptor Cabinet
description: A dim, after-hours specimen cabinet for neuroreceptor pharmacology, archival type and engraving over near-black walls.
colors:
  wall-atrium: "oklch(17% 0.012 75)"
  wall-panel: "oklch(20% 0.013 75)"
  wall-recess: "oklch(14% 0.011 75)"
  wall-normal: "oklch(18% 0.030 158)"
  wall-over: "oklch(23% 0.060 28)"
  wall-under: "oklch(18% 0.045 255)"
  bone: "oklch(93% 0.012 85)"
  bone-dim: "oklch(72% 0.015 85)"
  bone-faint: "oklch(63% 0.013 85)"
  vermilion: "oklch(62% 0.19 35)"
  brass: "oklch(70% 0.055 80)"
  state-baseline: "oklch(78% 0.085 158)"
  state-over: "oklch(66% 0.185 38)"
  state-under: "oklch(72% 0.10 245)"
typography:
  display:
    fontFamily: "Marcellus, serif"
    fontSize: "clamp(1.7rem, 3.6vw, 2.6rem)"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0.04em"
  title:
    fontFamily: "Marcellus, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.03em"
  body:
    fontFamily: "Schibsted Grotesk, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: "normal"
  label:
    fontFamily: "Fragment Mono, monospace"
    fontSize: "0.6875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.14em"
rounded:
  sm: "2px"
  md: "3px"
spacing:
  xs: "0.4rem"
  sm: "0.7rem"
  md: "1.2rem"
  lg: "2rem"
components:
  button-segmented:
    backgroundColor: "{colors.wall-recess}"
    textColor: "{colors.bone-faint}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.6rem 0.95rem"
  button-segmented-active:
    backgroundColor: "{colors.wall-recess}"
    textColor: "{colors.bone}"
  sim-button-active:
    backgroundColor: "{colors.state-baseline}"
    textColor: "{colors.wall-recess}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.62rem 0.95rem"
  tag-agonist:
    backgroundColor: "{colors.wall-recess}"
    textColor: "{colors.state-baseline}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.32rem 0.6rem"
  tag-antagonist:
    backgroundColor: "{colors.wall-recess}"
    textColor: "{colors.state-over}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0.32rem 0.6rem"
  specimen-row:
    backgroundColor: "{colors.wall-atrium}"
    textColor: "{colors.bone-dim}"
    typography: "{typography.title}"
    padding: "1.15rem 0.4rem"
---

# Design System: The Receptor Cabinet

## 1. Overview

**Creative North Star: "The Receptor Cabinet"**

A specimen cabinet visited after hours. The walls are near-black and warm, lit only where an object is on display; each receptor is a catalogued specimen with an index numeral, an engraved figure, and a provenance line, never an icon-card in a grid. The voice is curated, cinematic, and clinically precise: institutional gravity from archival type and brass hairlines, life from mechanical-archival motion (plates drawing on, dials locking, walls repainting with the diagnostic state). The interface should feel like instruments under glass, not a SaaS console.

The system explicitly rejects its anti-references: Notion / wiki blandness (white pages, emoji, gray sidebars); the generic SaaS landing formula (gradient-blob hero, three feature cards); dark neon cyberpunk (glowing neon-on-black, crypto energy); and cluttered stat-tile dashboards. Darkness here is wall space, deliberate and quiet, not a "tools look cool dark" reflex.

**Key Characteristics:**
- Drenched-dark, warm-tinted walls that repaint by diagnostic state (baseline green, over red, under blue).
- Archival type trio: inscriptional display, grotesk body, mono catalog labels.
- Engraving as signature: SVG figures that draw on with dashoffset.
- Color is scarce and semantic. The single vermilion accent is ceremonial; the three state colors each mean exactly one thing.
- Specimen, not card. Plates, index numerals, provenance, never repeated icon-heading-text tiles.

## 2. Colors

A near-black warm-neutral field, one ceremonial accent, and a three-color diagnostic palette that doubles as the data-viz language. Every neutral is tinted toward the warm hue (75–85); nothing is pure black or white.

### Primary
- **Vermilion** (oklch(62% 0.19 35)): The single ceremonial accent. Selected specimen tick, key links, the live core of the brand mark, `::selection`. Used scarcely; its rarity is the signal.

### Secondary (the diagnostic / data-viz palette)
These three are functional, never decorative. They name receptor state in the Cabinet and binding action in the Affinity Plate.
- **State Baseline / Activates** (oklch(78% 0.085 158), green): normal physiological state; agonist action.
- **State Over / Inhibits** (oklch(66% 0.185 38), red-orange): overstimulated state; antagonist / blocker / inverse-agonist action.
- **State Under / Reuptake** (oklch(72% 0.10 245), blue): understimulated state; reuptake-transporter inhibition.

### Tertiary
- **Brass** (oklch(70% 0.055 80)): hairlines, rules, focus ring, partial-agonist / modulator action, and all metal. Lives mostly at low alpha (`brass-line` 0.28, `brass-faint` 0.14).

### Neutral
- **Wall Atrium** (oklch(17% 0.012 75)): the default page wall.
- **Wall Panel** (oklch(20% 0.013 75)): lifted surface, one shade up (plates, catalogue).
- **Wall Recess** (oklch(14% 0.011 75)): sunk wells, one shade down (inputs, controls, table head).
- **Wall Normal / Over / Under** (oklch(18% 0.030 158) / oklch(23% 0.060 28) / oklch(18% 0.045 255)): the exhibit wall repaints to these when a state is simulated.
- **Bone / Bone-dim / Bone-faint** (oklch(93% 0.012 85) / 72% / 63%): primary, secondary, and tertiary text.

### Named Rules
**The One Voice Rule.** Vermilion is ceremonial. It marks the one thing that matters in a view (the selected specimen, the live accent) and appears on a sliver of any screen. Spend it everywhere and it stops meaning anything.

**The Semantic-Color Rule.** The three state colors carry meaning, never decoration. Green/red/blue mean baseline/over/under in the Cabinet and activate/inhibit/reuptake in the Plate, and they mean the same thing in every component that shows them (matrix dots, rose petals, legends, tags). A color never switches jobs to encode identity or mood.

**The Tinted-Neutral Rule.** No `#000`, no `#fff`. Every neutral carries a trace of the warm hue (75–85, chroma 0.011–0.018). Pure gray reads as foreign here.

## 3. Typography

**Display Font:** Marcellus (Roman inscriptional capitals; museum-plaque lettering)
**Body Font:** Schibsted Grotesk (400 / 500 / 700)
**Label / Mono Font:** Fragment Mono (catalog numerals, metadata, all-caps labels)

**Character:** Inscriptional display over a quiet grotesk, with a monospace doing the card-catalog work. The pairing reads as a museum caption beside a laboratory ledger, authoritative without being stiff.

### Hierarchy
- **Display** (Marcellus 400, clamp(1.7rem, 3.6vw, 2.6rem), line-height 1.05, +0.04em, uppercase): plate titles and section heroes.
- **Title** (Marcellus 400, 1.125rem, +0.03em): specimen names, catalogue cell names, monitor status.
- **Body** (Schibsted Grotesk 400, 1rem, line-height 1.65): mechanism prose, presentation bullets, warnings. Cap measure at 65–75ch.
- **Label** (Fragment Mono 400, 0.6875rem, +0.14em, uppercase): section labels, kickers, counts, provenance, all controls.

**There is exactly one label step.** `--lbl` (0.6875rem / 11px) is the floor for any text a reader has to act on. A second token, `--lbl-sm`, once shipped at 0.6rem (9.6px) and carried real controls on four pages; it is retired to an alias of `--lbl` and must never be given a smaller value again. `test/design-conformance.test.js` enforces both the floor and the alias across every published page.

### Named Rules
**The Catalog-Hand Rule.** Index numerals, counts, drug names in the affinity chart, and every control label are set in Fragment Mono. The mono is the catalog hand; prose and titles never borrow it.

**The Inscription Rule.** Marcellus is always uppercase with open tracking when used large. Never set body copy in the display face; never set a label in it.

## 4. Elevation

The system is flat by default and conveys depth through tonal layering, not shadow. The three wall tones (recess < atrium < panel) do the work: controls and table heads sink to `wall-recess`, surfaces lift to `wall-panel`, and inset wells use `oklch(0% 0 0 / 0.12–0.18)` washes. Borders are brass hairlines, never drop shadows for separation.

### Shadow Vocabulary (state-only)
- **Masthead lift** (`box-shadow: 0 1px 0 var(--brass-faint), 0 8px 28px oklch(0% 0 0 / 0.35)`): appears only once the page is scrolled (`.is-scrolled`), signaling the bar has detached.
- **Dialog** (`box-shadow: 0 24px 60px oklch(0% 0 0 / 0.5)`): the one floating surface; depth justifies the lift.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. A shadow is a response to state (scroll, modal), never ambient decoration. If a panel needs separating at rest, it gets a brass hairline or a tonal step, not a shadow.

**The No-Glass Rule.** Backdrop blur is not a default. Glassmorphism is reserved for the rare true overlay (the dialog veil) and never used to dress up a resting surface.

## 5. Components

### Buttons
- **Shape:** square-ish, `rounded.sm` (2px). Brass-hairline border, `wall-recess` ground.
- **Segmented (Cabinet / Catalogue view toggle):** Fragment Mono label, `bone-faint` at rest, `bone` on hover/active, a small rotated `seg-dot` that fills vermilion when active; an active hairline draws in under the label.
- **State simulator (the brass dial):** three segments (Understimulated / Baseline / Overstimulated). The active segment fills with its state color (green/red/blue) and inverts text to `wall-recess`; press gives a 0.94 scale and a state-flash.
- **Acknowledge / ghost:** transparent with brass-hairline border, text shifts to vermilion on hover.

### Chips (drug tags)
- **Style:** `wall-recess` ground, brass-faint border, Fragment Mono, `rounded.sm`.
- **Variants:** agonist tints border + text toward state-baseline (green); antagonist toward state-over (red). They stagger in on render.

### Cards / Containers (Plates)
- **Corner Style:** `rounded.md` (3px).
- **Background:** `wall-panel`, repainting to `wall-normal/over/under` by `data-state`.
- **Shadow Strategy:** none at rest (see Elevation); brass-hairline borders only.
- **Internal Padding:** fluid, `clamp(1.4rem, 3vw, 2.2rem)`.
- **Rule:** never nest a plate inside a plate.

### Inputs / Fields
- **Style:** `wall-recess` ground, brass-line border, `rounded.sm`; leading search glyph.
- **Focus:** border shifts brass-line → brass; global `:focus-visible` is a 1px brass outline at 3px offset.
- **Sizing:** every field sits on the same control rhythm as the segmented buttons, roughly 33–41px tall. A filter that lives inside a dense header band is not an excuse to shrink it.

### Navigation
- **Masthead:** sticky, `wall-recess` ground with a brass-line underline; brand mark + wordmark left, search + segmented control right. Its measured height drives `--mast-h`, read live by a ResizeObserver because the bar wraps at narrow widths. The lift shadow fires on page scroll, so above the viewport-fit breakpoint it correctly never appears: nothing passes under the bar any more.

## 5b. Layout: the viewport-fit shell

Above 941px the document does not scroll. The window is divided once — masthead, view, disclaimer — and each panel inside a view scrolls in its own box. `body` is the flex column that does the dividing, so no rule has to know the masthead's height or the footer's; the middle row takes what is left. That also keeps the medical disclaimer on screen, which a bare `overflow: hidden` on a `100svh` body would have clipped away unreachably.

- **Cabinet:** the specimen rail and the exhibit plate scroll independently, so reading a long plate never drags the index out from under the cursor. The plate scrolls as one with its head pinned; scrolling only the body would leave provenance and the cross-volume bridge to absorb the shortfall by shrinking and clipping.
- **Catalogue / Primer:** single panes that take the height, the matrix keeping its column headers pinned.
- **Below 941px** the columns stack and the lock lifts. A pile of short scroll boxes on a phone reads worse than one honest page scroll.

**The Override-Layer Rule.** The shell lives at the end of the stylesheet, not in the layout section. It overrides settled component decisions (`.plate`'s `overflow: hidden`, the catalogue's own svh arithmetic) which are declared later than the layout section, so an override placed up there loses on source order without changing specificity. Read it as a layer, not as a stray.

### Engraving (signature)
SVG receptor/transporter figures built from `e-line` / `e-dim` / `e-fill` / `e-text` strokes that draw on via `pathLength` + dashoffset when a specimen or state changes, under a monitor scan-sweep. The central pore/ligand radius scales with state. This is the system's defining motion; treat it as the hero, not an embellishment.

### Binding Affinity Plate (signature)
A sticky 16-slot affinity rose beside a scrollable agent x target matrix. One petal per screened target: its length is relative affinity (pKi) on a scale running 5 to `PETAL_MAX`, set to the catalogue's real maximum so no radius is wasted, and its fill is the action, from the same diagnostic palette the matrix dots use. `PETAL_MAX` is currently 9.8 (asenapine at 5-HT2A). It is a constant rather than a value derived from the data, so the scale does not shift under the reader on every re-sourcing; the cost is that a refresh can raise the true maximum past it and the clamp would then draw a tighter binder short, so `test/affinity-plate-layout.test.js` fails if any cell exceeds it. The distinction the rose exists to keep: a target screened and found inert keeps a short stub at the floor ring, while a target nobody has screened leaves its slot **empty**. A sparse agent must read as thinly characterised, never as inert.

Pinning is capped at **two**, and the pair is told apart by fill: the first pin is solid, the second is hatched in the same action colour, with a hairline down each spoke splitting them. Identity never rides hue — hue is spoken for by action — and position within the spoke proved too weak to carry it alone. Two is a ceiling, not a default: there is no third fill that stays legible at petal size, so a third pin evicts the oldest. Hover an agent row to trace it as a dashed outline; click to pin. Selection changes morph — petals grow out of the floor ring and retract into it — which is the plate's own signature motion, the counterpart to the engraving's draw-on.

**A cap has to announce itself.** The row shows a `pin` / `unpin` cue on hover and keyboard focus, because the action was otherwise invisible and its effect (petals changing) happens far from the click. When a third pin evicts the oldest, the legend names the one that was dropped in vermilion rather than letting it vanish. The cue hangs off the row's `.lit` class, not `:hover`: `.row` is `display: contents` and generates no box of its own.

**Finding one of 92 agents.** The matrix carries a name filter in the head it filters. Group headings hide once nothing under them survives, and filtering never disturbs which agents are pinned — the filter is a view over the matrix, not a selection in it.

**Screened-clean versus never-screened.** Four of five clinical reviewers could not tell a hollow ring from an empty cell at a glance, which collapses the single most important distinction on the plate. The inert dot carries a centre mark so it has presence, and the legend names the empty case in words: *never screened, not evidence of no binding*.

## 6. Do's and Don'ts

### Do:
- **Do** keep vermilion ceremonial, one accented thing per view (The One Voice Rule).
- **Do** keep green/red/blue strictly semantic and identical across the Cabinet, the matrix, the rose, and every legend (The Semantic-Color Rule).
- **Do** tint every neutral toward hue 75–85; convey depth with the three wall tones, not shadows.
- **Do** present each receptor as a catalogued specimen (index numeral, engraving, provenance) and let the engraving draw on as the signature motion.
- **Do** set all labels, counts, and catalog numerals in Fragment Mono; titles in Marcellus uppercase; prose in Schibsted Grotesk at 65–75ch.
- **Do** ease with `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out); animate transform/opacity/clip, not layout.
- **Do** honor `prefers-reduced-motion` with instant final states.

### Don't:
- **Don't** drift into Notion / wiki blandness: white pages, emoji icons, gray sidebars.
- **Don't** build the SaaS landing formula (gradient-blob hero, three feature cards) or a cluttered stat-tile dashboard.
- **Don't** go dark-neon cyberpunk; this is tungsten-on-charcoal, not neon-on-black.
- **Don't** use `#000` or `#fff`, or any untinted gray.
- **Don't** use gradient text (`background-clip: text`), side-stripe accent borders (>1px colored `border-left/right`), the big-number hero-metric template, or identical icon-heading-text card grids.
- **Don't** use backdrop blur on resting surfaces; reserve it for the true overlay only.
- **Don't** repurpose a state color to encode identity or mood, and don't reach for a second accent beside vermilion.
- **Don't** nest cards/plates, wrap everything in a container, or use em dashes in copy.
