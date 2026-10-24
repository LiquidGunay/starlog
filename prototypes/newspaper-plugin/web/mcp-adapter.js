import { App } from '@modelcontextprotocol/ext-apps';

const root = document.getElementById('starlog-plugin-root');
const app = new App({ name: 'Starlog newspaper', version: '0.1.0' });
let mounted;
let mountedEditionId;
const adapter = {
  canSave: true,
  async save(input) {
    const reply = await app.callServerTool({ name: 'save_reflection', arguments: input });
    if (reply.isError) throw new Error(reply.content?.find(item => item.type === 'text')?.text || 'The note was not saved.');
    if (!reply.structuredContent?.reflection?.id) throw new Error('The server did not return a save receipt.');
    return reply.structuredContent;
  },
  async followup(prompt) {
    const reply = await app.sendMessage({ role: 'user', content: [{ type: 'text', text: prompt }] });
    if (reply.isError) throw new Error('The host did not accept this follow-up.');
    return reply;
  },
};
function applyTheme(context) {
  if (context?.theme === 'light' || context?.theme === 'dark') document.documentElement.style.colorScheme = context.theme;
}
app.onhostcontextchanged = applyTheme;
app.ontoolresult = (reply) => {
  const data = reply.structuredContent;
  if (!data?.edition || !Array.isArray(data.edition.stories)) return;
  const initialState = mountedEditionId === data.edition.id ? mounted?.getState() : undefined;
  mountedEditionId = data.edition.id;
  mounted = globalThis.StarlogReader.mount(root, data.edition, { variant: data.layout || 'reader', adapter, initialState });
};
app.ontoolcancelled = () => {
  if (!mounted) root.textContent = 'The newspaper request was cancelled.';
};
app.connect().then(() => applyTheme(app.getHostContext())).catch(() => {
  if (!mounted) root.textContent = 'The plugin could not connect to its host. The standalone reading preview works without this connection.';
});
