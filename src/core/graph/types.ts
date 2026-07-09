/**
 * Dependency-graph contracts for ContextDiet (Task 2.0).
 *
 * The graph is the map the Selector (Task 3.0) walks to decide which code to keep
 * for a given `--focus`. It is a pure data structure: nodes (files) plus an
 * adjacency list of first-party edges. Cycles are represented directly — the graph
 * never resolves them away, so consumers must traverse with a visited set
 * (see `collectReachable`).
 */

import type { DependencyRefKind, SymbolNode } from '../parser/types.js';

/**
 * A single resolved outward edge from a file to a module it depends on.
 *
 * `resolvedPath` is the absolute path of the target file when the specifier
 * points at first-party source; it is `null` for anything beyond the project
 * boundary (bare package specifiers, `node:` builtins, unresolvable paths), in
 * which case `external` is `true`. External edges are recorded but never
 * traversed — the `node_modules` boundary is strict.
 */
export interface DependencyEdge {
  readonly kind: DependencyRefKind;
  /** The specifier exactly as written in source (e.g. `./b`, `node:fs`, `express`). */
  readonly specifier: string;
  /** Absolute path of the target file, or `null` if external/unresolvable. */
  readonly resolvedPath: string | null;
  /** True when the edge crosses the project boundary (not traversed). */
  readonly external: boolean;
}

/** One file in the graph: its identity, its symbols, and its outward edges. */
export interface GraphNode {
  /** Absolute path of this file (also its key in {@link DependencyGraph.nodes}). */
  readonly filePath: string;
  /** Path relative to the graph root — stable and display-friendly. */
  readonly relativePath: string;
  /** Top-level declarations in this file (from the parser). */
  readonly symbols: readonly SymbolNode[];
  /** Every outward dependency (imports + re-exports), resolved to disk. */
  readonly dependencies: readonly DependencyEdge[];
}

/**
 * The whole codebase as a directed graph.
 *
 * `adjacency` is the derived, deduped view used for traversal: it contains only
 * first-party edges (external dependencies excluded). It may contain cycles.
 */
export interface DependencyGraph {
  /** Absolute root the graph was built from. */
  readonly rootDir: string;
  /** All file nodes, keyed by absolute path. */
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** file abs path → abs paths of the first-party files it depends on (deduped). */
  readonly adjacency: ReadonlyMap<string, readonly string[]>;
}

/** Builds a {@link DependencyGraph} for a codebase rooted at `rootDir`. */
export interface GraphResolver {
  buildGraph(rootDir: string): Promise<DependencyGraph>;
}
