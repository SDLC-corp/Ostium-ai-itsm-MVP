#!/usr/bin/env node
// Ostium ITSM MVP — zero-dependency Node.js server (API + web console).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ostium } from './src/service.js';
import { createApiHandler } from './src/api.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = process.env.OSTIUM_DATA || path.join(root, 'data', 'db.json');

const app = new Ostium({ file: DATA_FILE });
const api = createApiHandler(app);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain', '.yaml': 'text/yaml', '.md': 'text/markdown' };
const PUBLIC = path.join(root, 'public');
// Files at the repo root that are useful to serve for crawlers and AI agents.
const ROOT_FILES = { '/llms.txt': 'llms.txt', '/openapi.yaml': 'docs/openapi.yaml' };

function serveStatic(url, res) {
  let file;
  if (ROOT_FILES[url.pathname]) file = path.join(root, ROOT_FILES[url.pathname]);
  else {
    let p;
    try { p = decodeURIComponent(url.pathname); } catch { p = '/'; }
    file = path.resolve(PUBLIC, '.' + path.posix.normalize(p));
    // Only files inside public/ (plus the allow-listed root files) are ever served.
    if (!file.startsWith(PUBLIC + path.sep)) file = path.join(PUBLIC, 'index.html');
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'content-type': `${TYPES[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  serveStatic(url, res);
});

server.listen(PORT, () => {
  console.log(`\n  Ostium ITSM MVP running → http://localhost:${PORT}`);
  console.log(`  REST API              → http://localhost:${PORT}/api/v2/health`);
  console.log(`  Data file             → ${DATA_FILE}\n`);
});
