import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DependencyGraphResolver, collectReachable } from '../../src/core/graph/index';
import type { DependencyGraph, GraphResolver } from '../../src/core/graph/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDGE_CASES = path.resolve(HERE, '../fixtures/edge-cases-app/src');

/** Map an absolute path to its `edge-cases-app/src`-relative basename set entry. */
const base = (p: string): string => path.basename(p, '.ts');

describe('DependencyGraphResolver (edge-cases-app fixture)', () => {
  const resolver: GraphResolver = new DependencyGraphResolver();
  let graph: DependencyGraph;

  beforeAll(async () => {
    graph = await resolver.buildGraph(EDGE_CASES);
  });

  it('discovers a node for every source file under the root', () => {
    const names = [...graph.nodes.values()].map((n) => base(n.filePath)).sort();
    expect(names).toEqual(['a', 'b', 'config', 'crypto', 'db', 'index']);
  });

  it('uses absolute paths as node keys', () => {
    for (const [key, node] of graph.nodes) {
      expect(path.isAbsolute(key)).toBe(true);
      expect(node.filePath).toBe(key);
    }
  });

  it('maps a file’s outward boundaries accurately, INCLUDING re-export edges', () => {
    const indexPath = path.join(EDGE_CASES, 'index.ts');
    const neighbours = (graph.adjacency.get(indexPath) ?? []).map(base).sort();
    // a/b/config/db via imports; crypto ONLY reachable via `export { hash } from './crypto'`.
    expect(neighbours).toEqual(['a', 'b', 'config', 'crypto', 'db']);
  });

  it('de-duplicates repeated edges to the same module', () => {
    // index.ts imports from ./config and ./db twice each; adjacency must list once.
    const indexPath = path.join(EDGE_CASES, 'index.ts');
    const neighbours = graph.adjacency.get(indexPath) ?? [];
    expect(new Set(neighbours).size).toBe(neighbours.length);
  });

  it('represents the a ↔ b cycle directly in the adjacency list', () => {
    const aPath = path.join(EDGE_CASES, 'a.ts');
    const bPath = path.join(EDGE_CASES, 'b.ts');
    expect((graph.adjacency.get(aPath) ?? []).map(base)).toEqual(['b']);
    expect((graph.adjacency.get(bPath) ?? []).map(base)).toEqual(['a']);
  });

  it('attaches parsed symbols to each node', () => {
    const cryptoPath = path.join(EDGE_CASES, 'crypto.ts');
    const names = (graph.nodes.get(cryptoPath)?.symbols ?? []).map((s) => s.name).sort();
    expect(names).toEqual(['HASH_ALGO', 'hash', 'hashHex']);
  });
});

describe('cycle safety', () => {
  const resolver = new DependencyGraphResolver();
  let graph: DependencyGraph;
  beforeAll(async () => {
    graph = await resolver.buildGraph(EDGE_CASES);
  });

  it('collectReachable terminates on a direct cycle and returns both members', () => {
    const aPath = path.join(EDGE_CASES, 'a.ts');
    const reachable = new Set([...collectReachable(graph, aPath)].map(base));
    expect(reachable).toEqual(new Set(['a', 'b']));
  });

  it('collectReachable from the entry point returns the full component without looping', () => {
    const indexPath = path.join(EDGE_CASES, 'index.ts');
    const reachable = new Set([...collectReachable(graph, indexPath)].map(base));
    expect(reachable).toEqual(new Set(['a', 'b', 'config', 'crypto', 'db', 'index']));
  });

  it('respects a hop limit', () => {
    const indexPath = path.join(EDGE_CASES, 'index.ts');
    // depth 1 from index reaches its direct neighbours only, plus index itself.
    const reachable = new Set([...collectReachable(graph, indexPath, 1)].map(base));
    expect(reachable).toEqual(new Set(['index', 'a', 'b', 'config', 'crypto', 'db']));
  });
});

describe('node_modules boundary (hermetic temp project)', () => {
  let tmpRoot: string;
  let graph: DependencyGraph;

  beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'contextdiet-graph-'));
    const src = path.join(tmpRoot, 'src');
    await fs.mkdir(path.join(src, 'node_modules', 'express'), { recursive: true });
    await fs.writeFile(
      path.join(src, 'main.ts'),
      `import { x } from './helper';\nimport fs from 'node:fs';\nimport express from 'express';\nexport const y = x;\nvoid fs; void express;\n`,
    );
    await fs.writeFile(path.join(src, 'helper.ts'), `export const x = 1;\n`);
    // A real file INSIDE node_modules — must never become a graph node.
    await fs.writeFile(path.join(src, 'node_modules', 'express', 'index.ts'), `export default 1;\n`);
    graph = await new DependencyGraphResolver().buildGraph(src);
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('never descends into node_modules', () => {
    const names = [...graph.nodes.values()].map((n) => n.relativePath).sort();
    expect(names).toEqual(['helper.ts', 'main.ts']);
  });

  it('resolves relative specifiers to internal files', () => {
    const mainPath = path.join(graph.rootDir, 'main.ts');
    const helperEdge = graph.nodes.get(mainPath)?.dependencies.find((d) => d.specifier === './helper');
    expect(helperEdge?.external).toBe(false);
    expect(helperEdge?.resolvedPath).toBe(path.join(graph.rootDir, 'helper.ts'));
  });

  it('marks bare and node: specifiers as external with no resolved path', () => {
    const mainPath = path.join(graph.rootDir, 'main.ts');
    const deps = graph.nodes.get(mainPath)?.dependencies ?? [];
    for (const spec of ['express', 'node:fs']) {
      const edge = deps.find((d) => d.specifier === spec);
      expect(edge?.external).toBe(true);
      expect(edge?.resolvedPath).toBeNull();
    }
  });

  it('excludes external edges from the traversable adjacency list', () => {
    const mainPath = path.join(graph.rootDir, 'main.ts');
    expect(graph.adjacency.get(mainPath)).toEqual([path.join(graph.rootDir, 'helper.ts')]);
  });
});
