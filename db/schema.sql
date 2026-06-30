CREATE TABLE IF NOT EXISTS receptors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  system TEXT,
  hall TEXT,
  sort_order INTEGER,
  stahl_note TEXT          -- free-text note about the Stahl reading (RX.note)
);
CREATE TABLE IF NOT EXISTS receptor_volumes (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  PRIMARY KEY (receptor_id, volume)
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  authors TEXT, year INTEGER, title TEXT, journal TEXT,
  pmid TEXT, doi TEXT, url TEXT, notes TEXT
);
-- One citation slot per receptor: PRIMARY KEY (receptor_id) is intentional and
-- mirrors the original Conservator's Desk model, where each receptor has a single
-- `ref` + single citation `status`. The slot may be empty (source_id NULL,
-- status 'needs-source') or filled. The `sources` library is still shared/reusable
-- across receptors. If multiple citations per receptor are ever needed, change the
-- key to PRIMARY KEY (receptor_id, source_id).
CREATE TABLE IF NOT EXISTS receptor_sources (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  source_id INTEGER REFERENCES sources(id),
  status TEXT NOT NULL DEFAULT 'needs-source',
  correction_note TEXT,    -- citation-correction provenance (RX.note2), e.g. wrong-PMID fixes
  search_query TEXT,       -- PubMed search recipe for needs-source receptors (RX.search)
  PRIMARY KEY (receptor_id)
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
CREATE TABLE IF NOT EXISTS stahl_loci (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  chapter INTEGER NOT NULL
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
CREATE TABLE IF NOT EXISTS section_activity (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  last_edited_at TEXT,
  last_reviewed_at TEXT,
  PRIMARY KEY (receptor_id, volume)
);
