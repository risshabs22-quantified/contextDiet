/**
 * MarkdownBundler — Task 5.0 (output delivery).
 *
 * The final stage of the pipeline: take the pruned files and serialize them
 * into one hyper-dense, LLM-friendly stream. The format is deliberately plain
 * (explicit START/END delimiters rather than triple-backtick fences) because:
 *   - it survives nested code that itself contains ``` fences without escaping,
 *   - the path appears on both boundaries so a model can attribute every line,
 *   - it costs almost no extra tokens per file.
 *
 * Pure and deterministic: same input files always produce byte-identical output.
 * No I/O, no network.
 */

/** A single file to include in the bundle. */
export interface BundleFile {
  /** Path shown in the delimiters — should be repo-relative for readability. */
  readonly path: string;
  /** The (already pruned) file contents. */
  readonly content: string;
}

/** Tunables for how the stream is assembled. */
export interface BundlerOptions {
  /**
   * Blank line(s) inserted between consecutive file blocks. Defaults to `1`.
   * Purely cosmetic; does not affect a block's own delimiters.
   */
  readonly blockSeparation?: number;
  /**
   * Sort files by path before emitting, for stable output regardless of input
   * order. Defaults to `false` (preserve caller order, typically graph order).
   */
  readonly sortByPath?: boolean;
}

const START_PREFIX = '--- START FILE: ';
const END_PREFIX = '--- END FILE: ';
const DELIM_SUFFIX = ' ---';

/**
 * Wrap a single file's content in the START/END delimiters. Exported so callers
 * (and tests) can format one block in isolation.
 */
export function formatFileBlock(file: BundleFile): string {
  const header = `${START_PREFIX}${file.path}${DELIM_SUFFIX}`;
  const footer = `${END_PREFIX}${file.path}${DELIM_SUFFIX}`;
  // Preserve content verbatim; only guarantee the delimiters sit on their own
  // lines by trimming a single trailing newline so the footer never doubles up.
  const body = stripSingleTrailingNewline(file.content);
  return `${header}\n${body}\n${footer}`;
}

export class MarkdownBundler {
  private readonly blockSeparation: number;
  private readonly sortByPath: boolean;

  constructor(options: BundlerOptions = {}) {
    this.blockSeparation = Math.max(0, options.blockSeparation ?? 1);
    this.sortByPath = options.sortByPath ?? false;
  }

  /**
   * Combine all files into a single Markdown stream. Returns an empty string for
   * an empty file list.
   */
  bundle(files: readonly BundleFile[]): string {
    if (files.length === 0) return '';

    const ordered = this.sortByPath
      ? [...files].sort((a, b) => a.path.localeCompare(b.path))
      : files;

    const separator = '\n'.repeat(this.blockSeparation + 1);
    return ordered.map(formatFileBlock).join(separator);
  }
}

function stripSingleTrailingNewline(content: string): string {
  if (content.endsWith('\r\n')) return content.slice(0, -2);
  if (content.endsWith('\n')) return content.slice(0, -1);
  return content;
}
