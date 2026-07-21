import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeQuery } from './14_queryRouter.js';
import { closeConnections } from './2_config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/') {
      const htmlPath = path.join(__dirname, 'public', 'index.html');
      fs.readFile(htmlPath, 'utf8', (err, html) => {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to load UI' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/query') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', async () => {
        try {
          const { message } = JSON.parse(body || '{}');
          if (typeof message !== 'string' || message.trim() === '') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Message is required.' }));
            return;
          }

          const answer = await processQuery(message.trim());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ reply: answer }));
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: error.message || 'Internal server error' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return server;
}

async function processQuery(query, routerFn = routeQuery) {
  return routerFn(query);
}

const server = createServer();

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`🚀 Movie assistant running at http://localhost:${port}`);
  });

  process.on('SIGINT', async () => {
    await closeConnections();
    server.close(() => process.exit(0));
  });
}

export { createServer, processQuery };
