import { openDb } from '../db/index.js';
import { RX, HALLS } from './seed-data.js';
import { pathToFileURL } from 'node:url';

export function migrate(db) {
  const tx = db.transaction(() => {
    const rcpt = db.prepare('INSERT OR REPLACE INTO receptors (id,label,system,hall,sort_order) VALUES (?,?,?,?,?)');
    const vol  = db.prepare('INSERT OR IGNORE INTO receptor_volumes (receptor_id,volume) VALUES (?,?)');
    const src  = db.prepare('INSERT INTO sources (authors,year,title,journal,pmid,doi) VALUES (?,?,?,?,?,?)');
    const link = db.prepare('INSERT OR REPLACE INTO receptor_sources (receptor_id,source_id,status) VALUES (?,?,?)');
    const st   = db.prepare('INSERT INTO stahl_loci (receptor_id,chapter) VALUES (?,?)');
    const clm  = db.prepare('INSERT OR REPLACE INTO claims (receptor_id,text) VALUES (?,?)');
    const qz   = db.prepare('INSERT OR REPLACE INTO quizzes (receptor_id,prompt) VALUES (?,?)');
    const rev  = db.prepare('INSERT OR IGNORE INTO review_state (receptor_id) VALUES (?)');

    RX.forEach((r, i) => {
      rcpt.run(r.id, r.nm, r.hall, r.hall, i);
      (r.vols || []).forEach(v => vol.run(r.id, v.toLowerCase()));
      (r.stahl || []).forEach(arr => st.run(r.id, arr[0]));
      if (r.claim) clm.run(r.id, r.claim);
      if (r.quiz)  qz.run(r.id, r.quiz);
      rev.run(r.id);
      let sourceId = null;
      if (r.ref) {
        const e = r.ref;
        sourceId = src.run(e.a, e.y, e.t, e.journal ?? null, e.pmid, e.doi).lastInsertRowid;
      }
      link.run(r.id, sourceId, r.cs || 'needs-source');
    });
  });
  tx();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = openDb();
  migrate(db);
  console.log('migrated', db.prepare('SELECT COUNT(*) c FROM receptors').get().c, 'receptors');
}
