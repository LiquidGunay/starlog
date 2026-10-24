import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const defaultStoreFile = join(packageRoot, '.localdata', 'PROTOTYPE-newspaper', 'reflections.json');
const safeId = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const saveSchema = z.object({
  editionId: safeId,
  articleId: safeId,
  text: z.string().trim().min(1).max(10000),
  requestId: safeId,
}).strict();
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const result = (data, summary) => ({ structuredContent: data, content: [{ type: 'text', text: summary ?? JSON.stringify(data) }] });

// One local process owns this scratch file. There is intentionally no account,
// multi-process locking, remote sync, journal ingestion or production database.
export function createReflectionStore(file = defaultStoreFile) {
  let queue = Promise.resolve();
  async function load() {
    try {
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (value.version !== 1 || !Array.isArray(value.reflections)) throw new Error('Unsupported prototype note file.');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, reflections: [] };
      throw error;
    }
  }
  function serialize(operation) {
    const work = queue.then(operation);
    queue = work.catch(() => {});
    return work;
  }
  return {
    list: () => serialize(async () => (await load()).reflections),
    save: (input) => serialize(async () => {
      const value = await load();
      const previous = value.reflections.find(item => item.requestId === input.requestId);
      if (previous) {
        if (previous.editionId !== input.editionId || previous.articleId !== input.articleId || previous.text !== input.text) {
          throw new Error('This requestId was already used for different note content. Use a new requestId for an edited note.');
        }
        return { reflection: previous, duplicate: true };
      }
      const reflection = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
      value.reflections.push(reflection);
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
      await rename(temporary, file);
      return { reflection, duplicate: false };
    }),
  };
}

export async function createNewspaperServer({ store = createReflectionStore(), editionPath = join(packageRoot, 'data', 'edition.json'), htmlPath = join(packageRoot, 'dist', 'plugin.html') } = {}) {
  const edition = JSON.parse(await readFile(editionPath, 'utf8'));
  const html = await readFile(htmlPath, 'utf8');
  if (!edition.id || !Array.isArray(edition.stories)) throw new Error('Edition must contain id and stories.');
  const templateUri = `ui://starlog/newspaper/${createHash('sha256').update(html).digest('hex').slice(0,16)}.html`;
  const server = new McpServer({ name: 'Starlog newspaper prototype', version: '0.1.0' });
  const uiMeta = { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } };
  registerAppResource(server, 'Starlog newspaper', templateUri, { description: 'Reusable newspaper reader with optional questions.', _meta: { ui: uiMeta } }, async () => ({
    contents: [{ uri: templateUri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: uiMeta } }],
  }));
  server.registerTool('get_edition', {
    title: 'Read the sample edition',
    description: 'Return the fixed research design sample, including citations. It is not a live news feed or personalized memory retrieval.',
    inputSchema: {}, annotations: readOnly,
  }, async () => result({ edition, layout: 'reader' }));
  registerAppTool(server, 'show_edition', {
    title: 'Show Starlog newspaper',
    description: 'Display the research sample in an interactive newspaper layout. Use get_edition first to inspect its sources and sample scope.',
    inputSchema: { layout: z.enum(['broadsheet', 'magazine', 'reader']).default('reader') },
    annotations: readOnly,
    _meta: { ui: { resourceUri: templateUri }, 'openai/outputTemplate': templateUri },
  }, async ({ layout }) => result({ edition, layout }, `Showing ${edition.title} in the ${layout} layout. This is a research design sample, not today's news.`));
  server.registerTool('save_reflection', {
    title: 'Save an explicit thinking note',
    description: 'Only after the user explicitly chooses to save: store their text in this local prototype. Never save quiz answers, infer mastery, or create review commitments automatically. Reuse requestId only to retry identical content.',
    inputSchema: saveSchema,
    annotations: { ...readOnly, readOnlyHint: false },
    _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true },
  }, async (input) => {
    if (input.editionId !== edition.id || !edition.stories.some(story => story.id === input.articleId)) {
      throw new Error('Unknown edition or article; note was not saved.');
    }
    const saved = await store.save(input);
    return result(saved, `${saved.duplicate ? 'Already saved' : 'Saved'} locally in the prototype: ${saved.reflection.id}. This is not synced to Drive.`);
  });
  server.registerTool('list_reflections', {
    title: 'Read saved prototype notes',
    description: 'Return explicitly saved notes from this local prototype; no access to journals, Drive or ChatGPT memory.',
    inputSchema: {}, annotations: readOnly,
    _meta: { ui: { visibility: ['model', 'app'] }, 'openai/widgetAccessible': true },
  }, async () => result({ reflections: await store.list() }));
  return server;
}
