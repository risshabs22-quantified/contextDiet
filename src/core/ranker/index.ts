/**
 * LexicalRanker — Task 3.0.
 *
 * A lightweight, deterministic, $0 matching engine. It turns a natural-language
 * focus string into a set of seed symbols by pure string analysis: tokenize the
 * query (dropping stop words), tokenize each symbol name (splitting camelCase /
 * snake_case), and score the overlap. No embeddings, no API, no network, no I/O.
 *
 * Scoring is intentionally simple and explainable:
 *   - An *exact* query-token ↔ symbol-token match is worth the most.
 *   - A *partial* (substring) match is worth a fraction of that.
 *   - Earlier query tokens weigh slightly more (users front-load intent, e.g.
 *     "JWT" in "Fix JWT auth"), which lets `verifyJWT` outrank `authMiddleware`.
 *   - The per-symbol raw score is squashed into `[0, 1]` so weights are stable
 *     regardless of query length.
 */

import type { SymbolNode } from '../parser/types.js';
import type { Ranker, RankerOptions, SeedNode } from './types.js';

/**
 * Common English filler plus task-verb noise that carries no signal about which
 * code symbol matters. Kept deliberately small and hand-audited — over-stemming
 * hurts precision more than a few extra stop words help.
 */
const STOP_WORDS: ReadonlySet<string> = new Set([
  // articles / conjunctions / prepositions
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'from', 'into', 'by', 'as', 'is', 'are', 'be', 'this', 'that', 'it',
  // generic task verbs / nouns that describe the *action*, not the *subject*
  'fix', 'fixing', 'fixed', 'bug', 'bugs', 'issue', 'issues', 'error', 'errors',
  'add', 'adding', 'update', 'updating', 'change', 'changing', 'refactor',
  'implement', 'handle', 'support', 'make', 'please', 'need', 'want', 'should',
]);

/** Weight of an exact token match vs. a partial (substring) match. */
const EXACT_MATCH_SCORE = 1;
const PARTIAL_MATCH_SCORE = 0.4;

/** How strongly earlier query tokens are favored (0 = no positional bias). */
const POSITION_DECAY = 0.15;

const DEFAULT_MIN_WEIGHT = 0;

export class LexicalRanker implements Ranker {
  private readonly minWeight: number;
  private readonly limit: number | undefined;

  constructor(options: RankerOptions = {}) {
    this.minWeight = options.minWeight ?? DEFAULT_MIN_WEIGHT;
    this.limit = options.limit;
  }

  tokenize(focusQuery: string): string[] {
    const seen = new Set<string>();
    const tokens: string[] = [];

    for (const raw of splitWords(focusQuery)) {
      const token = raw.toLowerCase();
      if (token.length === 0 || STOP_WORDS.has(token)) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }

    return tokens;
  }

  determineSeeds(focusQuery: string, allSymbols: readonly SymbolNode[]): SeedNode[] {
    const queryTokens = this.tokenize(focusQuery);
    if (queryTokens.length === 0) return [];

    // Positional weight: token 0 gets 1.0, each subsequent token slightly less.
    // Normalized by the max so a single-token query still tops out at 1.0.
    const positionWeights = queryTokens.map((_, i) => 1 / (1 + POSITION_DECAY * i));
    const maxPossible = positionWeights.reduce((sum, w) => sum + w * EXACT_MATCH_SCORE, 0);

    const seeds: SeedNode[] = [];

    for (const symbol of allSymbols) {
      const symbolTokens = tokenizeIdentifier(symbol.name);
      if (symbolTokens.length === 0) continue;

      let raw = 0;
      const matchedTokens: string[] = [];

      queryTokens.forEach((queryToken, i) => {
        const contribution = bestTokenMatch(queryToken, symbolTokens);
        if (contribution > 0) {
          raw += contribution * positionWeights[i]!;
          matchedTokens.push(queryToken);
        }
      });

      if (raw <= 0) continue;

      const weight = clamp01(raw / maxPossible);
      if (weight <= this.minWeight) continue;

      seeds.push({ symbol, weight, matchedTokens });
    }

    seeds.sort(byWeightThenName);

    return this.limit === undefined ? seeds : seeds.slice(0, this.limit);
  }
}

/**
 * Best score for a single query token against all tokens of one symbol:
 * a full exact match if any symbol token equals it, otherwise the best
 * substring (partial) match, otherwise zero.
 */
function bestTokenMatch(queryToken: string, symbolTokens: readonly string[]): number {
  let best = 0;
  for (const symbolToken of symbolTokens) {
    if (symbolToken === queryToken) {
      return EXACT_MATCH_SCORE; // can't beat exact — short-circuit
    }
    if (symbolToken.includes(queryToken) || queryToken.includes(symbolToken)) {
      best = Math.max(best, PARTIAL_MATCH_SCORE);
    }
  }
  return best;
}

/** Split a free-text query into raw word chunks on any non-alphanumeric run. */
function splitWords(text: string): string[] {
  return text.split(/[^A-Za-z0-9]+/).filter((w) => w.length > 0);
}

/**
 * Break a code identifier into lowercase lexical tokens, understanding the
 * conventions the parser emits: camelCase, PascalCase, snake_case, and
 * embedded acronyms (`verifyJWT` → ['verify', 'jwt'], `HTTPServer` →
 * ['http', 'server']).
 */
function tokenizeIdentifier(name: string): string[] {
  const withBoundaries = name
    // insert a space between a lower/digit and a following upper: verifyJWT -> verify JWT
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    // insert a space between an acronym run and a following Capitalized word:
    // JWTUtils -> JWT Utils
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');

  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const chunk of splitWords(withBoundaries)) {
    const token = chunk.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Descending weight; ties broken alphabetically for stable, deterministic output. */
function byWeightThenName(a: SeedNode, b: SeedNode): number {
  if (b.weight !== a.weight) return b.weight - a.weight;
  return a.symbol.name.localeCompare(b.symbol.name);
}
