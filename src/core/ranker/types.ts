/**
 * Ranker contracts for ContextDiet (Task 3.0: LexicalRanker).
 *
 * The ranker is the bridge between a human's fuzzy intent ("Fix the JWT auth
 * bug") and the concrete graph. It turns that focus string into a small set of
 * high-confidence "seed" symbols that the graph traversal starts from. Like the
 * parser, downstream code (the pruner) depends only on these interfaces, never
 * on a concrete implementation — so the matching strategy (lexical today,
 * embeddings later) can be swapped without a rewrite.
 */

import type { SymbolNode } from '../parser/types.js';

/**
 * A symbol the ranker believes is relevant to the focus query, paired with a
 * confidence weight. This is the entry point ("seed") the graph traversal
 * expands from.
 */
export interface SeedNode {
  /** The matched declaration from the parser. */
  readonly symbol: SymbolNode;
  /**
   * Confidence that this symbol is relevant to the focus query, in `[0, 1]`.
   * Higher means a stronger lexical match. Callers may threshold on this to
   * decide how many seeds to expand.
   */
  readonly weight: number;
  /**
   * The focus tokens that contributed to this match, for explainability/debug.
   * e.g. matching `verifyJWT` against "Fix JWT auth" yields `['jwt']`.
   */
  readonly matchedTokens: readonly string[];
}

/** Tunables for lexical matching. All optional; sensible defaults are used. */
export interface RankerOptions {
  /**
   * Minimum weight required for a symbol to be returned as a seed. Symbols
   * scoring at or below this are dropped. Defaults to `0` (drop only zeros).
   */
  readonly minWeight?: number;
  /**
   * Cap on the number of seeds returned, keeping the highest-weighted. When
   * omitted, all symbols above `minWeight` are returned.
   */
  readonly limit?: number;
}

/**
 * The matching-engine contract. Pure and deterministic: same query + symbols
 * always yields the same seeds, with zero I/O and zero network calls.
 */
export interface Ranker {
  /**
   * Tokenize `focusQuery` into lexical seeds, match them against `allSymbols`,
   * and return the relevant symbols ordered by descending weight.
   */
  determineSeeds(focusQuery: string, allSymbols: readonly SymbolNode[]): SeedNode[];

  /**
   * Expose the tokenizer so tests and callers can inspect exactly which
   * keywords a query reduces to (stop words removed, normalized, deduped).
   */
  tokenize(focusQuery: string): string[];
}
