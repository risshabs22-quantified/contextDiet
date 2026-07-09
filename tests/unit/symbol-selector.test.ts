import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DependencyGraphResolver } from '../../src/core/graph/index';
import { ReferenceClosureSelector } from '../../src/core/graph/symbol-selector';
import type { DependencyGraph } from '../../src/core/graph/types';
import type { SeedNode } from '../../src/core/ranker/types';
import type { SymbolNode } from '../../src/core/parser/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONO = path.resolve(HERE, '../fixtures/monolith-auth-app/src');
const P = (rel: string): string => path.join(MONO, rel);

describe('ReferenceClosureSelector (symbol-level, monolith-auth-app)', () => {
  const selector = new ReferenceClosureSelector();
  let graph: DependencyGraph;
  let sources: Map<string, string>;

  beforeAll(async () => {
    graph = await new DependencyGraphResolver().buildGraph(MONO);
    sources = new Map();
    for (const file of graph.nodes.keys()) sources.set(file, await fs.readFile(file, 'utf8'));
  });

  const seedFor = (relPath: string, name: string): SeedNode => {
    const symbol = graph.nodes.get(P(relPath))?.symbols.find((s) => s.name === name);
    if (symbol === undefined) throw new Error(`fixture missing ${name} in ${relPath}`);
    return { symbol, weight: 1, matchedTokens: [name] };
  };

  describe('seeding verifyToken', () => {
    let selection: Awaited<ReturnType<ReferenceClosureSelector['select']>>;
    beforeAll(async () => {
      selection = await selector.select([seedFor('utils/jwtUtils.ts', 'verifyToken')], graph, sources, {
        hops: 3,
      });
    });

    it('keeps the seed and its intra-file reference closure', () => {
      const jwt = selection.get(P('utils/jwtUtils.ts'));
      expect(jwt).toBeDefined();
      // verifyToken directly/transitively uses these same-file symbols:
      for (const name of ['verifyToken', 'sign', 'TokenError', 'timingSafeEqual', 'base64UrlDecode', 'base64UrlEncode', 'JwtPayload']) {
        expect(jwt).toContain(name);
      }
    });

    it('OMITS same-file symbols the seed never references (the whole point)', () => {
      const jwt = selection.get(P('utils/jwtUtils.ts'));
      // signToken / SignOptions / DEFAULT_TTL_SECONDS are unrelated to verification.
      expect(jwt).not.toContain('signToken');
      expect(jwt).not.toContain('SignOptions');
    });

    it('follows a cross-file reference (verifyToken → sign → hmacSha256 in crypto)', () => {
      const crypto = selection.get(P('utils/crypto.ts'));
      expect(crypto).toBeDefined();
      // hmacSha256 and its own helpers are pulled in...
      for (const name of ['hmacSha256', 'simpleDigest', 'utf8Bytes', 'toHex']) {
        expect(crypto).toContain(name);
      }
      // ...but crypto symbols unrelated to hmac are NOT.
      expect(crypto).not.toContain('hashPassword');
      expect(crypto).not.toContain('verifyPassword');
    });

    it('still slices the unrelated billing/pdf/analytics subgraph entirely', () => {
      expect(selection.has(P('routes/billing.ts'))).toBe(false);
      expect(selection.has(P('utils/pdfGenerator.ts'))).toBe(false);
      expect(selection.has(P('services/analytics.ts'))).toBe(false);
    });
  });

  it('a leaf type seed (JwtPayload) keeps only itself — maximal precision', async () => {
    const selection = await selector.select([seedFor('utils/jwtUtils.ts', 'JwtPayload')], graph, sources, {
      hops: 3,
    });
    expect([...(selection.get(P('utils/jwtUtils.ts')) ?? [])]).toEqual(['JwtPayload']);
    // crypto is NOT dragged in — JwtPayload references no cross-file symbol.
    expect(selection.has(P('utils/crypto.ts'))).toBe(false);
  });

  it('returns an empty selection for no seeds', async () => {
    expect((await selector.select([], graph, sources, { hops: 3 })).size).toBe(0);
  });
});
