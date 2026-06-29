CREATE TABLE IF NOT EXISTS receptors (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  system TEXT,
  hall TEXT,
  sort_order INTEGER
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
  PRIMARY KEY (receptor_id)
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
CREATE TABLE IF NOT EXISTS section_activity (
  receptor_id TEXT NOT NULL REFERENCES receptors(id),
  volume TEXT NOT NULL,
  last_edited_at TEXT,
  last_reviewed_at TEXT,
  PRIMARY KEY (receptor_id, volume)
);
