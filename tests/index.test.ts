import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import crossAgentMemory, { createCrossAgentMemoryExtension, projectMemorySlug, resolveCrossAgentMemoryFiles } from '../src/index.js';

const tempRoots: string[] = [];

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'pi-cross-agent-memory-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';
}

function fakePi() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => Promise<unknown> | unknown>>();
  const commands = new Map<string, (args: string, ctx: any) => Promise<unknown> | unknown>();
  const pi = {
    on: vi.fn((name: string, handler: (event: any, ctx: any) => Promise<unknown> | unknown) => {
      const existing = handlers.get(name) ?? [];
      existing.push(handler);
      handlers.set(name, existing);
    }),
    registerCommand: vi.fn((name: string, definition: { handler: (args: string, ctx: any) => Promise<unknown> | unknown }) => {
      commands.set(name, definition.handler);
    }),
  };
  return { pi, handlers, commands };
}

async function writeMemory(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

describe('project memory slug', () => {
  it('matches Claude/Codex project directory slugs for POSIX and Windows paths', () => {
    expect(projectMemorySlug('/home/benjude/Symph/aria-chat', '/')).toBe('-home-benjude-Symph-aria-chat');
    expect(projectMemorySlug('/workspace/project', '/')).toBe('-workspace-project');
    expect(projectMemorySlug('C:\\Users\\Ben\\Projects\\demo', '\\')).toBe('-C-Users-Ben-Projects-demo');
  });
});

describe('resolveCrossAgentMemoryFiles', () => {
  it('loads Claude project memory and Codex global memory for the cwd', async () => {
    const home = await tempRoot();
    const cwd = join(home, 'Projects', 'demo');
    await mkdir(cwd, { recursive: true });
    const claudeMemory = join(home, '.claude', 'projects', projectMemorySlug(cwd), 'memory', 'MEMORY.md');
    const codexGlobalMemory = join(home, '.codex', 'memories', 'MEMORY.md');
    await writeMemory(claudeMemory, 'Claude project memory.\n');
    await writeMemory(codexGlobalMemory, 'Codex global memory.\n');

    const files = await resolveCrossAgentMemoryFiles({ cwd, homeDir: home });

    expect(files.map((file) => file.path)).toEqual([claudeMemory, codexGlobalMemory]);
    expect(files.map((file) => file.content)).toEqual(['Claude project memory.\n', 'Codex global memory.\n']);
  });

  it('deduplicates case-only alternate Codex paths and symlink aliases after loading', async () => {
    const home = await tempRoot();
    const cwd = join(home, 'Projects', 'demo');
    await mkdir(cwd, { recursive: true });
    const codexLower = join(home, '.codex', 'memories', 'MEMORY.md');
    const codexUpper = join(home, '.Codex', 'memories', 'MEMORY.md');
    await writeMemory(codexLower, 'Codex global memory.\n');
    try {
      await mkdir(dirname(codexUpper), { recursive: true });
      await symlink(codexLower, codexUpper);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }

    const files = await resolveCrossAgentMemoryFiles({ cwd, homeDir: home });

    expect(files.map((file) => file.path)).toEqual([codexLower]);
  });

  it('skips directory matches and respects file and total byte budgets', async () => {
    const home = await tempRoot();
    const cwd = join(home, 'Projects', 'demo');
    await mkdir(cwd, { recursive: true });
    const slug = projectMemorySlug(cwd);
    const claudeMemory = join(home, '.claude', 'projects', slug, 'memory', 'MEMORY.md');
    const codexProjectDirectoryAtMemoryPath = join(home, '.codex', 'projects', slug, 'memory', 'MEMORY.md');
    const codexGlobalMemory = join(home, '.codex', 'memories', 'MEMORY.md');
    await writeMemory(claudeMemory, 'A'.repeat(20));
    await mkdir(codexProjectDirectoryAtMemoryPath, { recursive: true });
    await writeMemory(codexGlobalMemory, 'B'.repeat(20));

    const files = await resolveCrossAgentMemoryFiles({ cwd, homeDir: home, fileLimitBytes: 12, totalLimitBytes: 18 });

    expect(files).toHaveLength(2);
    expect(files[0]).toMatchObject({ path: claudeMemory, content: 'A'.repeat(12), truncated: true, originalBytes: 20 });
    expect(files[1]).toMatchObject({ path: codexGlobalMemory, content: 'B'.repeat(6), truncated: true, originalBytes: 20 });
  });
});

describe('Pi extension', () => {
  it('registers commands and injects a bounded cross-agent memory block', async () => {
    const home = await tempRoot();
    const cwd = join(home, 'Projects', 'demo');
    await mkdir(cwd, { recursive: true });
    const claudeMemory = join(home, '.claude', 'projects', projectMemorySlug(cwd), 'memory', 'MEMORY.md');
    await writeMemory(claudeMemory, 'Claude memory.\n');
    const runtime = fakePi();

    createCrossAgentMemoryExtension({ homeDir: home, notifyOnSessionStart: false })(runtime.pi as never);

    expect(runtime.commands.has('cross-agent-memory')).toBe(true);
    expect(runtime.commands.has('claude-memory')).toBe(true);
    const beforeAgent = runtime.handlers.get('before_agent_start')?.[0];
    const result = await beforeAgent?.({ systemPrompt: 'base prompt' }, { cwd, hasUI: true, ui: { notify: vi.fn() } });
    const systemPrompt = (result as { systemPrompt: string }).systemPrompt;
    expect(systemPrompt).toContain('# cross-agent memory');
    expect(systemPrompt).toContain('Claude memory.');
    expect(systemPrompt).toContain(claudeMemory);
  });

  it('default export is a Pi extension function', () => {
    expect(typeof crossAgentMemory).toBe('function');
  });
});
