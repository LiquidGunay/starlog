import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { pathToFileURL } from 'node:url';
import { createNewspaperServer, createReflectionStore, defaultStoreFile, packageRoot } from './newspaper.mjs';

export async function startHttpServer({ port = 8789, storeFile = defaultStoreFile } = {}) {
  const store = createReflectionStore(storeFile);
  const hostHtml = await readFile(join(packageRoot, 'server', 'host.html'), 'utf8');
  const hostBundle = await build({ entryPoints: [join(packageRoot, 'server', 'host-client.js')], bundle: true, platform: 'browser', format: 'esm', target: 'es2022', write: false, minify: true, legalComments: 'inline' });
  const http = createServer(async (request, response) => {
    const host = request.headers.host;
    const localHosts = ['127.0.0.1', 'localhost'];
    const expectedHosts = localHosts.map(name => `${name}:${http.address().port}`);
    const expectedOrigins = expectedHosts.map(name => `http://${name}`);
    if (!expectedHosts.includes(host) || (request.headers.origin && !expectedOrigins.includes(request.headers.origin))) {
      response.writeHead(403).end('This prototype accepts local requests only.'); return;
    }
    if (request.method === 'GET' && request.url === '/host') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(hostHtml); return;
    }
    if (request.method === 'GET' && request.url === '/host-client.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(hostBundle.outputFiles[0].text); return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end('Use /mcp.'); return; }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let server;
    try {
      server = await createNewspaperServer({ store });
      response.once('close', () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error('Prototype request failed:', error.message);
      if (!response.headersSent) response.writeHead(500).end('Prototype request failed.');
      else response.end();
      await transport.close();
      await server?.close();
    }
  });
  await new Promise((resolve, reject) => { http.once('error', reject); http.listen(port, '127.0.0.1', resolve); });
  return http;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const storeFile = process.env.STARLOG_PROTOTYPE_STORE || defaultStoreFile;
  if (process.argv.includes('--http')) {
    const port = Number(process.env.STARLOG_PROTOTYPE_PORT || 8789);
    const server = await startHttpServer({ port, storeFile });
    console.error(`Starlog prototype MCP: http://127.0.0.1:${server.address().port}/mcp`);
  } else {
    const server = await createNewspaperServer({ store: createReflectionStore(storeFile) });
    await server.connect(new StdioServerTransport());
  }
}
