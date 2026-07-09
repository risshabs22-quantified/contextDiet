/**
 * ContextDiet CLI (Task 5.0).
 *
 *   contextdiet trim <path> --focus "<query>" [--hops <n>] [-o <file>]
 *
 * Contract: the Markdown bundle is the ONLY thing written to stdout (so it pipes
 * cleanly into an LLM / clipboard / file). The human-facing summary dashboard is
 * written to stderr, so `contextdiet trim … > bundle.md` yields a pristine file.
 */

import { Command } from 'commander';
import { promises as fs, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { trim } from '../core/pipeline.js';
import type { TrimResult } from '../core/pipeline.js';

interface TrimCliOptions {
  readonly focus: string;
  readonly hops: string;
  readonly output?: string;
}

// Single source of truth for the version: package.json sits two levels above
// both src/cli/ and the compiled dist/cli/, so the same relative URL works for
// either entry point.
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('contextdiet')
  .description('AST-based token optimizer — trim a codebase to just what an AI agent needs.')
  .version(version);

program
  .command('trim')
  .description('Trim a codebase to the code relevant to a focus task, as one dense Markdown stream.')
  .argument('<path>', 'root directory to analyze')
  .requiredOption('-f, --focus <query>', 'natural-language task to focus on')
  .option('--hops <n>', 'dependency-graph traversal depth from seeds', '2')
  .option('-o, --output <file>', 'write the bundle to a file instead of stdout')
  .action(async (targetPath: string, options: TrimCliOptions) => {
    try {
      const hops = Number.parseInt(options.hops, 10);
      if (!Number.isFinite(hops) || hops < 0) {
        throw new Error(`--hops must be a non-negative integer (got "${options.hops}")`);
      }

      const root = path.resolve(targetPath);
      const result = await trim(root, options.focus, { hops });

      if (result.totalFiles === 0) {
        process.stderr.write(`\n  contextdiet: no source files found under ${root}\n\n`);
        process.exitCode = 1;
        return;
      }

      const outputPath = options.output === undefined ? null : path.resolve(options.output);
      if (outputPath !== null) {
        await fs.writeFile(outputPath, ensureTrailingNewline(result.bundle), 'utf8');
      } else {
        process.stdout.write(ensureTrailingNewline(result.bundle));
      }

      printDashboard(result, outputPath);
    } catch (error) {
      process.stderr.write(`\n  contextdiet: ${(error as Error).message}\n\n`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`\n  contextdiet: ${(error as Error).message}\n\n`);
  process.exitCode = 1;
});

// --- presentation ---------------------------------------------------------

const useColor = Boolean(process.stderr.isTTY) && process.env.NO_COLOR === undefined;
const paint = (code: string, text: string): string =>
  useColor ? `\x1b[${code}m${text}\x1b[0m` : text;
const bold = (t: string): string => paint('1', t);
const dim = (t: string): string => paint('2', t);
const cyan = (t: string): string => paint('36', t);
const green = (t: string): string => paint('32', t);
const yellow = (t: string): string => paint('33', t);

function printDashboard(result: TrimResult, outputPath: string | null): void {
  const m = result.metrics;
  const hitTarget = m.tokenReductionPercentage >= 80;
  const pct = `${m.tokenReductionPercentage.toFixed(1)}%`;
  const pctText = hitTarget ? green(bold(pct)) : yellow(bold(pct));
  const targetText = hitTarget ? green('✓ >80% target met') : yellow('⚠ below >80% target');

  const rule = dim('─'.repeat(52));
  const label = (t: string): string => dim(t.padEnd(11));

  const lines = [
    '',
    `  ${bold(cyan('ContextDiet'))} ${dim('· trim')}`,
    `  ${rule}`,
    `  ${label('focus')}${result.focus}`,
    `  ${label('root')}${result.rootDir}`,
    `  ${label('seeds')}${bold(String(result.seedCount))} matched   ${dim('·')}   kept ${bold(`${result.keptFiles.length}/${result.totalFiles}`)} files`,
    `  ${rule}`,
    `  ${label('original')}${humanBytes(m.rawBytes).padStart(9)}   ${dim(`~${grouped(m.rawTokens)} tok`)}`,
    `  ${label('pruned')}${humanBytes(m.compressedBytes).padStart(9)}   ${dim(`~${grouped(m.compressedTokens)} tok`)}`,
    `  ${rule}`,
    `  ${label('reduction')}${pctText} ${dim('tokens')}   ${targetText}`,
    `  ${dim(''.padEnd(11))}${dim(`${m.byteReductionPercentage.toFixed(1)}% bytes`)}`,
    `  ${label('output')}${outputPath === null ? dim('(stdout)') : outputPath}`,
    '',
  ];

  process.stderr.write(lines.join('\n') + '\n');
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function grouped(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
