// Preview the built snapshot exactly as a static host would serve it — no API, no
// database, just the files in dist/. Run `npm run snapshot` first, then
// `npm run preview` and open the printed URL. This is a dev convenience only; it is
// never part of what gets deployed.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const PORT = process.env.PORT || 4180;
const HOST = process.env.HOST || '127.0.0.1';

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  // Same containment guarantee as the app server: the resolved path must stay
  // inside dist/, whatever the request tries.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(DIST, safe);
  if (file !== DIST && !file.startsWith(DIST + sep)) { res.writeHead(404); return res.end('not found'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found — run `npm run snapshot` to build dist/');
  }
}).listen(PORT, HOST, () => console.log(`Snapshot preview: http://localhost:${PORT}`));
