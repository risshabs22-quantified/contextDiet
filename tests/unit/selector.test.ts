import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { DependencyGraphResolver } from '../../src/core/graph/index';
import { GraphSelector } from '../../src/core/graph/selector';
import { LexicalRanker } from '../../src/core/ranker/index';
import type { DependencyGraph } from '../../src/core/graph/types';
import type { Selector } from '../../src/core/graph/selector';
import type { SeedNode } from '../../src/core/ranker/types';
import type { SymbolNode } from '../../src/core/parser/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONO = path.resolve(HERE, '../fixtures/monolith-auth-app/src');
const P = (rel: string): string => path.join(MONO, rel);

describe('GraphSelector (monolith-auth-app)', () => {
  const selector: Selector = new GraphSelector();
  let graph: DependencyGraph;

  beforeAll(async () => {
    graph = await new DependencyGraphResolver().buildGraph(MONO);
  });

  const seedSymbol = (relPath: string, name: string): SymbolNode => {
    const node = graph.nodes.get(P(relPath));
    const symbol = node?.symbols.find((s) => s.name === name);
    if (symbol === undefined) throw new Error(`fixture missing ${name} in ${relPath}`);
    return symbol;
  };

  describe('explicit seed (ranker-independent)', () => {
    let seeds: SeedNode[];
    beforeAll(() => {
      seeds = [{ symbol: seedSymbol('utils/jwtUtils.ts', 'verifyToken'), weight: 1, matchedTokens: ['jwt'] }];
    });

    it('keeps the seed file and follows dependency edges to the leaf (crypto)', () => {
      const selection = selector.select(seeds, graph, { hops: 3 });
      expect(selection.has(P('utils/jwtUtils.ts'))).toBe(true);
      expect(selection.has(P('utils/crypto.ts'))).toBe(true);
    });

    it('slices away the entire unrelated billing/pdf/analytics subgraph', () => {
      const selection = selector.select(seeds, graph, { hops: 3 });
      expect(selection.has(P('routes/billing.ts'))).toBe(false);
      expect(selection.has(P('utils/pdfGenerator.ts'))).toBe(false);
      expect(selection.has(P('services/analytics.ts'))).toBe(false);
    });

    it('follows dependencies, not dependents (index/auth import jwt but are not kept)', () => {
      const selection = selector.select(seeds, graph, { hops: 3 });
      expect(selection.has(P('index.ts'))).toBe(false);
      expect(selection.has(P('routes/auth.ts'))).toBe(false);
    });

    it('keeps whole files at symbol granularity', () => {
      const selection = selector.select(seeds, graph, { hops: 3 });
      expect([...(selection.get(P('utils/crypto.ts')) ?? [])]).toContain('hmacSha256');
      expect([...(selection.get(P('utils/jwtUtils.ts')) ?? [])]).toEqual(
        expect.arrayContaining(['verifyToken', 'signToken']),
      );
    });

    it('respects the hop limit (hops: 0 keeps only the seed file)', () => {
      const selection = selector.select(seeds, graph, { hops: 0 });
      expect(selection.has(P('utils/jwtUtils.ts'))).toBe(true);
      expect(selection.has(P('utils/crypto.ts'))).toBe(false);
    });

    it('returns an empty selection for no seeds', () => {
      expect(selector.select([], graph, { hops: 3 }).size).toBe(0);
    });
  });

  describe('end-to-end with the LexicalRanker', () => {
    it('turns a focus string into a keep-set spanning the JWT chain only', () => {
      const allSymbols = [...graph.nodes.values()].flatMap((n) => n.symbols);
      const seeds = new LexicalRanker().determineSeeds('Fix the JWT verification bug', allSymbols);
      expect(seeds.length).toBeGreaterThan(0);

      const selection = selector.select(seeds, graph, { hops: 3 });
      expect(selection.has(P('utils/jwtUtils.ts'))).toBe(true);
      expect(selection.has(P('utils/crypto.ts'))).toBe(true);
      // The unrelated subgraphs never enter the keep-set.
      expect(selection.has(P('routes/billing.ts'))).toBe(false);
      expect(selection.has(P('utils/pdfGenerator.ts'))).toBe(false);
      expect(selection.has(P('services/analytics.ts'))).toBe(false);
    });
  });
});
