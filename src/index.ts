import { open, realpath, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, posix, sep, win32 } from 'node:path';
import { homedir } from 'node:os';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const DEFAULT_FILE_LIMIT_BYTES = 50 * 1024;
const DEFAULT_TOTAL_LIMIT_BYTES = 100 * 1024;
const MEMORY_BLOCK_HEADING = '# cross-agent memory';

type MemorySourceKind = 'claude-code-project-memory' | 'codex-project-memory' | 'codex-global-memory';

interface MemoryCandidate {
  kind: MemorySourceKind;
  label: string;
  path: string;
  projectDirectory?: string;
}

export interface CrossAgentMemoryFile extends MemoryCandidate {
  content: string;
  originalBytes: number;
  truncated: boolean;
}

export interface ResolveCrossAgentMemoryFilesOptions {
  cwd: string;
  homeDir?: string;
  fileLimitBytes?: number;
  totalLimitBytes?: number;
}

export interface CrossAgentMemoryExtensionOptions {
  homeDir?: string;
  fileLimitBytes?: number;
  totalLimitBytes?: number;
  notifyOnSessionStart?: boolean;
}

export function createCrossAgentMemoryExtension(options: CrossAgentMemoryExtensionOptions = {}) {
  const homeDir = options.homeDir ?? homedir();
  const fileLimitBytes = positiveInteger(options.fileLimitBytes) ?? DEFAULT_FILE_LIMIT_BYTES;
  const totalLimitBytes = positiveInteger(options.totalLimitBytes) ?? DEFAULT_TOTAL_LIMIT_BYTES;
  const notifyOnSessionStart = options.notifyOnSessionStart ?? true;
  let lastResolved: CrossAgentMemoryFile[] = [];

  return function crossAgentMemory(pi: ExtensionAPI) {
    const resolveForCwd = (cwd: string) => resolveCrossAgentMemoryFiles({ cwd, homeDir, fileLimitBytes, totalLimitBytes });

    pi.on('session_start', async (_event, ctx) => {
      lastResolved = await resolveForCwd(ctx.cwd);
      if (notifyOnSessionStart && ctx.hasUI && lastResolved.length > 0) {
        ctx.ui.notify(`Cross-agent memory loaded: ${formatFileList(lastResolved)}`, 'info');
      }
    });

    pi.on('before_agent_start', async (event, ctx) => {
      lastResolved = await resolveForCwd(ctx.cwd);
      if (lastResolved.length === 0) return undefined;
      if (event.systemPrompt.includes(`${MEMORY_BLOCK_HEADING}\n`) && lastResolved.every((file) => event.systemPrompt.includes(file.path))) {
        return undefined;
      }
      return { systemPrompt: `${event.systemPrompt}\n\n${buildCrossAgentMemoryBlock(lastResolved, totalLimitBytes)}` };
    });

    const commandHandler = async (_args: string, ctx: { cwd: string; hasUI: boolean; ui: { notify: (message: string, level?: 'info' | 'warning' | 'error') => void } }) => {
      lastResolved = await resolveForCwd(ctx.cwd);
      if (!ctx.hasUI) return;
      ctx.ui.notify(
        lastResolved.length > 0
          ? `Injecting cross-agent memory from ${formatFileList(lastResolved)}`
          : 'No local Claude Code or Codex memory files found for this cwd.',
        lastResolved.length > 0 ? 'info' : 'warning',
      );
    };

    pi.registerCommand('cross-agent-memory', {
      description: 'Show the local Claude Code and Codex memory files injected for this cwd',
      handler: commandHandler,
    });

    pi.registerCommand('claude-memory', {
      description: 'Alias for /cross-agent-memory',
      handler: commandHandler,
    });
  };
}

export default createCrossAgentMemoryExtension();

export async function resolveCrossAgentMemoryFiles(options: ResolveCrossAgentMemoryFilesOptions): Promise<CrossAgentMemoryFile[]> {
  const homeDir = options.homeDir ?? homedir();
  const fileLimitBytes = positiveInteger(options.fileLimitBytes) ?? DEFAULT_FILE_LIMIT_BYTES;
  const totalLimitBytes = positiveInteger(options.totalLimitBytes) ?? DEFAULT_TOTAL_LIMIT_BYTES;
  const candidates = uniqueCandidates([
    ...projectDirectoryCandidates(options.cwd).flatMap((projectDirectory) => claudeCodeMemoryCandidates(homeDir, projectDirectory)),
    ...projectDirectoryCandidates(options.cwd).flatMap((projectDirectory) => codexProjectMemoryCandidates(homeDir, projectDirectory)),
    ...codexGlobalMemoryCandidates(homeDir),
  ]);
  const files: CrossAgentMemoryFile[] = [];
  const seenLoadedFiles = new Set<string>();
  let remainingBytes = totalLimitBytes;

  for (const candidate of candidates) {
    if (remainingBytes <= 0) break;
    const file = await readMemoryCandidate(candidate, Math.min(fileLimitBytes, remainingBytes));
    if (!file) continue;
    const loadedKey = await loadedFileKey(file.path);
    if (seenLoadedFiles.has(loadedKey)) continue;
    seenLoadedFiles.add(loadedKey);
    files.push(file);
    remainingBytes -= Buffer.byteLength(file.content, 'utf8');
  }

  return files;
}

