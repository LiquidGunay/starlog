# Legacy Starlog archive

Archived on 2026-10-03. Historical material only; no file here supplies current requirements.

The sole active product plan is [PLAN.md](../../../PLAN.md). Do not preload or search this archive during normal planning or development. It is excluded from ordinary ripgrep discovery.

## Inventory and recovery

Original paths are preserved beneath this directory. manifest.json records the original path, archive path, byte size, and SHA-256 of every preserved file. Tracked snapshots preserve Git blob bytes at 52c2c2e; NEWPLAN.md preserves the untracked canonical file bytes. This avoids platform line-ending changes.

- PLAN.md, VISION.md, and AGENTS.legacy.md: former Life OS and assistant-first direction.
- NEWPLAN.md: the later MCP/ChatGPT-hosted learning exploration; copied from an untracked local file.
- starlog_*.md: former assistant protocol and migration designs.
- docs/: former architecture, status, runbooks, release material, and implementation history.
- artifacts/ui-concept/: former desktop/mobile mockups and explanations.
- README.md from the old root is stored as LEGACY_README.md because this file is the archive index.

Old links and absolute paths describe the original layout and machine. For archived links that no longer resolve at their original location, use the original-path mapping in manifest.json. Nothing in a snapshot reactivates an old requirement.

The living coordination procedure remains at docs/PARALLEL_AGENT_WORKFLOW.md outside this archive. Source-adjacent implementation READMEs and runtime prompts remain with legacy code and are explicitly labeled or excluded from routine prompt discovery.

To recover one item, identify it in manifest.json, check its hash, and copy it to an explicitly chosen location. Do not restore the full old planning set as active guidance.

If an original untracked NEWPLAN.md remains at the repository root, it is an obsolete entrypoint. Verify its hash against the manifest before removing it. The preserved copy in this archive is historical only.
