/**
 * GraphSelector (Task 3.0).
 *
 * Bridges the ranker's seeds to a concrete "keep set". Given `SeedNode[]` (the
 * symbols most relevant to a focus query) and the {@link DependencyGraph}, it
 * walks dependency edges N hops out from each seed's file and returns exactly
 * which symbols in which files are allowed to survive.
 *
 * Granularity note (see ADR-011): the dependency graph is file-level, so
 * selection keeps *whole reachable files* — every top-level symbol of a file the
 * seeds transitively depend on. The result is nonetheless expressed at symbol
 * granularity (`Map<filePath, Set<symbolName>>`) so the pruner and a future
 * symbol-level call graph need no interface change.
 */

import * as path from 'node:path';
import { collectReachable } from './index.js';
import type { DependencyGraph } from './types.js';
import type { SeedNode } from '../ranker/types.js';

/** file abs path → the set of top-level symbol names permitted to survive. */
export type Selection = ReadonlyMap<string, ReadonlySet<string>>;

export interface SelectionOptions {
  /** Dependency-graph traversal depth from each seed file. Default `2`. */
  readonly hops?: number;
}

export interface Selector {
  select(seeds: readonly SeedNode[], graph: DependencyGraph, options?: SelectionOptions): Selection;
}

const DEFAULT_HOPS = 2;

export class GraphSelector implements Selector {
  select(
    seeds: readonly SeedNode[],
    graph: DependencyGraph,
    options: SelectionOptions = {},
  ): Selection {
    const hops = options.hops ?? DEFAULT_HOPS;
    const keep = new Map<string, Set<string>>();
    if (seeds.length === 0) return keep;

    // 1. Files that directly contain a seed symbol (that are actually in the graph).
    const seedFiles = new Set<string>();
    for (const seed of seeds) {
      const file = path.resolve(seed.symbol.filePath);
      if (graph.nodes.has(file)) seedFiles.add(file);
    }

    // 2. Expand each seed file N hops along dependency edges. `collectReachable`
    //    is cycle-safe, so import cycles among reachable files terminate cleanly.
    const keepFiles = new Set<string>();
    for (const file of seedFiles) {
      for (const reached of collectReachable(graph, file, hops)) {
        keepFiles.add(reached);
      }
    }

    // 3. Whole-file granularity: every top-level symbol of each kept file survives.
    for (const file of keepFiles) {
      const node = graph.nodes.get(file);
      if (node === undefined) continue;
      keep.set(file, new Set(node.symbols.map((s) => s.name)));
    }

    return keep;
  }
}
