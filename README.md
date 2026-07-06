# pi-cross-agent-memory

Portable Pi extension that injects local Claude Code and Codex memory indexes for the active cwd.

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

## Pi usage

Local dogfood:

```bash
pi install /home/benjude/Projects/pi-cross-agent-memory
```

Or add the local path to `~/.pi/agent/settings.json` packages:

```json
{
  "packages": ["/home/benjude/Projects/pi-cross-agent-memory"]
}
```

Once this repo has a remote:

```bash
pi install git:github.com/<owner>/pi-cross-agent-memory@<commit-or-tag>
```

## Commands

- `/cross-agent-memory` shows which memory files are currently injected.
- `/claude-memory` is kept as a compatibility alias for Ben's old personal extension command.

## Embedding

ALR or another host can import the factory directly:

```ts
import { createCrossAgentMemoryExtension } from 'pi-cross-agent-memory';

const extensionFactory = createCrossAgentMemoryExtension({ notifyOnSessionStart: false });
```

The default export is a ready-to-load Pi extension for ordinary Pi package use.
