/**
 * AstPruner (Task 3.5).
 *
 * Reconstructs a file down to just the symbols the Selector kept, plus the
 * imports those symbols still reference. Strategy:
 *
 *   1. Parse top-level symbols and whole import statements.
 *   2. Keep the symbols whose names are in the keep-set.
 *   3. Find which identifiers the kept symbols reference, and keep only the
 *      import statements that introduce at least one referenced binding
 *      (dead-import elimination).
 *   4. Re-emit kept imports + kept symbols in original source order, each sliced
 *      verbatim via `Parser.sliceNode`.
 *
 * Because it only ever *omits* whole declarations and re-emits kept ones
 * unchanged, the pruner cannot introduce a syntax error into what it emits.
 */

import { AstGrepperParser } from '../parser/index.js';
import type { Parser, Range } from '../parser/types.js';
import type { Pruner } from './types.js';

export class AstPruner implements Pruner {
  private readonly parser: Parser;

  constructor(parser: Parser = new AstGrepperParser()) {
    this.parser = parser;
  }

  async prune(source: string, filePath: string, keep: ReadonlySet<string>): Promise<string> {
    const symbols = await this.parser.extractSymbols(source, filePath);
    const keptSymbols = symbols.filter((symbol) => keep.has(symbol.name));
    if (keptSymbols.length === 0) return '';

    // Which imports do the survivors still use?
    const referenced = await this.parser.collectReferences(
      source,
      filePath,
      keptSymbols.map((symbol) => symbol.range),
    );
    const importStatements = await this.parser.extractImportStatements(source, filePath);
    const keptImports = importStatements.filter((statement) =>
      statement.localNames.some((name) => referenced.has(name)),
    );

    // Emit imports then symbols, in original source order, de-duplicating ranges
    // (a multi-binding declaration like `const a = 1, b = 2` yields one range for
    // several kept symbols and must be sliced exactly once).
    const ranges = dedupeRanges([
      ...keptImports.map((statement) => statement.range),
      ...keptSymbols.map((symbol) => symbol.range),
    ]).sort((a, b) => a.start.index - b.start.index);

    return ranges.map((range) => this.parser.sliceNode(source, range)).join('\n\n') + '\n';
  }
}

/** Remove ranges that cover the exact same span. */
function dedupeRanges(ranges: readonly Range[]): Range[] {
  const seen = new Set<string>();
  const unique: Range[] = [];
  for (const range of ranges) {
    const key = `${range.start.index}:${range.end.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(range);
  }
  return unique;
}
