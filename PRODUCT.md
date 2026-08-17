# Product

## Register

brand

## Users

Two audiences. Primary: visitors the owner is presenting to — colleagues, collaborators, and people evaluating the owner's design and curation sensibility. They arrive cold, on a desktop browser, with a few minutes of attention; the site must impress within the first scroll. Secondary: the owner himself, returning to browse and extend a personal knowledge base of topics organized into categories and entries.

## Product Purpose

A neuroreceptor pharmacology reference presented as a digital museum, where the act of browsing is itself the exhibit. One receptor is followed across three volumes, and each volume has a distinct **form** as well as a distinct topic, because the form is what keeps their scopes apart: the **Archive** is prose and explains what a receptor does; the **Cabinet** is tables and binding profiles and specifies how the molecules at a target differ, across 92 agents and 16 targets; the **Ledger** is syndromic and describes how a receptor presents clinically, with onset, course, risk and monitoring. What varies between molecules at the same receptor belongs to the Cabinet; what a state looks like at the bedside belongs to the Ledger; neither restates the other. A local-only Conservator's Desk is where the collection is curated and every citation verified.

Motion, animation, and scroll choreography are the product's identity, not decoration. Success: a first-time visitor moves through a volume unprompted and remembers the experience, and a clinician can trace any number on the page back to the source and the rule that filtered it.

**It is a reference work, so accuracy outranks the exhibit.** Every displayed value carries its provenance, its spread, and how many measurements sit behind it. A claim the code cannot support does not ship, however good it sounds: the page has already claimed a statistic it never computed, a target count that was wrong in five places, and drug examples that had been removed from the atlas. When the two goals collide, the number wins and the design accommodates it.

## Brand Personality

Curated, cinematic, precise. The feeling of walking a dim gallery after hours: hushed, spacious, every object lit deliberately. Index numbers, catalog plates, and archival typography give it institutional gravity; the motion gives it life. Confident silence over loud effects.

## Anti-references

- Notion / wiki blandness: white pages, emoji icons, gray sidebars.
- Generic SaaS landing formula: gradient-blob hero, three feature cards, testimonial strip.
- Dark neon cyberpunk: glowing neon-on-black, crypto-site energy.
- Cluttered dashboards: dense panels, stat tiles, chart walls.

## Design Principles

1. **The browse is the exhibit.** Scroll position is the visitor's footsteps through the gallery; every section reveal should feel like rounding a corner into a new room.
2. **Specimen, not card.** Each entry is presented like a catalogued object — index number, plate, caption — never an icon-heading-text card in a grid.
3. **Darkness is wall space.** Generous near-black space between exhibits creates pacing; emptiness is deliberate, not unfinished.
4. **Motion with provenance.** Every animation should feel mechanical-archival (drawers sliding, plates settling, light sweeping) rather than springy or playful.
5. **Typography carries authority.** Archival/editorial type hierarchy does the institutional voice; color stays scarce and ceremonial.

## Accessibility & Inclusion

Motion-first by explicit owner choice; this is a showcase. Provide only a basic `prefers-reduced-motion` fallback (instant-state, no parallax). Maintain readable contrast for all body text; decorative elements may run lower contrast.
