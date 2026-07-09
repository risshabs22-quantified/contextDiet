/**
 * ast-grep–backed implementation of the {@link Parser} contract (Task 1.0).
 *
 * Uses `@ast-grep/napi` to parse TypeScript into a concrete syntax tree, then
 * walks it to extract import bindings and top-level symbols. All node access is
 * defensive: tree-sitter is error-tolerant, so we validate the tree for ERROR
 * nodes up front and translate failures into {@link ParseError}.
 */

import { parse, Lang, type SgNode } from '@ast-grep/napi';
import { ParseError } from './types.js';
import type {
  DependencyRef,
  ImportNode,
  ImportKind,
  ImportStatement,
  Parser,
  Range,
  SymbolKind,
  SymbolNode,
} from './types.js';

/** tree-sitter kinds for the declarations we surface, mapped to our SymbolKind. */
const DECLARATION_KINDS: ReadonlyMap<string, SymbolKind> = new Map([
  ['class_declaration', 'class'],
  ['abstract_class_declaration', 'class'],
  ['function_declaration', 'function'],
  ['generator_function_declaration', 'function'],
  ['interface_declaration', 'interface'],
  ['type_alias_declaration', 'type'],
  ['enum_declaration', 'enum'],
]);

/** Declaration kinds that bind one-or-more names via `variable_declarator` children. */
const VARIABLE_DECLARATION_KINDS: ReadonlySet<string> = new Set([
  'lexical_declaration',
  'variable_declaration',
]);

export class AstGrepperParser implements Parser {
  async extractImports(source: string, filePath: string): Promise<ImportNode[]> {
    const root = this.parseOrThrow(source, filePath);
    const imports: ImportNode[] = [];

    for (const statement of root.findAll({ rule: { kind: 'import_statement' } })) {
      const sourceNode = statement.field('source');
      if (sourceNode === null) continue; // defensive: malformed-but-tolerated import
      const moduleSource = stripQuotes(sourceNode.text());

      const clause = statement.children().find((c) => c.kind() === 'import_clause');
      if (clause === undefined) continue; // side-effect import: `import './x'` — no bindings

      for (const child of clause.children()) {
        this.collectClauseBindings(child, moduleSource, filePath, imports);
      }
    }

    return sortByStart(imports);
  }

  async extractSymbols(source: string, filePath: string): Promise<SymbolNode[]> {
    const root = this.parseOrThrow(source, filePath);
    const symbols: SymbolNode[] = [];

    // Only TOP-LEVEL declarations are addressable symbols: we walk the program's
    // direct statements rather than `findAll`, so nested locals (loop variables,
    // inner functions, block-scoped consts) are never mistaken for module symbols.
    for (const statement of root.children()) {
      if (statement.kind() === 'export_statement') {
        for (const declaration of statement.children()) {
          this.collectDeclaration(declaration, filePath, symbols, true, statement);
        }
      } else {
        this.collectDeclaration(statement, filePath, symbols, false, null);
      }
    }

    return sortByStart(symbols);
  }

  async extractDependencies(source: string, filePath: string): Promise<DependencyRef[]> {
    const root = this.parseOrThrow(source, filePath);
    const deps: DependencyRef[] = [];

    // `import … from 'x'` — every import_statement carries a `source` field
    // (including side-effect imports `import 'x'`).
    for (const statement of root.findAll({ rule: { kind: 'import_statement' } })) {
      const sourceNode = statement.field('source');
      if (sourceNode === null) continue;
      deps.push({
        kind: 'import',
        source: stripQuotes(sourceNode.text()),
        filePath,
        range: toRange(statement.range()),
      });
    }

    // Re-exports: `export … from 'x'`, `export * from 'x'`, `export * as ns from 'x'`.
    // A plain `export const …` has no `source` field and is NOT a dependency.
    for (const statement of root.findAll({ rule: { kind: 'export_statement' } })) {
      const sourceNode = statement.field('source');
      if (sourceNode === null) continue;
      deps.push({
        kind: 're-export',
        source: stripQuotes(sourceNode.text()),
        filePath,
        range: toRange(statement.range()),
      });
    }

    return sortByStart(deps);
  }

  async extractImportStatements(source: string, filePath: string): Promise<ImportStatement[]> {
    const root = this.parseOrThrow(source, filePath);
    const statements: ImportStatement[] = [];

    for (const statement of root.findAll({ rule: { kind: 'import_statement' } })) {
      const sourceNode = statement.field('source');
      if (sourceNode === null) continue;
      const clause = statement.children().find((c) => c.kind() === 'import_clause');
      statements.push({
        source: stripQuotes(sourceNode.text()),
        localNames: clause === undefined ? [] : collectLocalNames(clause),
        filePath,
        range: toRange(statement.range()),
      });
    }

    return sortByStart(statements);
  }

  async collectReferences(
    source: string,
    filePath: string,
    ranges: readonly Range[],
  ): Promise<Set<string>> {
    const used = new Set<string>();
    if (ranges.length === 0) return used;

    const root = this.parseOrThrow(source, filePath);
    // Value references are `identifier`; type references (for type-only imports)
    // are `type_identifier`. Property names (`obj.prop`) are `property_identifier`
    // and intentionally excluded — they are not import bindings.
    const identifiers = [
      ...root.findAll({ rule: { kind: 'identifier' } }),
      ...root.findAll({ rule: { kind: 'type_identifier' } }),
    ];

    for (const node of identifiers) {
      const start = node.range().start.index;
      for (const range of ranges) {
        if (start >= range.start.index && start < range.end.index) {
          used.add(node.text());
          break;
        }
      }
    }

    return used;
  }

