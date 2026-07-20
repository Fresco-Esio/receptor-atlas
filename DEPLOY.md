# Putting the atlas online

The public atlas can be published to GitHub Pages. The Conservator's Desk cannot, and
that is intentional — the Desk *saves* things (review marks, citations, notes), which
needs the server and database behind it. A static host can only serve files.

So: **the atlas goes online, the Desk stays on your machine.**

Everything below is already prepared. What's left needs your GitHub login, which is why
it isn't done yet.

## Before you start: two decisions

**1. Public or private?**
GitHub Pages on a *private* repo requires a paid plan (Pro or Team). On a free account
the repo must be **public**, and public means the whole project is visible — including
`docs/`, the unfinished `the-threshold*.html` pages, and the stray
`public/C：Users…drug_mapping.txt` file. Worth a tidy-up first if you go public.

**2. Are you comfortable republishing the data?**
The affinity numbers come from the NIMH PDSP Kᵢ Database and the action labels from
IUPHAR/BPS. The atlas already credits both on the page, which is the right instinct, but
publishing a derived dataset publicly can carry conditions. Worth two minutes on each
database's terms before you make it public.

## The three commands

```bash
gh auth login                                   # opens your browser, one time only
gh repo create atlas-app --private --source=. --remote=origin --push
```

Use `--public` instead of `--private` if you've decided that.

Then turn Pages on: **repo → Settings → Pages → Source: "GitHub Actions"**.

That's it. The workflow at `.github/workflows/pages.yml` takes over from there.

## What happens on every push

1. Installs dependencies
2. Rebuilds the database from the committed seed data
3. Freezes the atlas into a standalone site (`npm run snapshot`)
4. Publishes it

Your site lands at `https://<your-username>.github.io/atlas-app/`.

Note the database is **rebuilt on the runner**, not uploaded. `db/atlas.db` is
deliberately not in the repo, so the published atlas always reflects what's committed —
and your personal review marks in the Desk never leave your machine.

## Checking it before you push

```bash
npm run snapshot     # builds dist/
npm run preview      # serves dist/ locally so you can click through it
```

What you see there is exactly what gets published.

## Updating the published atlas later

Push to `main` and it republishes itself. If you change the affinity numbers, remember
the extra step (see `scripts/sourcing/README.md`):

```bash
node scripts/sourcing/3-build.mjs --write
rm db/atlas.db db/atlas.db-wal db/atlas.db-shm && npm run migrate
git commit -am "refresh affinities" && git push
```

The database rebuild is only needed locally, to see the change before you commit — the
runner does its own.
