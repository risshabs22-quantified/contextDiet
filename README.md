<div align="center">

# ContextDiet

### An AST-based token optimizer that slashes AI agent context bloat and drops API costs by up to 90% — with **$0 network overhead**.

[![CI](https://github.com/risshabs22-quantified/contextDiet/actions/workflows/ci.yml/badge.svg)](https://github.com/risshabs22-quantified/contextDiet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](#-contributing)

**Stop paying to send dead code to your LLM.**

</div>

---

## The 30-Second Pitch

Your AI agent doesn't need your entire repo to fix a JWT bug. It needs `verifyToken`, the middleware that calls it, and the crypto util underneath — and **nothing else**.

Naive context packers dump every byte they can find. ContextDiet parses your code into an **Abstract Syntax Tree**, builds a real **dependency graph**, ranks the symbols that match your task, and traverses *only the reachable code paths*. The result is a dense, surgical Markdown bundle that fits your intent — not your file count.

```bash
npx contextdiet trim ./src --focus "Fix JWT verification"
```

The **Markdown bundle streams to stdout** (pipe it straight into a file, your clipboard, or an LLM), while a human-readable summary dashboard is printed to **stderr** — so redirecting stdout gives you a pristine bundle:

```bash
npx contextdiet trim ./src --focus "Fix JWT verification" > context.md
```

```
  ContextDiet · trim
  ────────────────────────────────────────────────────
  focus      Fix JWT verification
  root       /repo/src
  seeds      3 matched   ·   kept 5/42 files
  ────────────────────────────────────────────────────
  original    501.6 KB   ~128,400 tok
  pruned       46.5 KB    ~11,900 tok
  ────────────────────────────────────────────────────
  reduction      90.7% tokens   ✓ >80% target met
                 90.7% bytes
  output     (stdout)
```

---

## Why ContextDiet?

Most "repo-to-prompt" tools (think `repomix`, `gitingest`, and friends) are **text dumpers**. They walk your filesystem, concatenate files, and maybe strip comments. That's it. They have no idea what your code *means*, so they send everything and let you (and your wallet) sort it out.

That's expensive in three ways:

| | Naive text packers | **ContextDiet** |
|---|---|---|
| **Unit of understanding** | Files & bytes | AST symbols & call graph |
| **What gets included** | Everything it can glob | Only code reachable from your task |
| **Dead code** | Shipped to the model | Sliced away |
| **Cost model** | You pay for the whole repo | You pay for the relevant slice |
| **Circular imports** | Duplicated / mangled | Cycle-safe graph traversal |
| **Re-exports & aliases** | Often broken by regex | Resolved via real AST |
| **Network / API calls** | Sometimes (embeddings) | **Zero. Fully local.** |
| **Determinism** | Order-dependent | Byte-identical every run |

> **The core insight:** LLM cost is billed per token, and most tokens in a naive dump are *irrelevant*. A billing module, a PDF generator, and an analytics service have **zero structural connection** to your auth bug — so why pay to send them? ContextDiet answers "what does the model actually need to see?" with graph theory, not guesswork.

---

## Quick Start

```bash
# Zero install — run it directly
npx contextdiet trim ./src --focus "Fix JWT verification"

# Or install globally
npm install -g contextdiet
contextdiet trim ./src --focus "add rate limiting to the login route"
```

**`contextdiet trim <path> [options]`**

| Flag | Description | Default |
|---|---|---|
| `<path>` | Root directory to analyze. | *(required)* |
| `-f, --focus <query>` | Natural-language description of your task. Drives seed selection. | *(required)* |
| `--hops <n>` | Dependency-graph traversal depth from the seed nodes. | `2` |
| `-o, --output <file>` | Write the bundle to a file instead of stdout. | *(stdout)* |

> The bundle is written to **stdout** and the summary dashboard to **stderr**, so `contextdiet trim … > bundle.md` yields a clean file with no dashboard noise mixed in.

---

## How It Works

ContextDiet is a five-stage pipeline. Each stage is a pure, independently testable module — source in, data out, no hidden state.

```
                         ┌───────────────────────────────────────────────┐
   ./src  ──────────────▶│                  ContextDiet                   │
   --focus "Fix JWT…"    └───────────────────────────────────────────────┘
                                              │
        ┌─────────────────────────────────────┼─────────────────────────────────────┐
        ▼                                      ▼                                      ▼
┌───────────────┐   symbols +   ┌───────────────────┐   graph    ┌──────────────────────┐
│  1. PARSER    │   imports     │ 2. DEPENDENCY     │   nodes    │  3. LEXICAL SEED     │
│               │──────────────▶│    GRAPH          │───────────▶│     RANKER           │
│  AST via      │               │                   │            │                      │
│  ast-grep     │               │ resolves imports, │            │ tokenizes the focus  │
│  → functions, │               │ re-exports,       │            │ string, scores it    │
│  classes,     │               │ aliases; handles  │            │ against symbol names │
│  vars, types  │               │ circular deps     │            │ → seed nodes         │
└───────────────┘               └───────────────────┘            └──────────────────────┘
                                                                             │
        ┌────────────────────────────────────────────────────────────────────┘
        ▼                                            ▼
┌───────────────────────┐   kept files   ┌──────────────────────────┐
│   4. AST PRUNER       │───────────────▶│   5. MARKDOWN BUNDLER    │─────▶  stdout  (→ pipe to file)
│                       │                │                          │        + metrics → stderr
│ walks the graph from  │                │ fences each kept file    │
│ the seeds, keeps only │                │ with START/END delimiters│        Raw:        128,400 tok
│ reachable code paths, │                │ optimized for LLM        │        Compressed:  11,900 tok
│ slices the rest       │                │ context parsing          │        Reduction:      90.7%
└───────────────────────┘                └──────────────────────────┘
```

| Stage | Module | Responsibility |
|---|---|---|
| **1. Parser** | `src/core/parser` | Extracts imports & top-level symbols from each file via a real AST (ast-grep). Never returns a silently-wrong partial tree — surfaces a catchable `ParseError`. |
| **2. Dependency Graph** | `src/core/graph` | Resolves the import/export edges between symbols. Cycle-safe (`a → b → a` won't loop). |
| **3. Lexical Seed Ranker** | `src/core/ranker` | Turns your `--focus` string into weighted seed nodes. Strips stop words, splits camelCase, scores overlap. **$0, deterministic, local.** |
| **4. AST Pruner** | `src/core/pruner` | Traverses the graph from the seeds and keeps only reachable declarations. Everything unreachable is sliced. |
| **5. Markdown Bundler** | `src/core/bundler` | Serializes the survivors into a dense, delimiter-fenced stream — plus a `metrics` report proving the reduction. |

---

## Example: The Monolith Auth App

Given a backend where `index.ts` boots Express and mounts **auth**, **billing**, and **analytics** routes:

```
src/
├── index.ts                  ← entry point
├── routes/auth.ts            ← 🟢 kept
├── middleware/authMiddleware ← 🟢 kept
├── utils/jwtUtils.ts         ← 🟢 kept  (the actual JWT logic)
├── utils/crypto.ts           ← 🟢 kept  (jwtUtils depends on it)
├── routes/billing.ts         ← 🔴 sliced
├── utils/pdfGenerator.ts     ← 🔴 sliced
└── services/analytics.ts     ← 🔴 sliced
```

Running `--focus "Fix JWT verification"` follows the chain
`index → auth → authMiddleware → jwtUtils → crypto`
and **completely removes** billing, the PDF generator, and analytics — because none of them are reachable from the JWT code path. That's the difference between a text dumper and a graph traversal.

---

## Local Development

```bash
git clone https://github.com/risshabs22-quantified/contextDiet.git
cd contextDiet
npm install

npm run typecheck   # tsc --noEmit, strict mode
npm test            # full Vitest suite
npm run build       # compile to dist/
```

**Requirements:** Node.js `>= 20`.

---

## Contributing

Contributions are welcome and appreciated — ContextDiet is built to be extended.

1. **Fork** the repo and create a feature branch (`git checkout -b feat/my-improvement`).
2. **Keep it strict.** All code must pass `npm run typecheck` (strict TypeScript, no implicit `any`) and `npm test`.
3. **Test first.** Every new capability ships with Vitest coverage — see `tests/unit` for the style.
4. **Stay modular.** Each pipeline stage is a pure module; new backends (tree-sitter, SWC) should slot in behind the existing interfaces without touching callers.
5. **Open a PR.** CI runs typecheck + the full test suite on every push and pull request. Green check = ready for review.

Good first issues: additional language parsers, a smarter ranker (embeddings-optional), and richer bundle formats (JSON, XML).

---

## License

Released under the **[MIT License](./LICENSE)**. Use it, fork it, ship it, sell it — no strings attached. Copyright © 2026 the ContextDiet contributors.

<div align="center">

**If ContextDiet saves you tokens, [give it a ⭐](https://github.com/risshabs22-quantified/contextDiet) — it genuinely helps.**

</div>
