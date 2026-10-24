# Newspaper and MCP Apps prototype

This is a disposable experiment linked to [PLAN.md](../../PLAN.md). It compares three editorial reading layouts and checks whether the same reader can run as an MCP App. It is not the new Starlog application, a deployed service, a live newspaper, or an installed ChatGPT/Dot plugin.

## Run

Use Node 20+ and pnpm 11:

```sh
cd prototypes/newspaper-plugin
pnpm install --ignore-workspace --ignore-scripts
pnpm build
pnpm test
```

`pnpm start` runs an MCP server over STDIO. For an MCP client that supports local commands, use `node` as the command and an absolute path to `server/main.mjs` as its argument.

`pnpm start:http` runs Streamable HTTP at `http://127.0.0.1:8789/mcp`. Set `STARLOG_PROTOTYPE_PORT` to change the local port. This endpoint deliberately binds only to loopback and rejects unrelated Host/Origin headers. It has no account authentication; do not expose it publicly or tunnel it to a remote service.

Open `/host` on that same local port to test the official AppBridge in a browser. Its sandboxed iframe reads the actual MCP resource, and Save note reaches the real local store. Show saved notes reads it back. The host rejects discussion requests because no model is connected. This is a local integration harness, not a production MCP host.

A remote ChatGPT custom-MCP connection needs a reachable, authenticated endpoint. This experiment does not create or grant that connection. A successful local protocol test does not prove live ChatGPT/Dot rendering, scheduling, memory access or cross-device storage.

## Components and tools

The parent build uses the same `web/reader.js` and `web/reader.css` for the inline comparison and `dist/plugin.html`. Only the host adapter differs. `web/mcp-adapter.js` uses the official MCP Apps SDK, receives a tool result, and mounts that reader.

- `get_edition`: read the fixed sample and its citations.
- `show_edition`: display the sample in `broadsheet`, `magazine` or `reader` layout.
- `save_reflection`: explicitly save a user-written note with an idempotency key.
- `list_reflections`: retrieve those saved notes.

Only the render tool is associated with a UI resource. Data and save tools remain usable without UI. The resource URI includes a content hash so changed bundles have a new cache identity.

Question attempts, hint disclosure and evidence disclosure remain temporary UI state. They are not saved automatically, graded, marked mastered or added to an SRS queue. Save note is a separate deliberate action. The inline comparison has no notebook connection and says so.

## Scratch storage and boundaries

Explicit plugin saves go to `.localdata/PROTOTYPE-newspaper/reflections.json` inside this package. Set `STARLOG_PROTOTYPE_STORE` to use another scratch file. The path is trusted local configuration, not a tool parameter. Files contain only explicit saved notes; no journal, Drive, ChatGPT memory, provider credential or model API is connected.

Writes are serialized within one server process and use a temporary file plus rename. Repeating an identical request ID returns the original receipt; reusing it with different text is rejected. Unknown story IDs and empty notes are rejected. The file survives restarting the process, but is a prototype store: no multi-process locking, backup service, account isolation or sync is implemented. Use a single server process for a given file.

## Validation

`pnpm test` uses the real MCP SDK client to initialize STDIO and loopback HTTP transports, list tools, read the built UI resource, fetch/render the edition, save and retry a note, reject mismatched retries and invalid input, reload saved data in a new process, and reject a foreign browser origin. Test notes are generated only under ignored `.localdata/contract-tests/`.

The build emits `dist/build-evidence.json`, recording the shared reader/CSS hashes and bundle sizes. Both outputs contain exactly the same rendering and question code. The inline comparison is below 30 KB; the bundled MCP resource is approximately 502 KB.

Browser validation on 2026-10-24 used the real local host: Save note produced a receipt, and Show saved notes retrieved the same text/ID. Question responses survived evidence disclosure and article navigation; a second article's draft did not appear on the first article. All three layouts were inspected at narrow widths (297–320 pixels) without horizontal overflow. The local host rejected a discussion request because no model was connected, while preserving the typed response. These checks do not establish live ChatGPT/Dot behavior.

For a quick comparison, read the opening of the lead, expand one source, and open “One question, if useful.” Try another layout with the same material. The design question is which arrangement makes you want to continue reading and return to an idea; there is no selected winner.

## Reuse and licences

The host bridge reuses pinned official SDK packages rather than implementing a new protocol. Newspaper layout and interaction code are project-owned. The [third-party notices](THIRD_PARTY_NOTICES.md) preserve the installed dependency licences. Current component research also identified editable shadcn questionnaire/citation primitives and OpenAI Apps SDK UI; those React components are not incorporated into this dependency-free reader.

Official guidance: [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps), [OpenAI plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui).

Reusable components reviewed against primary sources:

| Candidate | Relevant pieces | Decision for this experiment |
| --- | --- | --- |
| [OpenAI Apps SDK UI](https://github.com/openai/apps-sdk-ui) | MIT React controls, inputs and layout primitives | Useful for a native ChatGPT appearance; not needed for this small original reader. |
| [shadcn Questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire), [Inline Citation](https://ui.shadcn.com/docs/ai-elements/base/inline-citation), [Sources](https://ui.shadcn.com/docs/ai-elements/base/sources) | MIT editable question and citation source | Strong candidates if a larger React UI is chosen. No source copied into this prototype. |
| [MCP-UI](https://mcpui.dev/guide/introduction) | Apache-2.0 host/rendering infrastructure | Extra layer when building our own host; the official AppBridge is enough for this experiment. |
| [assistant-ui](https://www.assistant-ui.com/docs/tools/tool-ui) | MIT custom tool-result components | More useful for a standalone chat client than this embedded reader. |

The actual reuse here is the pinned official MCP Apps/SDK implementation, with complete dependency notices retained. Its licensing transition is preserved rather than reduced to the package metadata's MIT label. The editorial design is ours to change.

