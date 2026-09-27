# Desk Publish button — design

Addendum to `2026-09-26-hosted-desk-design.md`. Owner's request: "a button on desk that just
saves and updates the site for me. It does the commit or whatever. I would be the only person
who knows about the desk anyway so that's fine."

## Why not a claude.ai connector

The page's claude.ai copy can reach other hosts only through the `mcp` capability, and
GitHub's hosted MCP server cannot be added as a claude.ai custom connector: GitHub's own
install guide says it "requires OAuth authentication through a registered GitHub App (or
OAuth App), which is not currently supported", and the failure people hit is "Incompatible
auth server: does not support dynamic client registration". So the button lives where the
page can call GitHub's REST API directly: the same `desk.html` opened from the public site
(`/desk/`) or from disk — **browser mode** — never inside the claude.ai frame.

## Decisions (owner)

- Build it, in both the site copy and the disk copy.
- The token is remembered in that browser (localStorage), with a Forget button.
- The claude.ai copy is unchanged; its changes move with Download changes → Import changes.

## What the button does

1. `flush()`; take `store.list()`; nothing unpublished → "Nothing to publish."
2. No token → open the GitHub token dialog first.
3. `GET /repos/Fresco-Esio/receptor-atlas/contents/db/curator-state.json?ref=main` → the
   repo's current edits file and its blob `sha`.
4. `preparePublish(SEED, changes, repoState)` (desk-core): the same stale-seed check as
   `desk:pull` (the repo's file must equal the snapshot's `baseState`, or what this Desk
   already published, compared as data); refuse with the differing keys otherwise. On ok it
   returns the edits-file text (`JSON.stringify(state, null, 1) + '\n'`) and the commit
   subject (`curate: …`, same words as `lib/git-publish.js`).
5. A confirm dialog shows the subject. Publish / Cancel.
6. `PUT …/contents/db/curator-state.json` `{ message, content (base64), sha, branch: 'main' }`
   → `commit.sha`. Only now: `markPublishedFrom(current, pulled, sha, at)` per receptor,
   store the receipt (`{ sha, at, url }`), banner shows "last published a1b2c3d · 26 Sep".
7. GitHub Actions rebuilds the site (~1–2 min); `/desk/` comes back on a new snapshot.

The written file is byte-identical to what `desk:pull` writes: `toCuratorState` now orders
the `review`, `content.claims`, `content.archive` and `content.clinical` maps the way the
database export does (the pristine seed's key order), which the round-trip test pins.

## After a publish: re-keying in browser mode

`/desk/` is rebuilt on every push, so after a button publish the stored documents carry an
older `seedCommit`. At load (and after an Import) in browser mode, for documents whose
`seedCommit !== SEED.commit`: every distinct `publishedAs` is checked for ancestry with
`GET /repos/…/compare/{publishedAs}...{SEED.commit}` (`status` ahead or identical = ancestor;
works without a token on a public repo), then `rekeyAll(SEED, docs, isAncestor)` — the same
function `desk:rekey` uses — and the re-keyed documents are stored. When it refuses
(unpublished reverts, or a publish not in the seed's history) or GitHub is unreachable, the
documents are left alone and a notice line says why. `SEED.commit === 'uncommitted'` skips it.

## Token

A fine-grained personal access token: Repository access → only `receptor-atlas`;
Repository permissions → Contents: Read and write. Sent only to `https://api.github.com`,
as `Authorization: Bearer`. Stored under `atlas-desk-github-token` in localStorage when
"remember in this browser" is on (default), else held in memory for the session. Every site
under `fresco-esio.github.io` shares that origin; all are the owner's.

## Not in the claude.ai frame

`window.claude` present → no Publish, no Import, no token dialog (the CSP blocks
api.github.com there; "publish the atlas" stays the route). After a button publish, the
claude.ai copy's next "publish the atlas" refuses (seed moved) until it is re-seeded — the
same rule as today for any publish it did not make.

## Tests

- `node --test`: ordering makes the converter byte-identical to `canonicalise` (two
  scenarios); `preparePublish` accepts the snapshot's file and the page's own last publish,
  refuses a moved file; `commitSubject`; `changeShapeError`; `rekeyAll` from desk-core.
- Walkthrough (Playwright, `page.route` on `https://api.github.com/**`): Publish absent in
  the fake claude.ai frame; present in browser mode; no token → dialog; publish → the PUT
  body decodes to `toCuratorState(SEED, changes)` bytes, records marked with the returned
  sha, receipt in the banner; a moved repo file → refusal, no PUT; a stored document keyed
  to an older seed with `publishedAs` in history → re-keyed on load; not in history → left,
  notice shown; Import merges a changes.json.

## Rulings made during implementation (the code follows these, not the sections above)

- **Publish is held while any stored document is keyed to an older snapshot, or while a
  re-key or an Import is running.** Reason: a tombstone ("back to the seed") converts as
  "leave it as the seed has it", and after a rebuild the seed already holds the published
  value the revert meant to remove — publishing would silently re-publish it and mark the
  revert published. The hold lifts when the load-time re-key succeeds.
- **The load-time re-key** checks for unpublished reverts/detaches before any request,
  asks GitHub's compare anonymously (never with the token), treats a 404 for a sha as "not
  in history", re-reads the store after its last network wait and writes nothing while a
  publish is committing, and never redraws under the caret. A refusal shows a notice with
  the page's own advice and a **Discard those older-snapshot changes** action (per
  document, after a confirm listing unpublished/published counts and, for the
  not-in-history case, advising Download changes first). Only stale documents can be
  discarded; `store.drop` is the one extra write path, browser mode only.
- **Import** re-keys older-snapshot documents by the same rule before merging (all or none;
  current-snapshot documents still merge), never merges into a local document that is
  itself older, and refuses while a publish is committing.
- **The repo-file GET is uncached** (`cache: 'no-store'`); GitHub caches API answers for
  60 s and the PUT URL does not invalidate the GET URL.
- **A dialog closed by any path settles its promise** (Escape, backdrop, receptor switch,
  another modal) so Publish can never stay disabled.
- **The receipt watches the rebuild.** `scripts/publish.js` writes `data/build.json`
  (`{commit, builtAt}`) and its fetch shim asks for data with `cache: 'no-store'`, so a
  reload shows the current text. After a publish the receipt reads
  `published <sha7> · site rebuilding…`, polls `build.json` every 15 s (24 tries), and
  turns into `live on the site <sha7> · open <Label> ↗` (link to the edited Archive entry,
  or the atlas root) when the site's commit is the publish or a descendant of it (compare,
  anonymous, one call per distinct build commit). A receipt still unconfirmed is checked
  once at each load. The publish date is no longer shown in the banner.
- **Stale-seed refusal reports every differing key** of the published comparison (not an
  intersection with the snapshot comparison), exactly as `desk:pull` does.
