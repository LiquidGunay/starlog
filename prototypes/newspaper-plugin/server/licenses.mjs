// Regenerate notices for dependency code actually included in either browser bundle.
import { build } from 'esbuild';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const audit = await build({ absWorkingDir: root, entryPoints: ['web/mcp-adapter.js','server/host-client.js'], bundle: true, platform: 'browser', format: 'esm', outdir: 'dist/license-audit', write: false, metafile: true });
const packages = new Map();
for (const input of Object.keys(audit.metafile.inputs)) {
  const offset = input.lastIndexOf('node_modules/');
  if (offset < 0) continue;
  const rest = input.slice(offset + 'node_modules/'.length);
  const name = rest.split('/').slice(0, rest.startsWith('@') ? 2 : 1).join('/');
  packages.set(name, resolve(root, input.slice(0, offset) + 'node_modules/' + name));
}
packages.set('esbuild', join(root, 'node_modules', 'esbuild'));
let text = '# Third-party notices\n\nThis prototype uses the official MCP SDKs through their public interfaces. Upstream source files are not modified. Below are the installed licences for dependencies whose code enters the plugin or local-host browser bundle, plus the build tool. Regenerate with `node server/licenses.mjs` after dependency changes.\n\nThe ext-apps package metadata says MIT, but its bundled LICENSE describes a transition: Apache-2.0 for new contributions, MIT for prior contributions without relicensing consent, and CC-BY-4.0 for documentation excluding specifications. Preserve the complete licence when redistributing the bundle. The build retains supplied legal comments.\n\nNo code from shadcn/ui, OpenAI Apps SDK UI, assistant-ui or MCP-UI is copied into this prototype. Product content links to research sources; citations do not grant redistribution rights to their full articles or figures.\n';
for (const [name, directory] of [...packages].sort(([a],[b]) => a.localeCompare(b))) {
  const metadata = JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  if (!files.length) throw new Error(`No licence file found for ${name}`);
  text += `\n## ${name} ${metadata.version}\n`;
  for (const filename of files) text += `\n### ${filename}\n\n${await readFile(join(directory,filename),'utf8')}\n`;
}
await writeFile(join(root,'THIRD_PARTY_NOTICES.md'),text);
console.log(`Preserved notices for ${packages.size} bundled/build dependencies.`);
