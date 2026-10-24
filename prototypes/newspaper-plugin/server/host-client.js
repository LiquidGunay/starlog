import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AppBridge, PostMessageTransport, getToolUiResourceUri } from '@modelcontextprotocol/ext-apps/app-bridge';

const status = document.getElementById('host-status');
const surface = document.getElementById('host-surface');
const notes = document.getElementById('saved-notes');
const layout = document.getElementById('layout');
const client = new Client({ name: 'Starlog local browser test host', version: '0.1.0' }, { capabilities: {} });
let bridge;
async function listNotes() {
  const result = await client.callTool({ name: 'list_reflections', arguments: {} });
  if (result.isError) throw new Error('Could not read prototype notes.');
  const rows = result.structuredContent.reflections;
  notes.replaceChildren();
  for (const note of rows) {
    const item = document.createElement('li');
    item.textContent = `${note.id} · ${note.articleId} · ${note.text}`;
    notes.append(item);
  }
  if (!rows.length) notes.textContent = 'No notes explicitly saved yet.';
  return rows;
}
async function showEdition() {
  status.textContent = 'Connecting the real MCP App…';
  if (bridge) await bridge.close();
  const tools = await client.listTools();
  const tool = tools.tools.find(item => item.name === 'show_edition');
  const result = await client.callTool({ name: 'show_edition', arguments: { layout: layout.value } });
  const resource = await client.readResource({ uri: getToolUiResourceUri(tool) });
  const frame = document.createElement('iframe');
  frame.title = 'Starlog MCP newspaper';
  frame.setAttribute('sandbox','allow-scripts allow-popups');
  frame.style.cssText = 'border:0;width:100%;height:800px;display:block;';
  surface.replaceChildren(frame);
  bridge = new AppBridge(client, { name: 'Starlog local browser test host', version: '0.1.0' }, { serverTools: {}, serverResources: {} }, { hostContext: { theme: 'light', displayMode: 'inline' } });
  bridge.onsizechange = ({ height }) => { if (height > 0) frame.style.height = `${Math.ceil(height)}px`; };
  bridge.onmessage = async () => {
    status.textContent = 'Follow-up reached the local host. No model is connected here; use the in-chat preview for discussion.';
    return { isError: true };
  };
  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: { layout: layout.value } });
    await bridge.sendToolResult(result);
    status.textContent = 'MCP App connected · real local saves enabled · no model connection';
  };
  bridge.onerror = error => { status.textContent = `Host connection error: ${error.message}`; };
  await bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'">`;
  frame.srcdoc = resource.contents[0].text.replace('<head>', '<head>' + csp);
}
async function guarded(action) {
  try { await action(); }
  catch (error) { status.textContent = `Local host error: ${error.message}`; }
}
document.getElementById('show-notes').addEventListener('click', () => guarded(listNotes));
layout.addEventListener('change', () => guarded(showEdition));
document.getElementById('width').addEventListener('change', event => { surface.style.maxWidth = event.target.value; });
await guarded(async () => {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.href)));
  await showEdition();
});
