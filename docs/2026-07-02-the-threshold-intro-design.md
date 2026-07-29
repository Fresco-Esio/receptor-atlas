# The Threshold — a new entrance for The Receptor Atlas

*Design brief. Curatorial + motion spec for replacing the vertical rotunda with a cinematic threshold and an equal-weight triptych landing.*

---

## 1. The diagnosis (why the current rotunda leaks attention)

The build is good. The system (walls that repaint by room, drawing-on engravings, the mono catalog hand) is coherent and genuinely on-brand. The problem is not the *look* — it is the **grammar of the entrance**.

The rotunda is a **vertical reading order**: hero → manifesto → through-line → Volume I → Volume II → Volume III → colophon. Three consequences fall out of that single decision:

1. **Position assigns value.** Volume I is first and largest, so it reads as *the* thing. Visitors enter the Archive, dive into a full-screen stage, and never surface. II and III are "below the fold," which the eye reads as "lesser / optional / later."
2. **Exposition precedes seduction.** The manifesto explains the entire thesis, and the through-line diagram explains the reading order, *before* the visitor has any felt reason to care. Mystery dies when the wall text arrives before the object.
3. **The room appears fully-formed.** Everything is centered, symmetrical, and present on load. There is no *arrival* — no darkness resolving into light — so there is no threshold to cross and nothing to remember.

The fix is structural, not cosmetic. **Stop stacking the volumes vertically. Present them laterally, as a simultaneous choice, after a threshold moment that earns the visitor's attention.**

> Pushback worth stating plainly: do **not** throw the rotunda's assets away. The drawing-on engravings and the `data-room` colour system are the best things you have. This design *reuses* both — it just changes the container they live in.

---

## 2. The concept — "The Threshold"

> *One cabinet. Three doors. After hours.*

A visitor arrives in the dark. A single point of light ignites, an aperture dilates, a raking light crosses the wall like a curator throwing the breaker — and the light leaves behind **three doorways standing in a row**, equal in weight, each a Volume. The title settles above them as a lintel inscription. Then each door *wakes* in its own light. The visitor does not fall down a scroll into Volume I; they stand in an antechamber and **choose which door to open**.

Two parts:

- **The cold open** — a ~3.4s cinematic reveal, plays once, skippable (Section 3).
- **The antechamber** — the resting landing that replaces the rotunda (Section 4).

---

## 3. The cold open (bold threshold moment)

Four beats. All timings assume `--ease: cubic-bezier(0.16, 1, 0.3, 1)`. Animate **transform, opacity, and clip-path only** — never layout.

| # | Beat | Time | What happens |
|---|------|------|--------------|
| 01 | **Ignition** | 0.0–0.6s | Full `--wall-vault` black. One `--vermilion` point — the aperture core — scales `0 → 1` and fades in at screen center. Faint brass ring at very low alpha. Silence. |
| 02 | **The aperture dilates** | 0.6–1.4s | Concentric brass rings (reuse `.hero-rings`, but as an opening iris: `scale` + `opacity`, not idle rotation) expand outward. A raking band of light (a `--bone` linear-gradient parallelogram at ~0.2 alpha, translated via `clip-path`/`transform`) sweeps left → right across the wall. |
| 03 | **Three doors revealed** | 1.4–2.4s | As the sweep passes, three tall dark doorways are left standing in a row. The title `THE RECEPTOR ATLAS` settles above as a lintel — **reuse the existing `.ch` letter-rise** with `--letter-stagger`. A brass hairline underlines it. |
| 04 | **The doors wake** | 2.4–3.4s → resting | Each door lights in its own room-colour at low intensity, staggered I → II → III. Inside each, the engraving **draws on** (reuse `.vol-fig .stroke` `stroke-dashoffset`). Roman numerals fade up. Cue label `CROSS A THRESHOLD` appears. Settles directly into the antechamber. |

**Choreography** (see the motion-timeline diagram): tracks overlap so it reads as one gesture, not a sequence of tricks. Core ignites, rings begin dilating before the core finishes, the sweep rides the rings out, the title rises as the sweep clears, the doors wake as the title lands, engravings draw under the waking. One breath in, one breath out.

**Skip / accessibility / return paths:**

- A small `SKIP ↳` control (mono, `--bone-faint`) sits bottom-right from 0.0s.
- `prefers-reduced-motion: reduce` → skip beats 1–8 entirely; render the resting antechamber (beat 04 end-state) instantly. No parallax, no sweep.
- Return visitor (`sessionStorage` flag) → play the cold open once per session at most; on subsequent loads, land straight on the antechamber.

