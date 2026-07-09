import { describe, it, expect } from 'vitest';
import {
  byteLength,
  estimateTokens,
  computeReduction,
} from '../../src/core/metrics/index.js';

describe('byteLength', () => {
  it('counts ASCII as one byte per char', () => {
    expect(byteLength('hello')).toBe(5);
  });

  it('counts multi-byte UTF-8 correctly (not UTF-16 code units)', () => {
    // "é" is 2 bytes in UTF-8; "🚀" is 4 bytes.
    expect(byteLength('é')).toBe(2);
    expect(byteLength('🚀')).toBe(4);
  });

  it('returns 0 for empty input', () => {
    expect(byteLength('')).toBe(0);
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('grows monotonically with input length', () => {
    const small = estimateTokens('const x = 1;');
    const big = estimateTokens('const x = 1; const y = 2; const z = 3;');
    expect(big).toBeGreaterThan(small);
  });

  it('treats each punctuation symbol as its own token', () => {
    // 5 distinct symbols, each ~1 token.
    expect(estimateTokens('(){}[]')).toBeGreaterThanOrEqual(6);
  });

  it('is deterministic', () => {
    const code = 'export function verifyToken(t: string): boolean { return true; }';
    expect(estimateTokens(code)).toBe(estimateTokens(code));
  });

  it('stays in a sane range for real code (roughly chars/4 order of magnitude)', () => {
    const code = 'export const authMiddleware = () => verifyToken(req.headers.authorization);';
    const tokens = estimateTokens(code);
    expect(tokens).toBeGreaterThan(code.length / 8);
    expect(tokens).toBeLessThan(code.length);
  });
});

describe('computeReduction', () => {
  it('computes an 85% reduction when 10,000 chars are trimmed to 1,500', () => {
    const original = 'ab12 '.repeat(2000); // 5 chars * 2000 = 10,000 ASCII chars/bytes
    const pruned = 'ab12 '.repeat(300); //   5 chars * 300  = 1,500 ASCII chars/bytes

    const metrics = computeReduction(original, pruned);

    expect(metrics.rawBytes).toBe(10_000);
    expect(metrics.compressedBytes).toBe(1_500);
    expect(metrics.byteReductionPercentage).toBe(85);
    // Uniform content -> tokens scale linearly, so token reduction is 85% too.
    expect(metrics.tokenReductionPercentage).toBe(85);
  });

  it('reports 0% reduction when nothing changed', () => {
    const text = 'const x = 1;';
    const metrics = computeReduction(text, text);
    expect(metrics.tokenReductionPercentage).toBe(0);
    expect(metrics.byteReductionPercentage).toBe(0);
  });

  it('never reports negative reduction if the pruned text grew', () => {
    const metrics = computeReduction('short', 'a much much longer string than before');
    expect(metrics.tokenReductionPercentage).toBe(0);
    expect(metrics.byteReductionPercentage).toBe(0);
  });

  it('handles an empty baseline without dividing by zero', () => {
    const metrics = computeReduction('', '');
    expect(metrics.rawBytes).toBe(0);
    expect(metrics.tokenReductionPercentage).toBe(0);
    expect(metrics.byteReductionPercentage).toBe(0);
  });

  it('reports a full 100% reduction when everything is pruned away', () => {
    const metrics = computeReduction('const secret = loadPrivateKey();', '');
    expect(metrics.compressedBytes).toBe(0);
    expect(metrics.compressedTokens).toBe(0);
    expect(metrics.tokenReductionPercentage).toBe(100);
    expect(metrics.byteReductionPercentage).toBe(100);
  });

  it('proves the >80% headline goal on a realistic prune ratio', () => {
    const original = 'x'.repeat(50_000);
    const pruned = 'x'.repeat(5_000); // 90% trimmed
    const metrics = computeReduction(original, pruned);
    expect(metrics.tokenReductionPercentage).toBeGreaterThan(80);
  });

  it('rounds percentages to two decimals', () => {
    const original = 'a'.repeat(3); // 3 bytes
    const pruned = 'a'.repeat(1); //   1 byte -> 66.666...% -> 66.67
    const metrics = computeReduction(original, pruned);
    expect(metrics.byteReductionPercentage).toBe(66.67);
  });
});

describe('metrics — edge cases', () => {
  it('scales linearly across a massive (multi-megabyte) token stream', () => {
    // ~5 MB of realistic-ish source text.
    const chunk = 'export const handlerFn = (req, res) => { return res.ok(); };\n';
    const original = chunk.repeat(80_000);
    const pruned = chunk.repeat(8_000); // exactly 10% kept

    const metrics = computeReduction(original, pruned);

    expect(metrics.rawBytes).toBeGreaterThan(4_000_000);
    expect(metrics.rawTokens).toBeGreaterThan(0);
    // Uniform repeated content -> byte and token reduction both ~90%.
    expect(metrics.byteReductionPercentage).toBe(90);
    expect(metrics.tokenReductionPercentage).toBeCloseTo(90, 1);
  });

  it('produces token counts that stay ordered for large vs. larger streams', () => {
    const a = estimateTokens('x'.repeat(1_000_000));
    const b = estimateTokens('x'.repeat(2_000_000));
    expect(b).toBeGreaterThan(a);
    // Never absurdly large: bounded above by the char count.
    expect(b).toBeLessThanOrEqual(2_000_000);
  });

  it('treats a whitespace-only baseline as having non-negative, sane metrics', () => {
    const metrics = computeReduction('\n\n\t   \n', '');
    expect(metrics.rawBytes).toBeGreaterThan(0);
    expect(metrics.rawTokens).toBeGreaterThan(0);
    expect(metrics.tokenReductionPercentage).toBe(100);
  });

  it('counts a whitespace-only string as at least one token, never zero', () => {
    expect(estimateTokens('     ')).toBeGreaterThanOrEqual(1);
    expect(estimateTokens('\n\n\n')).toBeGreaterThanOrEqual(1);
  });

  it('counts multi-byte content in tokens without throwing', () => {
    const emoji = '🚀'.repeat(100);
    expect(() => estimateTokens(emoji)).not.toThrow();
    expect(estimateTokens(emoji)).toBeGreaterThan(0);
  });

  it('byte reduction and token reduction can legitimately differ', () => {
    // Dense punctuation compresses differently in bytes vs. estimated tokens.
    const original = 'aaaaaaaaaaaaaaaa'; // 16 chars, few tokens
    const pruned = '(){}[]<>'; //           8 chars, but 8 punctuation tokens
    const metrics = computeReduction(original, pruned);
    // Bytes dropped 50%, but token behavior differs — both stay in [0,100].
    expect(metrics.byteReductionPercentage).toBe(50);
    expect(metrics.tokenReductionPercentage).toBeGreaterThanOrEqual(0);
    expect(metrics.tokenReductionPercentage).toBeLessThanOrEqual(100);
  });

  it('clamps to exactly 100 when pruned is empty regardless of baseline size', () => {
    for (const size of [1, 100, 10_000]) {
      const metrics = computeReduction('z'.repeat(size), '');
      expect(metrics.tokenReductionPercentage).toBe(100);
      expect(metrics.byteReductionPercentage).toBe(100);
    }
  });

  it('is internally consistent: compressed never exceeds raw for a true prune', () => {
    const original = 'function foo() { return bar(baz(qux())); }'.repeat(50);
    const pruned = 'function foo() { return bar(); }';
    const metrics = computeReduction(original, pruned);
    expect(metrics.compressedBytes).toBeLessThan(metrics.rawBytes);
    expect(metrics.compressedTokens).toBeLessThan(metrics.rawTokens);
  });
});
