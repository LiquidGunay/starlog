# AI Runtime Prompt Pack

These markdown files are the canonical, user-editable behavior layer for Starlog assistant and
agent orchestration.

## Rules

- Keep assistant and agent behavior prompts in `*.md` files in this directory.
- Prefer editing these prompt files over changing large inline prompt strings in Python or
  TypeScript.
- Keep filenames stable and descriptive: `<workflow>.<role>.md` is the default convention.
- Use plain markdown that remains readable in the repo and acceptable to send directly to the
  model.
- If a prompt needs structured interpolation, keep the template placeholders in the markdown file
  and let the runtime render values into it.

## Current convention

- `*.system.md` for system behavior instructions
- `*.user.md` for rendered user/context templates

Legacy `.txt` prompt lookups may still resolve during migration, but markdown files are the
canonical source of truth.