  sliceNode(source: string, range: Range): string {
    return source.slice(range.start.index, range.end.index);
  }

  // --- internals ----------------------------------------------------------

  /** Parse to a root node, translating any syntax error into a {@link ParseError}. */
  private parseOrThrow(source: string, filePath: string): SgNode {
    let root: SgNode;
    try {
      root = parse(Lang.TypeScript, source).root();
    } catch (cause) {
      throw new ParseError(`Failed to parse ${filePath}`, filePath, { cause });
    }
    if (hasErrorNode(root)) {
      throw new ParseError(`Malformed syntax in ${filePath}`, filePath);
    }
    return root;
  }

  /** Translate one child of an `import_clause` into zero or more bindings. */
  private collectClauseBindings(
    child: SgNode,
    source: string,
    filePath: string,
    out: ImportNode[],
  ): void {
    switch (child.kind()) {
      case 'identifier': {
        // `import path from '...'`
        const name = child.text();
        out.push(this.makeImport('default', name, name, source, filePath, child.range()));
        return;
      }
      case 'namespace_import': {
        // `import * as os from '...'`
        const id = child.children().find((n) => n.kind() === 'identifier');
        if (id === undefined) return;
        out.push(this.makeImport('namespace', id.text(), '*', source, filePath, child.range()));
        return;
      }
      case 'named_imports': {
        // `import { a, b as c } from '...'`
        for (const spec of child.children().filter((n) => n.kind() === 'import_specifier')) {
          const nameNode = spec.field('name');
          if (nameNode === null) continue;
          const importedName = nameNode.text();
          const aliasNode = spec.field('alias');
          const localName = aliasNode === null ? importedName : aliasNode.text();
          out.push(
            this.makeImport('named', localName, importedName, source, filePath, spec.range()),
          );
        }
        return;
      }
      default:
        return; // `import`/`from`/`,`/`type` keyword tokens — nothing to bind
    }
  }

  private makeImport(
    kind: ImportKind,
    localName: string,
    importedName: string,
    source: string,
    filePath: string,
    range: Range,
  ): ImportNode {
    return { kind, localName, importedName, source, filePath, range: toRange(range) };
  }

  /**
   * Turn one top-level declaration into zero or more symbols.
   *
   * `exported` and `exportStatement` come from the caller's position in the tree
   * (whether this declaration sat inside an `export_statement`). For exported
   * declarations the range widens to the whole `export …` statement so a slice
   * reproduces a self-contained, re-emittable chunk (with the `export` keyword).
   */
  private collectDeclaration(
    node: SgNode,
    filePath: string,
    out: SymbolNode[],
    exported: boolean,
    exportStatement: SgNode | null,
  ): void {
    const nodeKind = String(node.kind());
    const range = toRange(exported && exportStatement !== null ? exportStatement.range() : node.range());

    const mapped = DECLARATION_KINDS.get(nodeKind);
    if (mapped !== undefined) {
      const nameNode = node.field('name');
      if (nameNode === null) return; // anonymous default export — no addressable symbol
      out.push({ name: nameNode.text(), kind: mapped, exported, filePath, range });
      return;
    }

    if (VARIABLE_DECLARATION_KINDS.has(nodeKind)) {
      // `const`/`let`/`var` may bind several names in one statement.
      for (const declarator of node.children().filter((c) => c.kind() === 'variable_declarator')) {
        const nameNode = declarator.field('name');
        if (nameNode === null) continue; // destructuring pattern — out of scope for Task 1.0
        out.push({ name: nameNode.text(), kind: 'variable', exported, filePath, range });
      }
    }
  }
}

// --- module-private helpers -----------------------------------------------

/** Collect every local binding name introduced by an `import_clause`. */
function collectLocalNames(clause: SgNode): string[] {
  const names: string[] = [];
  for (const child of clause.children()) {
    switch (child.kind()) {
      case 'identifier': // default import
        names.push(child.text());
        break;
      case 'namespace_import': {
        const id = child.children().find((n) => n.kind() === 'identifier');
        if (id !== undefined) names.push(id.text());
        break;
      }
      case 'named_imports':
        for (const spec of child.children().filter((n) => n.kind() === 'import_specifier')) {
          const local = spec.field('alias') ?? spec.field('name');
          if (local !== null) names.push(local.text());
        }
        break;
      default:
        break;
    }
  }
  return names;
}

/** Depth-first scan for tree-sitter ERROR nodes (the signal of malformed syntax). */
function hasErrorNode(node: SgNode): boolean {
  if (node.kind() === 'ERROR') return true;
  return node.children().some(hasErrorNode);
}

/** Strip a single matching pair of surrounding quotes (single, double, or backtick). */
function stripQuotes(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if (first === last && (first === "'" || first === '"' || first === '`')) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Normalize a native range into our plain, structurally-cloned {@link Range}. */
function toRange(range: Range): Range {
  return {
    start: { line: range.start.line, column: range.start.column, index: range.start.index },
    end: { line: range.end.line, column: range.end.column, index: range.end.index },
  };
}

/** Stable source-order sort by start offset. */
function sortByStart<T extends { range: Range }>(items: T[]): T[] {
  return items.sort((a, b) => a.range.start.index - b.range.start.index);
}
