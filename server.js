import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { openDb } from './db/index.js';
import { migrate } from './scripts/migrate.js';
import { apiRoutes } from './lib/router.js';
import { publish } from './scripts/publish.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

// How long to wait after the last write before re-publishing, so a burst of
// quick edits (e.g. several fields saved in succession) collapses into one
// snapshot instead of one per request.
const AUTO_PUBLISH_DEBOUNCE_MS = 400;

export function createServer(dbPath, { seed = false, autoPublish = false, publishDir } = {}) {
  const db = openDb(dbPath);
  if (seed) migrate(db);
  const routes = apiRoutes(db);
  const distDir = publishDir || join(HERE, 'dist');

  // Auto-publish: a Desk save (any non-GET route) schedules a snapshot refresh a
  // moment later, so dist/ always reflects the database without a manual step.
  // Failures are logged, never thrown — a bad publish must not break editing.
  let publishTimer = null;
  function schedulePublish() {
    if (!autoPublish) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publish(db, distDir)
        .then(() => console.log(`auto-publish: dist/ refreshed (${new Date().toISOString()})`))
        .catch(e => console.error('auto-publish failed:', e));
    }, AUTO_PUBLISH_DEBOUNCE_MS);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m && r.method === req.method) {
        // A handler that throws (e.g. a DB error) must become a 500, not a
        // silent hang — Node won't auto-respond to a rejected request promise.
        try {
          await r.handler(req, res, m, url);
          if (r.method !== 'GET') schedulePublish();
          return;
        } catch (e) {
          console.error('handler error:', e);
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'internal' }));
          }
          return;
        }
      }
    }

    // Static files from public/. '/' maps to the atlas shell BEFORE normalize,
    // because on Windows normalize('/') is '\'.
    const pathname = url.pathname === '/' ? '/the-receptor-atlas.html' : url.pathname;
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, safe);
    // The real traversal guarantee: the resolved path must stay inside PUBLIC.
    // (URL normalization + the regex above help, but this containment check is
    // what actually holds if those are ever refactored.)
    if (file !== PUBLIC && !file.startsWith(PUBLIC + sep)) return notFound(res);

    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      // A missing file (ENOENT) or a directory path (EISDIR) is a normal 404.
      // Anything else is a real I/O fault worth surfacing to whoever runs this.
      if (e.code !== 'ENOENT' && e.code !== 'EISDIR') console.error('static serve error:', e);
      notFound(res);
    }
  });

  // Release the DB handle when the server closes so it doesn't hold the file open
  // (harmless for an in-memory DB; on Windows a file-backed DB would otherwise stay
  // locked after close). Fires before the close callback registered by the caller.
  server.on('close', () => { clearTimeout(publishTimer); db.close(); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3000;
  // Bind to loopback by default so a personal, no-auth tool isn't exposed to the
  // local network. Set HOST=0.0.0.0 explicitly to opt into LAN access.
  const HOST = process.env.HOST || '127.0.0.1';
  // Auto-publish is on by default for the real app — every Desk save keeps dist/
  // current with no manual `npm run snapshot` step. Set NO_AUTO_PUBLISH=1 to
  // disable (e.g. if you only ever publish manually).
  const autoPublish = process.env.NO_AUTO_PUBLISH !== '1';
  createServer(undefined, { autoPublish }).listen(PORT, HOST, () => {
    console.log(`Atlas app: http://localhost:${PORT}`);
    if (autoPublish) console.log('auto-publish: on (dist/ refreshes after each save; set NO_AUTO_PUBLISH=1 to disable)');
  });
}
