import { describe, it, expect } from 'vitest';
import { LexicalRanker } from '../../src/core/ranker/index.js';
import type { Ranker, SeedNode } from '../../src/core/ranker/types.js';
import type { SymbolNode, SymbolKind } from '../../src/core/parser/types.js';

/**
 * Minimal SymbolNode factory. The ranker only cares about `name` (and, for
 * tie-breaking/observability, `exported`), so the range/position fields are
 * filled with harmless zeros.
 */
function sym(name: string, kind: SymbolKind = 'function', exported = true): SymbolNode {
  return {
    name,
    kind,
    exported,
    filePath: `src/${name}.ts`,
    range: {
      start: { line: 0, column: 0, index: 0 },
      end: { line: 0, column: 0, index: name.length },
    },
  };
}

function weightOf(seeds: SeedNode[], name: string): number {
  return seeds.find((s) => s.symbol.name === name)?.weight ?? 0;
}

describe('LexicalRanker', () => {
  const ranker: Ranker = new LexicalRanker();

  describe('tokenize', () => {
    it('extracts meaningful tokens from a focus query, dropping stop words', () => {
      expect(ranker.tokenize('Fix JWT auth')).toEqual(['jwt', 'auth']);
    });

    it('strips common stop/filler words like "the", "a", "bug", "fix"', () => {
      expect(ranker.tokenize('Fix the JWT auth bug')).toEqual(['jwt', 'auth']);
    });

    it('is case-insensitive and normalizes to lowercase', () => {
      expect(ranker.tokenize('VERIFY Jwt AUTH')).toEqual(['verify', 'jwt', 'auth']);
    });

    it('splits on punctuation and collapses duplicates', () => {
      expect(ranker.tokenize('auth, auth; authentication!')).toEqual(['auth', 'authentication']);
    });

    it('returns an empty array for an all-stop-word or empty query', () => {
      expect(ranker.tokenize('   the a of  ')).toEqual([]);
      expect(ranker.tokenize('')).toEqual([]);
    });
  });

  describe('determineSeeds', () => {
    const symbols: SymbolNode[] = [
      sym('verifyJWT'),
      sym('authMiddleware'),
      sym('signToken'),
      sym('paymentProcessor'),
      sym('renderPdf'),
      sym('AnalyticsEngine', 'class'),
    ];

    it('matches symbols relevant to the query', () => {
      const seeds = ranker.determineSeeds('Fix JWT auth', symbols);
      const names = seeds.map((s) => s.symbol.name);
      expect(names).toContain('verifyJWT');
      expect(names).toContain('authMiddleware');
    });

    it('scores unrelated symbols at or near zero and excludes them from seeds', () => {
      const seeds = ranker.determineSeeds('Fix JWT auth', symbols);
      const names = seeds.map((s) => s.symbol.name);
      expect(names).not.toContain('paymentProcessor');
      expect(names).not.toContain('renderPdf');
      // The full-scored space still assigns payment a zero relevance.
      const scored = ranker.determineSeeds('Fix JWT auth', [sym('paymentProcessor')]);
      expect(scored).toEqual([]);
    });

    it('ranks a stronger match above a weaker one (JWT beats generic auth)', () => {
      const seeds = ranker.determineSeeds('Fix JWT auth', symbols);
      expect(weightOf(seeds, 'verifyJWT')).toBeGreaterThan(0);
      expect(weightOf(seeds, 'authMiddleware')).toBeGreaterThan(0);
      // Results are ordered by descending weight.
      const weights = seeds.map((s) => s.weight);
      expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    });

    it('is case-insensitive when matching symbol names', () => {
      const seeds = ranker.determineSeeds('jwt', [sym('VerifyJWT'), sym('JwtUtils')]);
      expect(seeds.map((s) => s.symbol.name).sort()).toEqual(['JwtUtils', 'VerifyJWT']);
    });

    it('matches whole camelCase segments as exact token matches', () => {
      // "auth" is a full camelCase segment of authMiddleware -> exact match.
      const seeds = ranker.determineSeeds('auth', [sym('authMiddleware'), sym('paymentProcessor')]);
      expect(seeds.map((s) => s.symbol.name)).toEqual(['authMiddleware']);
      expect(weightOf(seeds, 'authMiddleware')).toBe(1);
    });

    it('supports true partial (substring) matches with a reduced weight', () => {
      // "verif" is a substring of the "verify" token, not a full token -> partial.
      const seeds = ranker.determineSeeds('verif', [sym('verifyJWT')]);
      expect(seeds.map((s) => s.symbol.name)).toEqual(['verifyJWT']);
      expect(weightOf(seeds, 'verifyJWT')).toBeGreaterThan(0);
      expect(weightOf(seeds, 'verifyJWT')).toBeLessThan(1);
    });

    it('normalizes weights into the [0, 1] range', () => {
      const seeds = ranker.determineSeeds('verify jwt auth token', symbols);
      for (const seed of seeds) {
        expect(seed.weight).toBeGreaterThan(0);
        expect(seed.weight).toBeLessThanOrEqual(1);
      }
    });

    it('records which query tokens contributed to each match', () => {
      const seeds = ranker.determineSeeds('Fix JWT auth', symbols);
      const verify = seeds.find((s) => s.symbol.name === 'verifyJWT');
      expect(verify?.matchedTokens).toContain('jwt');
    });

    it('returns no seeds for an empty query', () => {
      expect(ranker.determineSeeds('', symbols)).toEqual([]);
    });

    it('honors the limit option, keeping the highest-weighted seeds', () => {
      const limited = new LexicalRanker({ limit: 1 });
      const seeds = limited.determineSeeds('Fix JWT auth', symbols);
      expect(seeds).toHaveLength(1);
      expect(seeds[0]?.symbol.name).toBe('verifyJWT');
    });

    it('honors the minWeight threshold', () => {
      const strict = new LexicalRanker({ minWeight: 0.99 });
      // "middlewar" is a substring of the "middleware" token but not a full
      // token match, so it scores as a partial (< 0.99) and is filtered out.
      const seeds = strict.determineSeeds('middlewar', [sym('authMiddleware')]);
      expect(seeds).toEqual([]);
      // Sanity: without the strict bar, the partial match is still surfaced.
      const relaxed = new LexicalRanker();
      expect(relaxed.determineSeeds('middlewar', [sym('authMiddleware')])).toHaveLength(1);
    });

    it('is deterministic: identical inputs yield identical output', () => {
      const a = ranker.determineSeeds('Fix JWT auth bug', symbols);
      const b = ranker.determineSeeds('Fix JWT auth bug', symbols);
      expect(a).toEqual(b);
    });
  });
});
