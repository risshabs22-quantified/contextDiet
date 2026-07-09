import { describe, it, expect } from 'vitest';
import { MarkdownBundler, formatFileBlock } from '../../src/core/bundler/index.js';
import type { BundleFile } from '../../src/core/bundler/index.js';

const JWT_FILE: BundleFile = {
  path: 'src/utils/jwtUtils.ts',
  content: 'export function verifyToken(t: string): boolean {\n  return t.length > 0;\n}',
};

const AUTH_FILE: BundleFile = {
  path: 'src/middleware/authMiddleware.ts',
  content: 'export const authMiddleware = () => {};',
};

describe('formatFileBlock', () => {
  it('wraps content with START/END delimiters carrying the exact path', () => {
    const block = formatFileBlock(JWT_FILE);
    expect(block).toContain('--- START FILE: src/utils/jwtUtils.ts ---');
    expect(block).toContain('--- END FILE: src/utils/jwtUtils.ts ---');
  });

  it('places delimiters on their own lines with content in between', () => {
    const block = formatFileBlock(AUTH_FILE);
    const lines = block.split('\n');
    expect(lines[0]).toBe('--- START FILE: src/middleware/authMiddleware.ts ---');
    expect(lines[1]).toBe('export const authMiddleware = () => {};');
    expect(lines[2]).toBe('--- END FILE: src/middleware/authMiddleware.ts ---');
  });

  it('does not mangle multi-line content (preserves it verbatim)', () => {
    const block = formatFileBlock(JWT_FILE);
    expect(block).toContain(JWT_FILE.content);
  });

  it('normalizes a single trailing newline so the footer never doubles up', () => {
    const block = formatFileBlock({ path: 'a.ts', content: 'const x = 1;\n' });
    expect(block).toBe('--- START FILE: a.ts ---\nconst x = 1;\n--- END FILE: a.ts ---');
  });

  it('preserves content that itself contains triple-backtick fences', () => {
    const tricky: BundleFile = {
      path: 'doc.ts',
      content: 'const md = `\n```ts\nconst y = 2;\n```\n`;',
    };
    const block = formatFileBlock(tricky);
    expect(block).toContain('```ts');
    expect(block).toContain('const y = 2;');
  });
});

describe('MarkdownBundler', () => {
  it('returns an empty string for no files', () => {
    expect(new MarkdownBundler().bundle([])).toBe('');
  });

  it('bundles a single file identically to formatFileBlock', () => {
    expect(new MarkdownBundler().bundle([JWT_FILE])).toBe(formatFileBlock(JWT_FILE));
  });

  it('combines multiple files, each with its own delimited block', () => {
    const out = new MarkdownBundler().bundle([JWT_FILE, AUTH_FILE]);
    expect(out).toContain('--- START FILE: src/utils/jwtUtils.ts ---');
    expect(out).toContain('--- END FILE: src/utils/jwtUtils.ts ---');
    expect(out).toContain('--- START FILE: src/middleware/authMiddleware.ts ---');
    expect(out).toContain('--- END FILE: src/middleware/authMiddleware.ts ---');
    // Both file contents survive untouched.
    expect(out).toContain(JWT_FILE.content);
    expect(out).toContain(AUTH_FILE.content);
  });

  it('preserves caller order by default', () => {
    const out = new MarkdownBundler().bundle([JWT_FILE, AUTH_FILE]);
    expect(out.indexOf('jwtUtils.ts')).toBeLessThan(out.indexOf('authMiddleware.ts'));
  });

  it('sorts by path when sortByPath is enabled, for deterministic output', () => {
    const out = new MarkdownBundler({ sortByPath: true }).bundle([JWT_FILE, AUTH_FILE]);
    // "src/middleware/..." sorts before "src/utils/..."
    expect(out.indexOf('authMiddleware.ts')).toBeLessThan(out.indexOf('jwtUtils.ts'));
  });

  it('separates blocks with a blank line by default', () => {
    const out = new MarkdownBundler().bundle([AUTH_FILE, { path: 'b.ts', content: 'const b = 2;' }]);
    expect(out).toContain('--- END FILE: src/middleware/authMiddleware.ts ---\n\n--- START FILE: b.ts ---');
  });

  it('respects a custom blockSeparation', () => {
    const out = new MarkdownBundler({ blockSeparation: 0 }).bundle([
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
    ]);
    expect(out).toContain('--- END FILE: a.ts ---\n--- START FILE: b.ts ---');
  });

  it('is deterministic: identical input yields identical output', () => {
    const bundler = new MarkdownBundler();
    expect(bundler.bundle([JWT_FILE, AUTH_FILE])).toBe(bundler.bundle([JWT_FILE, AUTH_FILE]));
  });
});

