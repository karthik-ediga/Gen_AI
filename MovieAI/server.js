//Node's built-in HTTP module. Used to create the web server.
//Express internally uses Node's http module.You use it when you need the actual server object.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeQuery } from './14_queryRouter.js';
import { closeConnections } from './2_config.js';

//ES modules, __dirname is not automatically available
const __filename = fileURLToPath(import.meta.url);// __filename = C:\project\server.js
const __dirname = path.dirname(__filename); //__dirname  = C:\project

//ES Modules(Ecosystem) are the official, standardized system 
// for organizing and sharing JavaScript code across files.(export,import)

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

//ROUTE 1: SERVE THE FRzONTEND AND STATIC ASSETS

    if (req.method === 'GET') {
      if (url.pathname === '/') {
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

      if (url.pathname !== '/api/query') {
        const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
        const safePath = requestedPath.replace(/^\/+/, '').replace(/\/+/g, '/');
        const filePath = path.join(__dirname, 'public', safePath);
        const publicRoot = path.resolve(__dirname, 'public');
        const resolvedPath = path.resolve(filePath);

        if (!resolvedPath.startsWith(publicRoot)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden' }));
          return;
        }

        fs.readFile(resolvedPath, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not found' }));
            return;
          }

          const ext = path.extname(resolvedPath).toLowerCase();
          const contentType = {
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon',
          }[ext] || 'application/octet-stream';

          res.writeHead(200, { 'Content-Type': contentType });
          res.end(data);
        });
        return;
      }
    }

//ROUTE 2:API QUERY ENDPOINT

    if (req.method === 'POST' && url.pathname === '/api/query') {
      let body = '';
      //listen for incoming data streams
      req.on('data', (chunk) => {
        body += chunk;
      });
      //complete handler
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
//This checks whether the file was directly executed.(node server.js)
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
