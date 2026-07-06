import { sep } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
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
export declare function createCrossAgentMemoryExtension(options?: CrossAgentMemoryExtensionOptions): (pi: ExtensionAPI) => void;
declare const _default: (pi: ExtensionAPI) => void;
export default _default;
export declare function resolveCrossAgentMemoryFiles(options: ResolveCrossAgentMemoryFilesOptions): Promise<CrossAgentMemoryFile[]>;
export declare function projectMemorySlug(directory: string, pathSeparator?: typeof sep): string;
