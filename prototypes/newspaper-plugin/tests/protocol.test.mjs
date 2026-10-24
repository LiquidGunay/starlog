import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { packageRoot } from '../server/newspaper.mjs';
import { startHttpServer } from '../server/main.mjs';

const edition = JSON.parse(await readFile(join(packageRoot, 'data', 'edition.json'), 'utf8'));
const scratch = join(packageRoot, '.localdata', 'contract-tests');
await mkdir(scratch, { recursive: true });
const directory = await mkdtemp(join(scratch, 'run-'));
const storeFile = join(directory, 'PROTOTYPE-reflections.json');
async function connectStdio() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(packageRoot, 'server', 'main.mjs')],
    env: { ...process.env, STARLOG_PROTOTYPE_STORE: storeFile },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'Starlog contract test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}
const payload = { editionId: edition.id, articleId: edition.stories[0].id, text: 'A note explicitly saved by the protocol test.', requestId: 'test-note-one' };

test('STDIO initializes, advertises tools/UI, serves the actual built component and validates saves', async () => {
  const client = await connectStdio();
  try {
    assert.equal(client.getServerVersion().name, 'Starlog newspaper prototype');
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(item => item.name).sort(), ['get_edition','list_reflections','save_reflection','show_edition']);
    const renderTool = tools.find(item => item.name === 'show_edition');
    const uri = renderTool._meta.ui.resourceUri;
    assert.match(uri, /^ui:\/\/starlog\/newspaper\/[a-f0-9]{16}\.html$/);
    assert.equal(tools.find(item => item.name === 'get_edition')._meta?.ui?.resourceUri, undefined);
    assert.equal(tools.find(item => item.name === 'save_reflection').annotations.readOnlyHint, false);
    const resources = await client.listResources();
    assert.ok(resources.resources.some(item => item.uri === uri));
    const resource = await client.readResource({ uri });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.equal(resource.contents[0].text, await readFile(join(packageRoot,'dist','plugin.html'),'utf8'));
    assert.match(resource.contents[0].text, /starlog-plugin-root/);
    const data = await client.callTool({ name: 'get_edition', arguments: {} });
    assert.equal(data.structuredContent.edition.id, edition.id);
    const shown = await client.callTool({ name: 'show_edition', arguments: { layout: 'broadsheet' } });
    assert.equal(shown.structuredContent.layout, 'broadsheet');
    const saved = await client.callTool({ name: 'save_reflection', arguments: payload });
    assert.ok(!saved.isError);
    assert.equal(saved.structuredContent.duplicate, false);
    const again = await client.callTool({ name: 'save_reflection', arguments: payload });
    assert.equal(again.structuredContent.duplicate, true);
    assert.equal(again.structuredContent.reflection.id, saved.structuredContent.reflection.id);
    const mismatch = await client.callTool({ name: 'save_reflection', arguments: { ...payload, text: 'Changed note with reused key.' } });
    assert.equal(mismatch.isError, true);
    const unknown = await client.callTool({ name: 'save_reflection', arguments: { ...payload, articleId: 'missing-story', requestId: 'test-invalid-story' } });
    assert.equal(unknown.isError, true);
    const blank = await client.callTool({ name: 'save_reflection', arguments: { ...payload, text: '  ', requestId: 'test-invalid-empty' } });
    assert.equal(blank.isError, true);
    const listed = await client.callTool({ name: 'list_reflections', arguments: {} });
    assert.equal(listed.structuredContent.reflections.length, 1);
  } finally { await client.close(); }
});

test('a new STDIO process reads the saved note; opening a reader did not create more notes', async () => {
  const client = await connectStdio();
  try {
    const result = await client.callTool({ name: 'list_reflections', arguments: {} });
    assert.equal(result.structuredContent.reflections.length, 1);
    assert.equal(result.structuredContent.reflections[0].text, payload.text);
  } finally { await client.close(); }
});

test('loopback Streamable HTTP supports MCP and rejects foreign browser origins', async () => {
  const http = await startHttpServer({ port: 0, storeFile: join(directory, 'http-reflections.json') });
  const url = new URL(`http://127.0.0.1:${http.address().port}/mcp`);
  const client = new Client({ name: 'Starlog HTTP test', version: '0.1.0' }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(url));
    const data = await client.callTool({ name: 'get_edition', arguments: {} });
    assert.equal(data.structuredContent.edition.id, edition.id);
    const [first, second] = await Promise.all([
      client.callTool({ name: 'save_reflection', arguments: payload }),
      client.callTool({ name: 'save_reflection', arguments: payload }),
    ]);
    assert.equal(first.structuredContent.reflection.id, second.structuredContent.reflection.id);
    assert.deepEqual([first.structuredContent.duplicate,second.structuredContent.duplicate].sort(), [false,true]);
    const rejected = await fetch(url, { method: 'POST', headers: { Origin: 'https://example.com' }, body: '{}' });
    assert.equal(rejected.status, 403);
  } finally {
    await client.close();
    http.closeAllConnections();
    await new Promise(resolve => http.close(resolve));
  }
});
