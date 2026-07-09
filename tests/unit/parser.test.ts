import { describe, it, expect, beforeAll } from 'vitest';
import { AstGrepperParser } from '../../src/core/parser/index';
import { ParseError } from '../../src/core/parser/types';
import type { Parser, ImportNode, SymbolNode } from '../../src/core/parser/types';

const FILE = 'src/example.ts';

// A single fixture exercising every import/declaration shape Task 1.0 must handle:
// named, default, namespace, and aliased-named imports; exported + internal
// class/function/variable declarations.
const SOURCE = `import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as os from 'node:os';
import { Foo as Bar } from './foo';

export class Service {
  run(): void {}
}

export function handler(): void {}

function internalHelper(): number {
  return 42;
}

export const CONFIG = { enabled: true };
`;

describe('AstGrepperParser', () => {
  const parser: Parser = new AstGrepperParser();

  describe('extractImports', () => {
    let imports: ImportNode[];
    beforeAll(async () => {
      imports = await parser.extractImports(SOURCE, FILE);
    });

    it('extracts named imports with their source module', () => {
      const readFile = imports.find((i) => i.localName === 'readFile');
      expect(readFile).toMatchObject({
        kind: 'named',
        importedName: 'readFile',
        localName: 'readFile',
        source: 'node:fs/promises',
        filePath: FILE,
      });
      expect(imports.find((i) => i.localName === 'writeFile')?.source).toBe('node:fs/promises');
    });

    it('extracts default imports', () => {
      expect(imports.find((i) => i.localName === 'path')).toMatchObject({
        kind: 'default',
        importedName: 'path',
        source: 'node:path',
      });
    });

    it('extracts namespace imports', () => {
      expect(imports.find((i) => i.localName === 'os')).toMatchObject({
        kind: 'namespace',
        importedName: '*',
        source: 'node:os',
      });
    });

    it('resolves aliased named imports, keeping local and imported names distinct', () => {
      expect(imports.find((i) => i.localName === 'Bar')).toMatchObject({
        kind: 'named',
        importedName: 'Foo',
        localName: 'Bar',
        source: './foo',
      });
    });

    it('finds exactly the five bindings and no phantom imports', () => {
      expect(imports.map((i) => i.localName).sort()).toEqual(
        ['Bar', 'os', 'path', 'readFile', 'writeFile'].sort(),
      );
    });

    it('captures a non-empty byte range for every import', () => {
      for (const imp of imports) {
        expect(imp.range.end.index).toBeGreaterThan(imp.range.start.index);
      }
    });
  });

  describe('extractSymbols', () => {
    let symbols: SymbolNode[];
    beforeAll(async () => {
      symbols = await parser.extractSymbols(SOURCE, FILE);
    });

    it('extracts exported class declarations', () => {
      expect(symbols.find((s) => s.name === 'Service')).toMatchObject({
        kind: 'class',
        exported: true,
        filePath: FILE,
      });
    });

    it('extracts exported function declarations', () => {
      expect(symbols.find((s) => s.name === 'handler')).toMatchObject({
        kind: 'function',
        exported: true,
      });
    });

    it('distinguishes non-exported (internal) symbols', () => {
      expect(symbols.find((s) => s.name === 'internalHelper')).toMatchObject({
        kind: 'function',
        exported: false,
      });
    });

    it('extracts exported variable declarations', () => {
      expect(symbols.find((s) => s.name === 'CONFIG')).toMatchObject({
        kind: 'variable',
        exported: true,
      });
    });
  });

  describe('sliceNode', () => {
    it('returns the exact source text for an exported symbol (including the export keyword)', async () => {
      const symbols = await parser.extractSymbols(SOURCE, FILE);
      const handler = symbols.find((s) => s.name === 'handler');
      expect(handler).toBeDefined();
      expect(parser.sliceNode(SOURCE, handler!.range)).toBe('export function handler(): void {}');
    });

    it('returns the exact source text for an internal symbol', async () => {
      const symbols = await parser.extractSymbols(SOURCE, FILE);
      const helper = symbols.find((s) => s.name === 'internalHelper');
      expect(helper).toBeDefined();
      expect(parser.sliceNode(SOURCE, helper!.range)).toBe(
        'function internalHelper(): number {\n  return 42;\n}',
      );
    });
  });

  describe('extractDependencies', () => {
    const DEP_SOURCE = `import { a } from './a';
import def from './def';
export { reexported } from './crypto';
export * from './star';
export const local = 1;
`;

    it('captures import specifiers as import dependencies', async () => {
      const deps = await parser.extractDependencies(DEP_SOURCE, FILE);
      expect(deps.filter((d) => d.kind === 'import').map((d) => d.source)).toEqual(['./a', './def']);
    });

    it('captures re-exports (`export … from`) as dependencies', async () => {
      const deps = await parser.extractDependencies(DEP_SOURCE, FILE);
      expect(deps.filter((d) => d.kind === 're-export').map((d) => d.source).sort()).toEqual(
        ['./crypto', './star'].sort(),
      );
    });

    it('does NOT treat a local `export` (no `from`) as a dependency', async () => {
      const deps = await parser.extractDependencies(DEP_SOURCE, FILE);
      expect(deps.some((d) => d.source === '' || d.source === 'local')).toBe(false);
      expect(deps).toHaveLength(4);
    });
  });

  describe('extractImportStatements', () => {
    const IMP_SOURCE = `import def, { a, b as c } from './m';
import * as NS from './n';
import './side-effect';
`;

    it('returns whole-statement spans, not per-binding spans', async () => {
      const stmts = await parser.extractImportStatements(IMP_SOURCE, FILE);
      const first = stmts.find((s) => s.source === './m');
      expect(parser.sliceNode(IMP_SOURCE, first!.range)).toBe(
        "import def, { a, b as c } from './m';",
      );
    });

    it('lists every local binding (default, named, aliased, namespace)', async () => {
      const stmts = await parser.extractImportStatements(IMP_SOURCE, FILE);
      expect(stmts.find((s) => s.source === './m')?.localNames).toEqual(['def', 'a', 'c']);
      expect(stmts.find((s) => s.source === './n')?.localNames).toEqual(['NS']);
    });

    it('represents side-effect imports with no local bindings', async () => {
      const stmts = await parser.extractImportStatements(IMP_SOURCE, FILE);
      expect(stmts.find((s) => s.source === './side-effect')?.localNames).toEqual([]);
    });
  });

  describe('collectReferences', () => {
    it('finds identifiers used within the given ranges (and type identifiers)', async () => {
      const src = `import { helper } from './h';\nimport type { T } from './t';\nexport function f(x: T): number { return helper(x); }\n`;
      const symbols = await parser.extractSymbols(src, FILE);
      const f = symbols.find((s) => s.name === 'f');
      const used = await parser.collectReferences(src, FILE, [f!.range]);
      expect(used.has('helper')).toBe(true);
      expect(used.has('T')).toBe(true);
      expect(used.has('x')).toBe(true);
    });

    it('does not report identifiers outside the given ranges', async () => {
      const src = `export function keep() { return usedHere(); }\nexport function drop() { return notReferenced(); }\n`;
      const symbols = await parser.extractSymbols(src, FILE);
      const keep = symbols.find((s) => s.name === 'keep');
      const used = await parser.collectReferences(src, FILE, [keep!.range]);
      expect(used.has('usedHere')).toBe(true);
      expect(used.has('notReferenced')).toBe(false);
    });

    it('returns an empty set for no ranges', async () => {
      const used = await parser.collectReferences('const a = 1;', FILE, []);
      expect(used.size).toBe(0);
    });
  });

  describe('error handling', () => {
    it('throws a ParseError (never crashes the process) on malformed syntax', async () => {
      await expect(
        parser.extractSymbols('export function ( { const = = = }', 'broken.ts'),
      ).rejects.toBeInstanceOf(ParseError);
    });

    it('surfaces the offending filePath on the domain error', async () => {
      await expect(parser.extractImports('class {{{{', 'bad.ts')).rejects.toMatchObject({
        name: 'ParseError',
        filePath: 'bad.ts',
      });
    });
  });
});