describe('MarkdownBundler — edge cases', () => {
  it('handles an empty-content file, emitting just the delimiters back to back', () => {
    const block = formatFileBlock({ path: 'empty.ts', content: '' });
    expect(block).toBe('--- START FILE: empty.ts ---\n\n--- END FILE: empty.ts ---');
  });

  it('preserves a whitespace-only file without collapsing it to empty', () => {
    const block = formatFileBlock({ path: 'ws.ts', content: '   \t  ' });
    const lines = block.split('\n');
    expect(lines[1]).toBe('   \t  ');
  });

  it('strips only ONE trailing newline, preserving intentional trailing blank lines', () => {
    // Two trailing newlines -> one blank line should survive after normalization.
    const block = formatFileBlock({ path: 'x.ts', content: 'const x = 1;\n\n' });
    expect(block).toBe('--- START FILE: x.ts ---\nconst x = 1;\n\n--- END FILE: x.ts ---');
  });

  it('normalizes a CRLF trailing newline the same as LF', () => {
    const block = formatFileBlock({ path: 'crlf.ts', content: 'const x = 1;\r\n' });
    expect(block).toBe('--- START FILE: crlf.ts ---\nconst x = 1;\n--- END FILE: crlf.ts ---');
  });

  it('sorts deeply nested relative paths lexicographically, not by depth', () => {
    const files: BundleFile[] = [
      { path: 'src/z.ts', content: 'z' },
      { path: 'src/a/b/c/deep.ts', content: 'deep' },
      { path: 'src/a/b/shallow.ts', content: 'shallow' },
      { path: 'src/a/a.ts', content: 'a' },
    ];
    const out = new MarkdownBundler({ sortByPath: true }).bundle(files);
    const order = [...out.matchAll(/--- START FILE: (.+?) ---/g)].map((m) => m[1]);
    expect(order).toEqual([
      'src/a/a.ts',
      'src/a/b/c/deep.ts',
      'src/a/b/shallow.ts',
      'src/z.ts',
    ]);
  });

  it('does not mutate the caller-provided array when sorting', () => {
    const files: BundleFile[] = [
      { path: 'b.ts', content: 'b' },
      { path: 'a.ts', content: 'a' },
    ];
    new MarkdownBundler({ sortByPath: true }).bundle(files);
    expect(files.map((f) => f.path)).toEqual(['b.ts', 'a.ts']);
  });

  it('preserves duplicate paths as separate blocks (no dedup)', () => {
    const dup: BundleFile = { path: 'dup.ts', content: 'first' };
    const dup2: BundleFile = { path: 'dup.ts', content: 'second' };
    const out = new MarkdownBundler().bundle([dup, dup2]);
    const starts = [...out.matchAll(/--- START FILE: dup\.ts ---/g)];
    expect(starts).toHaveLength(2);
    expect(out).toContain('first');
    expect(out).toContain('second');
  });

  it('handles a large batch of files without dropping or reordering any', () => {
    const files: BundleFile[] = Array.from({ length: 500 }, (_, i) => ({
      path: `src/mod${i}.ts`,
      content: `export const v${i} = ${i};`,
    }));
    const out = new MarkdownBundler().bundle(files);
    const starts = [...out.matchAll(/--- START FILE: /g)];
    expect(starts).toHaveLength(500);
    // First and last preserved in caller order.
    expect(out.indexOf('src/mod0.ts')).toBeLessThan(out.indexOf('src/mod499.ts'));
  });

  it('preserves unicode paths and content byte-for-byte', () => {
    const block = formatFileBlock({ path: 'src/café/résumé.ts', content: 'const 🚀 = "launch";' });
    expect(block).toContain('--- START FILE: src/café/résumé.ts ---');
    expect(block).toContain('const 🚀 = "launch";');
  });
});
