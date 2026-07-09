/**
 * DependencyGraphResolver (Task 2.0).
 *
 * Builds a {@link DependencyGraph} for a codebase by:
 *   1. enumerating source files under the root (skipping `node_modules`/dotdirs),
 *   2. parsing each with the {@link Parser} to get symbols + dependency specifiers,
 *   3. resolving each specifier to an absolute file path (or marking it external).
 *
 * Cycle safety: the graph is built by filesystem enumeration + per-file edge
 * resolution — NOT by recursively following imports. Import cycles therefore
 * cannot cause infinite loops or stack overflow at build time; they simply appear
 * as cycles in the adjacency data. Consumers that walk the graph must use a
 * visited set — see {@link collectReachable}.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AstGrepperParser } from '../parser/index.js';
import { ParseError } from '../parser/types.js';
import type { Parser } from '../parser/types.js';
import type {
  DependencyEdge,
  DependencyGraph,
  GraphNode,
  GraphResolver,
} from './types.js';

/** Extensions we treat as parseable source. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/** JS-family extensions an ESM specifier may use to point at a TS-family file. */
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);
const TS_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts'];
/** Directory names never descended into. */
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

export class DependencyGraphResolver implements GraphResolver {
  private readonly parser: Parser;

  constructor(parser: Parser = new AstGrepperParser()) {
    this.parser = parser;
  }

  async buildGraph(rootDir: string): Promise<DependencyGraph> {
    const root = path.resolve(rootDir);
    const files = await collectSourceFiles(root);
    files.sort();

    const nodes = new Map<string, GraphNode>();
    for (const filePath of files) {
      nodes.set(filePath, await this.buildNode(root, filePath));
    }

    // Derive the traversable adjacency list: first-party edges only, deduped,
    // and only pointing at files that are actually nodes in this graph.
    const adjacency = new Map<string, readonly string[]>();
    for (const [filePath, node] of nodes) {
      const seen = new Set<string>();
      const neighbours: string[] = [];
      for (const edge of node.dependencies) {
        const target = edge.resolvedPath;
        if (target !== null && nodes.has(target) && !seen.has(target)) {
          seen.add(target);
          neighbours.push(target);
        }
      }
      adjacency.set(filePath, neighbours);
    }

    return { rootDir: root, nodes, adjacency };
  }

  private async buildNode(root: string, filePath: string): Promise<GraphNode> {
    const source = await fs.readFile(filePath, 'utf8');

    let symbols: GraphNode['symbols'] = [];
    let dependencies: DependencyEdge[] = [];
    try {
      symbols = await this.parser.extractSymbols(source, filePath);
      const refs = await this.parser.extractDependencies(source, filePath);
      dependencies = await Promise.all(
        refs.map(async (ref): Promise<DependencyEdge> => {
          const resolvedPath = await resolveSpecifier(ref.source, path.dirname(filePath));
          return {
            kind: ref.kind,
            specifier: ref.source,
            resolvedPath,
            external: resolvedPath === null,
          };
        }),
      );
    } catch (error) {
      // A single unparseable file must not sink the whole graph: record it as a
      // node with no symbols/edges so the rest of the codebase still maps.
      if (!(error instanceof ParseError)) throw error;
    }

    return {
      filePath,
      relativePath: path.relative(root, filePath),
      symbols,
      dependencies,
    };
  }
}

/**
 * Iteratively collect every node reachable from `startPath` (inclusive), up to
 * `maxHops` edges away. Uses a visited set + explicit queue, so cycles terminate
 * and deep graphs never overflow the call stack.
 */
export function collectReachable(
  graph: DependencyGraph,
  startPath: string,
  maxHops: number = Number.POSITIVE_INFINITY,
): Set<string> {
  const start = path.resolve(startPath);
  const visited = new Set<string>();
  if (!graph.nodes.has(start)) return visited;

  visited.add(start);
  let frontier: string[] = [start];
  let depth = 0;

  while (frontier.length > 0 && depth < maxHops) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const neighbour of graph.adjacency.get(current) ?? []) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    frontier = next;
    depth += 1;
  }

  return visited;
}

// --- module-private helpers -----------------------------------------------

/** Depth-limited-free directory walk (over the acyclic dir tree) for source files. */
async function collectSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;

    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir (e.g. permissions) — skip, don't crash the build
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // `isDirectory()` is false for symlinks, so symlinked dirs are skipped —
      // another reason the walk can't cycle.
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        out.push(full);
      }
    }
  }

  return out;
}

/**
 * Resolve a module specifier to an absolute file path, or `null` if it is
 * external (bare package, `node:` builtin) or cannot be found on disk.
 *
 * Only relative specifiers (`.`/`..`) are ever resolved — everything else is,
 * by definition, beyond the `node_modules` boundary.
 */
async function resolveSpecifier(specifier: string, importerDir: string): Promise<string | null> {
  if (!specifier.startsWith('.')) return null; // bare / node: / absolute-package → external

  const base = path.resolve(importerDir, specifier);
  for (const candidate of candidatePaths(base)) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

/** Ordered candidate paths for a resolved base (extension + index resolution). */
function candidatePaths(base: string): string[] {
  const candidates: string[] = [];
  const ext = path.extname(base);

  if (ext !== '') {
    candidates.push(base); // e.g. './x.ts' written explicitly
    if (JS_EXTENSIONS.has(ext)) {
      // ESM-style './x.js' specifier that actually targets a TS source file.
      const stem = base.slice(0, -ext.length);
      for (const tsExt of TS_EXTENSIONS) candidates.push(stem + tsExt);
    }
  } else {
    for (const sourceExt of SOURCE_EXTENSIONS) candidates.push(base + sourceExt);
  }

  // Directory import: `./dir` → `./dir/index.*`
  for (const sourceExt of SOURCE_EXTENSIONS) {
    candidates.push(path.join(base, `index${sourceExt}`));
  }

  return candidates;
}

async function isFile(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}
