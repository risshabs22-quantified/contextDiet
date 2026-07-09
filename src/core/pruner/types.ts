/**
 * Pruner contract for ContextDiet (Task 3.5).
 *
 * The pruner is the last transform before bundling: given a single file's source
 * and the set of symbol names the Selector chose to keep, it reconstructs a
 * trimmed version of that file containing only those symbols and the imports they
 * still use. It never rewrites code — it re-emits kept declarations verbatim — so
 * emitted output is syntactically valid by construction.
 */
export interface Pruner {
  /**
   * Reconstruct `source` keeping only the top-level symbols named in `keep`,
   * plus the import statements those surviving symbols reference. Returns the
   * empty string when nothing is kept.
   */
  prune(source: string, filePath: string, keep: ReadonlySet<string>): Promise<string>;
}
