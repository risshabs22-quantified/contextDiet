import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AstPruner } from '../../src/core/pruner/index';
import { AstGrepperParser } from '../../src/core/parser/index';
import type { Pruner } from '../../src/core/pruner/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONO = path.resolve(HERE, '../fixtures/monolith-auth-app/src');

describe('AstPruner', () => {
  const pruner: Pruner = new AstPruner();
  const parser = new AstGrepperParser();

  describe('the core promise: keep the focused symbol, delete the unrelated one', () => {
    // A single file holding a JWT concern and an unrelated billing concern,
    // each pulling in its own import — exactly the scenario from the brief.
    const SOURCE = `import { signToken } from "./jwt";
import { formatMoney } from "./money";

export function verifyJWT(token: string): boolean {
  return signToken(token).length > 0;
}

export function processBilling(amount: number): string {
  return formatMoney(amount);
}
`;
    const FILE = 'src/mixed.ts';
    let output: string;

    beforeAll(async () => {
      output = await pruner.prune(SOURCE, FILE, new Set(['verifyJWT']));
    });

    it('leaves verifyJWT fully intact (signature + body)', () => {
      expect(output).toContain('export function verifyJWT(token: string): boolean');
      expect(output).toContain('return signToken(token).length > 0;');
    });

    it('completely deletes the unrelated processBilling', () => {
      expect(output).not.toContain('processBilling');
    });

    it('keeps the import verifyJWT depends on', () => {
      expect(output).toContain('import { signToken } from "./jwt";');
    });

    it('removes the now-dead import only processBilling used', () => {
      expect(output).not.toContain('formatMoney');
      expect(output).not.toContain('./money');
    });

    it('emits syntactically valid code (re-parses to exactly the kept symbol)', async () => {
      const symbols = await parser.extractSymbols(output, FILE);
      expect(symbols.map((s) => s.name)).toEqual(['verifyJWT']);
    });
  });

  describe('on a real fixture file (billing.ts)', () => {
    let billingSource: string;
    const billingPath = path.join(MONO, 'routes/billing.ts');

    beforeAll(async () => {
      billingSource = await fs.readFile(billingPath, 'utf8');
    });

    it('keeps a self-contained helper and slices everything else, incl. dead imports', async () => {
      const output = await pruner.prune(billingSource, billingPath, new Set(['formatCents']));

      expect(output).toContain('function formatCents');
      // Unrelated top-level symbols are gone.
      expect(output).not.toContain('billingRouter');
      expect(output).not.toContain('computeTotalCents');
      // formatCents uses no imports → the whole import block is dead and removed.
      expect(output).not.toContain('renderPdf');
      expect(output).not.toContain('pdfGenerator');
      expect(output).not.toContain('express');

      const symbols = await parser.extractSymbols(output, billingPath);
      expect(symbols.map((s) => s.name)).toEqual(['formatCents']);
    });
  });

  describe('edge cases', () => {
    it('returns an empty string when nothing is kept', async () => {
      const out = await pruner.prune('export const gone = 1;\n', 'x.ts', new Set());
      expect(out.trim()).toBe('');
    });

    it('de-duplicates multi-binding declarations kept under one range', async () => {
      // `a` and `b` share one declaration statement; it must appear once, not twice.
      const src = 'export const a = 1, b = 2;\n';
      const out = await pruner.prune(src, 'x.ts', new Set(['a', 'b']));
      expect(out.match(/export const a = 1, b = 2;/g)).toHaveLength(1);
    });
  });
});
