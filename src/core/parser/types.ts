/**
 * Core parsing contracts for ContextDiet.
 *
 * The rest of the engine (graph resolver, ranker, pruner, bundler) depends only
 * on these interfaces — never on a concrete parser. That indirection is what lets
 * us swap the AST backend (ast-grep today, tree-sitter/SWC later) without a rewrite.
 */

/** A single point in a source file, mirroring ast-grep's position triple. */
export interface Position {
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based column (in UTF-8 code units). */
  readonly column: number;
  /** Absolute offset from the start of the source. */
  readonly index: number;
}

/** A half-open `[start, end)` span within a source file. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** How a binding was brought into scope. */
export type ImportKind = 'named' | 'default' | 'namespace';

/**
 * A resolved import binding.
 *
 * `localName` is the identifier usable in this file; `importedName` is the name
 * as exported by the source module. They differ only for aliased named imports
 * (`import { Foo as Bar }` → importedName `Foo`, localName `Bar`). For default
 * imports both equal the local name; for namespace imports `importedName` is `*`.
 */
export interface ImportNode {
  readonly kind: ImportKind;
  readonly localName: string;
  readonly importedName: string;
  /** The module specifier, unquoted (e.g. `node:fs/promises`, `./foo`). */
  readonly source: string;
  /** The file this import was found in. */
  readonly filePath: string;
  /** Span of the specific binding (specifier / identifier), not the whole statement. */
  readonly range: Range;
}

/** Whether an outward module reference came from an `import` or a re-`export`. */
export type DependencyRefKind = 'import' | 're-export';

/**
 * A file-level outward module reference — the raw specifier a file points at,
 * before disk resolution. Covers both `import … from 'x'` and
 * `export … from 'x'` (re-exports), since both create a dependency edge.
 *
 * This is deliberately coarser than {@link ImportNode}: the graph resolver only
 * needs "which modules does this file reach", not per-binding detail.
 */
export interface DependencyRef {
  readonly kind: DependencyRefKind;
  /** The module specifier, unquoted (e.g. `./b`, `node:fs`). */
  readonly source: string;
  readonly filePath: string;
  readonly range: Range;
}

/**
 * A whole `import … from 'x'` statement, at statement granularity.
 *
 * The pruner needs the FULL statement span (`range`) to re-emit a syntactically
 * valid import, plus every local binding it introduces (`localNames`) to decide
 * whether any kept symbol still references it. This complements {@link ImportNode}
 * (which is per-binding and finer-grained).
 */
export interface ImportStatement {
  /** The module specifier, unquoted. */
  readonly source: string;
  /** Every local binding introduced (default, namespace, and named/aliased). */
  readonly localNames: readonly string[];
  readonly filePath: string;
  /** Span of the entire import statement. */
  readonly range: Range;
}

/** The kind of a top-level declaration the pruner can keep or drop. */
export type SymbolKind =
  | 'class'
  | 'function'
  | 'variable'
  | 'interface'
  | 'type'
  | 'enum';

/**
 * A top-level declaration.
 *
 * For exported declarations `range` spans the entire `export …` statement, so
 * that {@link Parser.sliceNode} reproduces a self-contained, re-emittable chunk.
 * For internal declarations `range` spans the declaration itself.
 */
export interface SymbolNode {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly exported: boolean;
  readonly filePath: string;
  readonly range: Range;
}

/**
 * The AST backend contract. Every method is source-in / data-out and holds no
 * cross-call state, so implementations are trivially parallelizable per file.
 */
export interface Parser {
  extractImports(source: string, filePath: string): Promise<ImportNode[]>;
  extractSymbols(source: string, filePath: string): Promise<SymbolNode[]>;
  /** File-level outward module references (imports + re-exports) for graph edges. */
  extractDependencies(source: string, filePath: string): Promise<DependencyRef[]>;
  /** Whole import statements (span + local bindings) for dead-import elimination. */
  extractImportStatements(source: string, filePath: string): Promise<ImportStatement[]>;
  /**
   * The set of identifier names referenced anywhere inside the given ranges.
   * Used by the pruner to keep only the imports that surviving symbols still use.
   */
  collectReferences(
    source: string,
    filePath: string,
    ranges: readonly Range[],
  ): Promise<Set<string>>;
  /** Reproduce the exact source text covered by `range`. */
  sliceNode(source: string, range: Range): string;
}

/**
 * Raised when a source file cannot be parsed into a clean tree (syntax errors).
 *
 * The parser NEVER throws a raw/native error at callers: tree-sitter is
 * error-tolerant and would otherwise return a partial, silently-wrong tree.
 * We detect ERROR nodes and surface this explicit, catchable domain error
 * instead so the pipeline can skip the file rather than crash.
 */
export class ParseError extends Error {
  override readonly name = 'ParseError';
  readonly filePath: string;

  constructor(message: string, filePath: string, options?: { cause?: unknown }) {
    super(message, options);
    this.filePath = filePath;
  }
}