---

## 4. The antechamber (the resting landing)

Replaces the entire `#rotunda` block. One viewport, no scroll required to see all three volumes.

**Composition (asymmetric, left-anchored — deliberately not centered):**

- **Lintel title, upper-left:** `THE RECEPTOR ATLAS` in Marcellus, kicker `EST. MMXXVI · ONE CABINET · AFTER HOURS` in Fragment Mono beneath, a brass hairline under it. Not a centered title card.
- **Provenance spine, right edge:** vertical mono line `A REFERENCE IN THREE VOLUMES · MOLECULE → BEDSIDE` (`writing-mode: vertical-rl`), echoing the existing `.hero-cue`.
- **Three doors, one row, equal width and height,** occupying the lower two-thirds. Each door carries: Roman numeral (large, `--brass`), volume kicker (mono), volume title (Marcellus), the drawing-on engraving as "the specimen behind glass," a one-line provenance, and an enter affordance (`OPEN THE CABINET →`, reuse `.vol-enter` hover: gap widens, arrow slides, colour → vermilion).

**The hover-wake mechanic (the intrigue engine):**

When a door is hovered or focused:

- the **whole wall repaints** to that volume's room-colour — reuse the existing `body[data-room]` system: Archive → `celestial`, Cabinet → `umber`, Ledger → `verdigris`. Drive it by setting `data-room` on hover/focus.
- the hovered door **lifts** (raises to `--wall-panel`, brass border strengthens, a `--vermilion` selection tick appears on its leading edge), and its engraving completes/breathes.
- the **other two recede** — drop to ~0.5 opacity, desaturate slightly. They are still there, still equal, just momentarily in shadow.

This is what makes the choice lateral and rewarding: sweeping across the three *does something*, and each one answers in its own colour. The `data-room` colour and the engraving — assets you already built — become the payoff instead of scenery below the fold.

**Withheld exposition:** the manifesto does **not** sit on the landing in full. Collapse it to a single withheld line near the lintel, with a quiet `THE ARGUMENT →` / `READ IN ORDER →` affordance that reveals the linear molecule→bedside path on demand. Give people who want the through-line a door to it; don't force it on everyone at arrival.

**Narrow screens:** the triptych becomes three **full-height snap panels** (`scroll-snap`), so the visitor must pass through each in turn — order preserved, equality preserved, no single door dominating. Each panel wakes to its room-colour as it snaps into view (IntersectionObserver → `data-room`), mirroring the hover-wake on desktop.

---

## 5. Palette & type (unchanged — use existing tokens)

Nothing new is introduced. Everything maps to variables already in `the-receptor-atlas.html`:

- Walls: `--wall-vault` (the black of the cold open), `--wall-atrium`, and the three room hues `--wall-celestial` / `--wall-umber` / `--wall-verdigris` (the door-wake colours).
- Ink: `--bone` / `--bone-dim` / `--bone-faint`.
- Ceremony: `--vermilion` stays scarce — the ignition point, the selection tick, the cue. One accented thing at a time (The One Voice Rule holds).
- Metal: `--brass` / `--brass-line` / `--brass-faint` for rings, hairlines, numerals, borders.
- Type: Marcellus (lintel, door titles, numerals — uppercase, open tracking), Schibsted Grotesk (the one withheld manifesto line), Fragment Mono (kickers, provenance, cue, all labels).

No `#000`/`#fff`, no second accent, no gradient text, no backdrop-blur on resting surfaces. The cold open's raking light is a masked `--bone` gradient in motion, not a glow.

---

## 6. Build notes

- The cold open and antechamber replace `#rotunda`; the `#stage` iframe viewer and `.lintel` frame are untouched — a door's enter affordance calls the same `data-enter` handler that the volume plates call today.
- Reuse verbatim where possible: `.hero-rings` (repurpose as the iris), `.ch` + `--letter-stagger` (lintel title), `.vol-fig .stroke` draw-on (door engravings), `.vol-enter` hover (door affordance), `body[data-room]` transition (wall wake).
- Keep the 0.85s `--wall` transition on `body` — it is exactly the "wall repainting" feel the hover-wake needs.
- Verification pass before ship: (1) tab-order reaches all three doors and the skip control; (2) reduced-motion renders the antechamber with zero animation; (3) each door's `data-room` matches its volume (celestial/umber/verdigris); (4) vermilion appears on no more than one element per state.
