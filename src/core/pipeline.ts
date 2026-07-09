/**
 * Pipeline orchestrator (Task 4 — assembly).
 *
 * The single high-level entry point that ties every stage together:
 *
 *   Graph Resolution → Lexical Ranking → Selection → AST Pruning
 *     → Markdown Bundling → Metrics Compilation
 *
 * It depends only on the module contracts, so any stage (parser backend, ranker
 * strategy) can be swapped without touching this file.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DependencyGraphResolver } from './graph/index.js';
import { ReferenceClosureSelector } from './graph/symbol-selector.js';
import { AstPruner } from './pruner/index.js';
import { MarkdownBundler } from './bundler/index.js';
import { LexicalRanker } from './ranker/index.js';
import { computeReduction } from './metrics/index.js';
import type { BundleFile } from './bundler/index.js';
import type { ReductionMetrics } from './metrics/index.js';

export interface TrimOptions {
  /** Dependency-graph traversal depth from each seed file. Default `2`. */
  readonly hops?: number;
  /** Optional cap on the number of ranked seeds. */
  readonly seedLimit?: number;
}

export interface TrimResult {
  readonly rootDir: string;
  readonly focus: string;
  /** The final dense Markdown stream. */
  readonly bundle: string;
  readonly metrics: ReductionMetrics;
  /** Total source files discovered under the root. */
  readonly totalFiles: number;
  /** Repo-relative paths of the files that survived, sorted. */
  readonly keptFiles: readonly string[];
  /** How many seed symbols the ranker matched for the focus. */
  readonly seedCount: number;
}

/**
 * Trim a codebase to just the code relevant to `focus`, returning the dense
 * bundle plus efficiency metrics. Pure w.r.t. the filesystem except for reading
 * the source files under `rootDir` (never writes).
 */
export async function trim(
  rootDir: string,
  focus: string,
  options: TrimOptions = {},
): Promise<TrimResult> {
  const root = path.resolve(rootDir);

  // 1. Graph resolution.
  const graph = await new DependencyGraphResolver().buildGraph(root);

  // Read every discovered file once: the baseline for metrics AND the source of
  // truth the pruner slices from.
  const sources = new Map<string, string>();
  for (const filePath of graph.nodes.keys()) {
    sources.set(filePath, await fs.readFile(filePath, 'utf8'));
  }
  const baseline = [...sources.values()].join('\n');

  // 2. Lexical ranking.
  const allSymbols = [...graph.nodes.values()].flatMap((node) => node.symbols);
  const ranker = new LexicalRanker(
    options.seedLimit === undefined ? {} : { limit: options.seedLimit },
  );
  const seeds = ranker.determineSeeds(focus, allSymbols);

  // 3. Selection (symbol-level reference closure — ADR-016).
  const selection = await new ReferenceClosureSelector().select(seeds, graph, sources, {
    hops: options.hops ?? 2,
  });

  // 4. AST pruning (one bundle file per surviving source file).
  const pruner = new AstPruner();
  const bundleFiles: BundleFile[] = [];
  for (const [filePath, keep] of selection) {
    const source = sources.get(filePath);
    if (source === undefined) continue;
    const pruned = await pruner.prune(source, filePath, keep);
    if (pruned.trim().length === 0) continue;
    bundleFiles.push({ path: path.relative(root, filePath), content: pruned });
  }

  // 5. Bundling + 6. Metrics.
  const bundle = new MarkdownBundler({ sortByPath: true }).bundle(bundleFiles);
  const metrics = computeReduction(baseline, bundle);

  return {
    rootDir: root,
    focus,
    bundle,
    metrics,
    totalFiles: graph.nodes.size,
    keptFiles: bundleFiles.map((file) => file.path).sort(),
    seedCount: seeds.length,
  };
}
