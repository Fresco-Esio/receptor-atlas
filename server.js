import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { openDb } from './db/index.js';
import { migrate } from './scripts/migrate.js';
import { apiRoutes } from './lib/router.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, 'public');
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json' };

export function createServer(dbPath, { seed = false } = {}) {
  const db = openDb(dbPath);
  if (seed) migrate(db);
  const routes = apiRoutes(db);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    for (const r of routes) {
      const m = url.pathname.match(r.pattern);
      if (m && r.method === req.method) return r.handler(req, res, m, url);
    }
    const pathname = url.pathname === '/' ? '/the-receptor-atlas.html' : url.pathname;
    const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, safe);
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const PORT = process.env.PORT || 3000;
  createServer().listen(PORT, () => console.log(`Atlas app: http://localhost:${PORT}`));
}
