import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import handler from './netlify/functions/api.mjs';

const root = process.cwd();
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

async function serveStatic(res, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = resolve(root, relativePath);

  try {
    const content = await readFile(filePath);
    const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch {
    try {
      const content = await readFile(resolve(root, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const response = await handler({
        path: url.pathname,
        rawUrl: `http://localhost${url.pathname}${url.search}`,
        httpMethod: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      const body = await response.text();
      res.writeHead(response.status || 200, Object.fromEntries(response.headers.entries()));
      res.end(body);
      return;
    }

    await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

server.listen(8080, () => {
  console.log('App running at http://localhost:8080');
});
