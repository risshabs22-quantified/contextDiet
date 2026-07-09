import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const execFileAsync = promisify(execFile);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const TSC = path.join(REPO, 'node_modules', '.bin', 'tsc');
// The shipped entry point: bin shim → compiled dist/cli/index.js. We exercise the
// REAL artifact a user runs, using only `node` (no tsx / esbuild postinstall), so
// the harness is hermetic across fresh clones, `npm ci`, and restricted sandboxes.
const BIN = path.join(REPO, 'bin', 'contextdiet.js');
const FIXTURE = path.join(REPO, 'tests/fixtures/monolith-auth-app/src');

interface CliRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

/** Run the compiled CLI with plain `node`; resolve even on non-zero exit. */
async function runCli(args: readonly string[]): Promise<CliRun> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN, ...args], {
      cwd: REPO,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: unknown };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: typeof e.code === 'number' ? e.code : 1 };
  }
}

describe('contextdiet CLI — end to end', () => {
  // Build the shipped artifact once for the whole file (tsc is already required to
  // typecheck the project; no extra native tooling is pulled in).
  beforeAll(async () => {
    await execFileAsync(TSC, ['-p', path.join(REPO, 'tsconfig.json')], { cwd: REPO });
  }, 120_000);

  it('trims the monolith fixture and streams a clean bundle to stdout', async () => {
    // Query targets the verify FUNCTION (not just the payload type), so symbol-level
    // selection follows verifyToken → sign → hmacSha256 across into crypto.ts.
    const { stdout, stderr, code } = await runCli([
      'trim',
      FIXTURE,
      '--focus',
      'verify the token signature',
      '--hops',
      '3',
    ]);

    expect(code).toBe(0);

    expect(stdout).toContain('--- START FILE:');
    expect(stdout).toContain('utils/jwtUtils.ts');
    expect(stdout).toContain('verifyToken');
    expect(stdout).toContain('utils/crypto.ts');

    // The unrelated billing/pdf/analytics subgraph is sliced away entirely.
    expect(stdout).not.toContain('renderPdf');
    expect(stdout).not.toContain('billingRouter');
    expect(stdout).not.toContain('AnalyticsEngine');

    // Dashboard goes to stderr, never polluting the piped bundle.
    expect(stderr).toContain('ContextDiet');
    expect(stderr).toMatch(/reduction/i);
    expect(stderr).toMatch(/\d+(\.\d+)?%/);
  }, 30_000);

  it('writes to a file with -o and leaves stdout empty', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'contextdiet-cli-'));
    const outFile = path.join(dir, 'bundle.md');
    try {
      const { stdout, code } = await runCli(['trim', FIXTURE, '--focus', 'jwt', '-o', outFile]);
      expect(code).toBe(0);
      expect(stdout.trim()).toBe('');

      const written = await fs.readFile(outFile, 'utf8');
      expect(written).toContain('--- START FILE:');
      expect(written).toContain('utils/jwtUtils.ts');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('produces no malformed paths — every emitted file header is repo-relative', async () => {
    const { stdout } = await runCli(['trim', FIXTURE, '--focus', 'jwt', '--hops', '3']);
    const headers = [...stdout.matchAll(/--- START FILE: (.+?) ---/g)].map((m) => m[1] ?? '');
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(path.isAbsolute(header)).toBe(false);
      expect(header).not.toContain('..');
    }
  }, 30_000);

  it('exits non-zero when --focus is missing', async () => {
    const { code } = await runCli(['trim', FIXTURE]);
    expect(code).not.toBe(0);
  }, 30_000);

  it('reports the package.json version (no drift between the two)', async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(REPO, 'package.json'), 'utf8'),
    ) as { version: string };
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  }, 30_000);
});
