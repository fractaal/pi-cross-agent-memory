# @fractaal/pi-cross-agent-memory

Portable Pi extension that injects local Claude Code and Codex memory indexes for projects encountered during a Pi session.

This package is also the **reference implementation** for how fractaal Pi extensions are published — see [Publishing a Pi extension properly](#publishing-a-pi-extension-properly).

## What it loads

- Claude Code project memory:
  - `~/.claude/projects/<project-slug>/memory/MEMORY.md`
  - legacy `~/.claude/projects/<project-slug>/MEMORY.md`
- Codex project memory, if present:
  - `~/.codex/projects/<project-slug>/memory/MEMORY.md`
  - `~/.Codex/projects/<project-slug>/memory/MEMORY.md`
- Codex global memory, if present:
  - `~/.codex/memories/MEMORY.md`
  - `~/.Codex/memories/MEMORY.md`

It also considers the git common worktree root, so a task worktree can still pick up memory saved against the main checkout root.

At session start, memory is resolved from the active cwd. Successful path-aware `read`, `grep`, `find`, `ls`, `write`, and `edit` results also discover memory for newly encountered projects. Newly discovered memory is surfaced in that tool result for the next model turn, retained for later prompts, and restored when the session reloads or resumes. The active cwd remains first within the total context budget on later prompts. Memory is advisory recall, so writes are never blocked while it loads.

## Pi usage

From npm:

```bash
pi install npm:@fractaal/pi-cross-agent-memory
```

Or by git ref:

```bash
pi install git:github.com/fractaal/pi-cross-agent-memory@<commit-or-tag>
```

Local dogfood while developing:

```bash
pi install /path/to/pi-cross-agent-memory
```

Pi loads the extension through the `pi.extensions` manifest entry, which points at `./src/index.ts` — Pi's loader compiles TypeScript itself, so no build output is involved on this path.

## Commands

- `/cross-agent-memory` shows which memory files are currently injected for the session.
- `/claude-memory` is kept as a compatibility alias for Ben's old personal extension command.

## Embedding

ALR or another host can import the factory directly:

```ts
import { createCrossAgentMemoryExtension } from '@fractaal/pi-cross-agent-memory';

const extensionFactory = createCrossAgentMemoryExtension({ notifyOnSessionStart: false });
```

This import resolves to compiled JS in `dist/` via the package `exports` map — plain Node can load it, no TypeScript loader required. The default export is a ready-to-load Pi extension for ordinary Pi package use.

## Publishing a Pi extension properly

The pattern this package follows, and every fractaal Pi extension should copy:

1. **Two entry doors, one implementation.**
   - `pi.extensions` in `package.json` points at the TypeScript source (`./src/index.ts`). Pi's own loader consumes this — it compiles TS itself. This is the standard Pi-ecosystem door.
   - `exports` / `main` / `types` point at compiled JS in `dist/`. Ordinary Node consumers (ALR embedding Pi as a library, tests, scripts) import through this door. Node deliberately refuses to type-strip `.ts` files inside `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so this door **must** be compiled JS.
2. **`dist/` is never committed.** It is gitignored. The build runs automatically at publish time via `prepack`, so the npm tarball always contains fresh compiled output matching the source it ships with.
3. **`files` ships both doors**: `dist` (compiled JS + types) and `src` (the `.ts` the Pi loader reads).
4. **Published to npm under `@fractaal`**, `publishConfig.access: public`. Consumers pin ordinary semver versions. No git-SHA tarball URLs, no vendored build artifacts, no path-resolving `.ts` files out of `node_modules` at runtime.
5. **Runtime imports stay lean.** The Pi API is imported type-only (`import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'`), so the compiled output has no hard runtime dependency on the harness — it is declared as a peer.

Release flow:

```bash
npm run typecheck && npm test
npm version minor        # or patch/major
npm publish              # prepack builds dist/ automatically
git push --follow-tags
```
