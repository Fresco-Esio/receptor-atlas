CREATE TABLE IF NOT EXISTS receptors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  system TEXT,
  hall TEXT,
  sort_order INTEGER,
  stahl_note TEXT,         -- free-text note about the Stahl reading (RX.note)
  search_query TEXT        -- PubMed search recipe to use while this receptor has no sources yet (RX.search)
);
CREATE TABLE IF NOT EXISTS receptor_volumes (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  PRIMARY KEY (receptor_id, volume)
);
-- `kind` distinguishes a peer-reviewed article from a textbook locus (e.g. a Stahl
-- chapter) — both are just sources now (Citation/verification redesign): nothing
-- about a book source is modeled specially anywhere else in the schema.
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'article',   -- 'article' | 'book'
  authors TEXT, year INTEGER, title TEXT, journal TEXT,
  pmid TEXT, doi TEXT, url TEXT, notes TEXT
);
-- A receptor can cite any number of sources (Citation/verification redesign):
-- composite PK lets the same source be attached to a receptor only once, but a
-- receptor may have many attached sources, each independently verified
-- (`status`). Exactly one attached source is expected to carry is_primary=1 —
-- that's what /api/atlas/:volume surfaces, preserving the old single-citation
-- behavior for the atlas volumes. A receptor with zero rows here has no sources
-- yet ("needs-source"); there is no longer a placeholder row for that state.
CREATE TABLE IF NOT EXISTS receptor_sources (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  source_id INTEGER NOT NULL REFERENCES sources(id),
  status TEXT NOT NULL DEFAULT 'provided',
  is_primary INTEGER NOT NULL DEFAULT 0,
  correction_note TEXT,    -- citation-correction provenance (RX.note2), e.g. wrong-PMID fixes
  PRIMARY KEY (receptor_id, source_id)
);
-- Cross-volume id reconciliation (Task 12 discovery): each atlas volume names the
-- same receptor differently and none match the DB id (e.g. DB `m1` is `muscarinic_m1`
-- in the Cabinet and `m1` in the Ledger). This table maps a volume's own id (alias)
-- back to the canonical receptor_id so a volume page can fetch /api/atlas/:volume and
-- match each row by the id it already uses. PRIMARY KEY (volume, alias): an alias is
-- unique within a volume, but the same alias string may recur across volumes.
CREATE TABLE IF NOT EXISTS receptor_aliases (
  volume TEXT NOT NULL,
  alias TEXT NOT NULL,
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  PRIMARY KEY (volume, alias)
);
CREATE TABLE IF NOT EXISTS claims (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  text TEXT
);
CREATE TABLE IF NOT EXISTS quizzes (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  prompt TEXT
);
CREATE TABLE IF NOT EXISTS review_state (
  receptor_id TEXT PRIMARY KEY REFERENCES receptors(id),
  mechanism INTEGER DEFAULT 0,
  affinity INTEGER DEFAULT 0,
  clinical INTEGER DEFAULT 0,
  citation INTEGER DEFAULT 0,
  mastery INTEGER DEFAULT 0,
  note TEXT DEFAULT ''
);
-- Structured data extracted from the volume files (Task 14).
-- binding_values: the Cabinet's agent×target affinity matrix (AFF_AGENTS). One row
-- per (agent, target). target_alias is the Cabinet's own target id (= the cabinet
-- alias), resolved to receptor_id via receptor_aliases.
CREATE TABLE IF NOT EXISTS binding_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receptor_id TEXT REFERENCES receptors(id),
  target_alias TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_group TEXT,
  cid INTEGER,                 -- PubChem CID
  ki REAL,                     -- representative Ki in nM
  ki_text TEXT,                -- reported range, e.g. '0.4-1.2 nM'
  act TEXT,                    -- action code: ag/an/pa/ri/…
  act_full TEXT,
  src TEXT,
  note TEXT
);
-- Binding-affinity provenance (binding-affinity provenance feature). Keyed on the
-- STABLE (agent_name, target_alias) pair, NOT binding_values.id — that id only holds
-- until the next rebuild (delete db/atlas.db + re-migrate re-inserts every row with a
-- fresh id), whereas the pair is reproduced identically from the volume HTML every time.
-- binding_sources is the citation edge (a binding may cite any number of library
-- sources); status mirrors receptor_sources ('verified'|'provided'|'conflicting').
CREATE TABLE IF NOT EXISTS binding_sources (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  source_id    INTEGER NOT NULL REFERENCES sources(id),
  status       TEXT NOT NULL DEFAULT 'provided',
  PRIMARY KEY (agent_name, target_alias, source_id)
);
-- The per-number transcription check, separate from citation soundness: does OUR Ki
-- match what the cited source says? A binding with no row here is implicitly 'unchecked'.
CREATE TABLE IF NOT EXISTS binding_review (
  agent_name   TEXT NOT NULL,
  target_alias TEXT NOT NULL,
  value_status TEXT NOT NULL DEFAULT 'unchecked',  -- 'unchecked' | 'confirmed' | 'mismatch'
  PRIMARY KEY (agent_name, target_alias)
);
-- Stable tag → source_id map so the seed migration is idempotent even after a curator
-- backfills a migrated source's title/authors: the mapping (not the source's mutable
-- fields) is what dedupes, so re-runs never create a duplicate sources row.
CREATE TABLE IF NOT EXISTS binding_source_tags (
  tag       TEXT PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id)
);
-- clinical_rows: the Ledger's per-receptor clinical entry (DATA). List-valued
-- fields (over/under/agonists/antagonists) are stored as JSON text.
CREATE TABLE IF NOT EXISTS clinical_rows (
  no INTEGER PRIMARY KEY,      -- Ledger row number
  receptor_id TEXT REFERENCES receptors(id),
  sys TEXT,
  name TEXT,
  cls TEXT,
  baseline TEXT,
  mech TEXT,
  over_json TEXT,
  under_json TEXT,
  stahl TEXT,
  agonists_json TEXT,
  antagonists_json TEXT
);
-- Archive narrative prose (Archive content editing). One row per receptor that has an
-- Archive entry. List fields (body paragraphs, tags) stored as JSON text.
CREATE TABLE IF NOT EXISTS archive_entries (
  receptor_id    TEXT PRIMARY KEY REFERENCES receptors(id),
  abstract       TEXT,
  presentation   TEXT,
  effect         TEXT,
  receptor_class TEXT,
  ligand         TEXT,
  figure_caption TEXT,
  body_json      TEXT,
  tags_json      TEXT
);
CREATE TABLE IF NOT EXISTS section_activity (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  last_edited_at TEXT,
  last_reviewed_at TEXT,
  PRIMARY KEY (receptor_id, volume)
);
