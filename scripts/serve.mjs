import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { extname, resolve, sep } from 'node:path';

const { values } = parseArgs({ options: { host: { type: 'string' }, port: { type: 'string' }, strictPort: { type: 'boolean' } } });
const root = resolve('dist');
const mount = '/Mythwrought-dev-hq/';
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp' };

createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    const name = path.startsWith(mount) ? path.slice(mount.length) : path.slice(1);
    const file = resolve(root, decodeURIComponent(name || 'index.html'));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Missing file');
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404).end('File unavailable');
  }
}).listen(Number(values.port ?? process.env.PORT ?? 3000), values.host ?? '127.0.0.1');