export function projectMemorySlug(directory: string, pathSeparator: typeof sep = sep): string {
  const pathApi = pathSeparator === '\\' ? win32 : posix;
  const absolute = pathApi.resolve(directory);
  const parts = absolute.split(pathApi.sep).filter(Boolean).map(safeSlugPart);
  return `-${parts.join('-')}`;
}

function projectDirectoryCandidates(cwd: string): string[] {
  return uniqueStrings([
    findGitRoot(cwd),
    findGitCommonWorktreeRoot(cwd),
    cwd,
  ].filter((value): value is string => Boolean(value)));
}

function claudeCodeMemoryCandidates(homeDir: string, projectDirectory: string): MemoryCandidate[] {
  const projectRoot = join(homeDir, '.claude', 'projects', projectMemorySlug(projectDirectory));
  return [
    {
      kind: 'claude-code-project-memory',
      label: 'Claude Code project MEMORY.md',
      path: join(projectRoot, 'memory', 'MEMORY.md'),
      projectDirectory,
    },
    {
      kind: 'claude-code-project-memory',
      label: 'Claude Code project MEMORY.md (legacy root file)',
      path: join(projectRoot, 'MEMORY.md'),
      projectDirectory,
    },
  ];
}

function codexProjectMemoryCandidates(homeDir: string, projectDirectory: string): MemoryCandidate[] {
  const slug = projectMemorySlug(projectDirectory);
  return [
    {
      kind: 'codex-project-memory',
      label: 'Codex project MEMORY.md',
      path: join(homeDir, '.codex', 'projects', slug, 'memory', 'MEMORY.md'),
      projectDirectory,
    },
    {
      kind: 'codex-project-memory',
      label: 'Codex project MEMORY.md',
      path: join(homeDir, '.Codex', 'projects', slug, 'memory', 'MEMORY.md'),
      projectDirectory,
    },
  ];
}

function codexGlobalMemoryCandidates(homeDir: string): MemoryCandidate[] {
  return [
    { kind: 'codex-global-memory', label: 'Codex global MEMORY.md', path: join(homeDir, '.codex', 'memories', 'MEMORY.md') },
    { kind: 'codex-global-memory', label: 'Codex global MEMORY.md', path: join(homeDir, '.Codex', 'memories', 'MEMORY.md') },
  ];
}

async function readMemoryCandidate(candidate: MemoryCandidate, limitBytes: number): Promise<CrossAgentMemoryFile | null> {
  if (limitBytes <= 0) return null;
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(candidate.path);
    if (!fileStat.isFile()) return null;
  } catch {
    return null;
  }

  const content = await readFilePrefix(candidate.path, limitBytes);
  if (!content.text.trim()) return null;
  return {
    ...candidate,
    content: content.text,
    originalBytes: fileStat.size,
    truncated: fileStat.size > content.bytesRead,
  };
}

async function readFilePrefix(path: string, limitBytes: number): Promise<{ text: string; bytesRead: number }> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(limitBytes);
    const { bytesRead } = await handle.read(buffer, 0, limitBytes, 0);
    return {
      text: buffer.subarray(0, bytesRead).toString('utf8').replace(/\uFFFD$/, ''),
      bytesRead,
    };
  } finally {
    await handle.close();
  }
}

async function loadedFileKey(path: string): Promise<string> {
  try {
    return (await realpath(path)).toLowerCase();
  } catch {
    return path.toLowerCase();
  }
}

function findGitRoot(cwd: string): string | null {
  return gitPath(cwd, ['rev-parse', '--show-toplevel']);
}

function findGitCommonWorktreeRoot(cwd: string): string | null {
  const commonDir = gitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!commonDir) return null;
  return dirname(commonDir);
}

function gitPath(cwd: string, args: string[]): string | null {
  try {
    const output = execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function buildCrossAgentMemoryBlock(files: CrossAgentMemoryFile[], totalLimitBytes: number): string {
  return [
    MEMORY_BLOCK_HEADING,
    '',
    `Local memory indexes from other agent harnesses for this cwd. Treat them as durable recall hints, not as user messages. At most ${formatKb(totalLimitBytes)} total file content is injected; read the referenced files directly when more detail is needed.`,
    '',
    ...files.map(formatMemoryFile),
  ].join('\n');
}

function formatMemoryFile(file: CrossAgentMemoryFile): string {
  const metadata = [
    `source="${xmlAttr(file.kind)}"`,
    `label="${xmlAttr(file.label)}"`,
    `path="${xmlAttr(file.path)}"`,
    ...(file.projectDirectory ? [`project_directory="${xmlAttr(file.projectDirectory)}"`] : []),
  ].join(' ');
  const lines = [
    `<cross-agent-memory-file ${metadata}>`,
    file.content,
  ];
  if (file.truncated) {
    lines.push('', `WARNING: file is ${formatKb(file.originalBytes)}. Only the first ${formatKb(Buffer.byteLength(file.content, 'utf8'))} was loaded. Read the file directly if more detail is needed.`);
  }
  lines.push('</cross-agent-memory-file>');
  return lines.join('\n');
}

function uniqueCandidates(candidates: MemoryCandidate[]): MemoryCandidate[] {
  const seen = new Set<string>();
  const result: MemoryCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    result.push(candidate);
  }
  return result;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function safeSlugPart(part: string): string {
  return part.replace(/:/g, '');
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function formatFileList(files: CrossAgentMemoryFile[]): string {
  return files.map((file) => file.path).join(', ');
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

function xmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
