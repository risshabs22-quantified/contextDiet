# ContextDiet — Launch Copy

Ready-to-post pitches for launch day. Every benchmark number below is a **real measured run** logged in `PROJECT_STATUS.md` §6 (Efficiency Metrics Ledger) — keep it that way if you edit, and reply fast to the first wave of comments — early engagement is what drives ranking on every one of these platforms.

> Repo: https://github.com/risshabs22-quantified/contextDiet

---

## 1. Hacker News — Show HN

**Title:**

```
Show HN: ContextDiet – AST graph traversal that cuts AI agent token costs (up to 99% measured)
```

**Body:**

Hi HN,

I kept watching my agent's bill climb because every "repo-to-prompt" tool I tried was a glorified `cat`. They glob your files, concatenate them, maybe strip comments, and ship the whole thing to the model. Your JWT bug fix ends up paying to send the billing module, the PDF generator, and the analytics service — none of which the model needs to see.

ContextDiet takes a different approach: it treats your codebase as a graph, not a pile of text.

The pipeline is five pure stages:

1. **Parser** — extracts imports and top-level symbols via a real AST (ast-grep), not regex. It surfaces a catchable `ParseError` instead of silently returning a half-wrong tree.
2. **Dependency Graph** — resolves the import/export edges, including re-exports and aliases, and is cycle-safe (`a → b → a` won't loop).
3. **Lexical Seed Ranker** — turns your `--focus "verify the token signature"` string into weighted seed nodes. Stop-word stripping + camelCase splitting + overlap scoring. Fully local, deterministic, $0.
4. **Selector + AST Pruner** — walks the dependency graph from the seeds (symbol-level reference closure) and keeps only reachable declarations, re-emitted verbatim. Everything unreachable is sliced.
5. **Markdown Bundler** — serializes the survivors into a dense, delimiter-fenced stream, plus a token-reduction report.

The thing I care most about: it's **zero network overhead**. No embeddings API, no remote reranker, no telemetry. It runs entirely on your machine and produces byte-identical output every run, which matters if you're wiring it into CI or a deterministic agent loop.

```
npx contextdiet trim ./src --focus "verify the token signature"
```

Measured numbers: on our monolith-auth fixture, that focus keeps the `authMiddleware → jwtUtils → crypto` dependency chain (3 of 8 files) and drops the entry point, billing, PDF, and analytics entirely — 9,386 → 2,985 estimated tokens (**68.2%**). A narrow, single-symbol focus on ContextDiet's own repo measures **99.0%** (30,472 → 302). One design choice worth knowing: the selector follows *dependencies* from the matched symbols, never callers — that's what keeps bundles small.

It's MIT, TypeScript (strict), and the whole engine is built as independently testable modules with a big Vitest suite. I'd love feedback on the ranker heuristic and on which languages to parse next (tree-sitter/SWC backends are designed to slot in behind the existing interfaces).

Repo: https://github.com/risshabs22-quantified/contextDiet

*Note: the token counts use a local sub-word estimator, not a live tokenizer call — happy to discuss the accuracy tradeoffs in the comments.*

---

## 2. Reddit

### r/node

**Title:**

```
I built a fully-offline TypeScript CLI that prunes a codebase down to just the code paths your AI agent needs (AST graph traversal, strict TS, MIT)
```

**Body:**

Most tools that turn a repo into an LLM prompt are text dumpers — they concatenate files and hope for the best. That breaks on circular imports, mangles re-exports with regex, and makes you pay tokens for dead code.

ContextDiet is a TypeScript CLI that does it properly:

- **Real AST parsing** (ast-grep) → imports + symbols, with a catchable `ParseError` instead of silent partial trees.
- **A dependency graph** that resolves re-exports/aliases and is cycle-safe.
- **A lexical ranker** that maps your `--focus` string to seed symbols (stop-word stripping + camelCase tokenization + scoring), deterministic and 100% local.
- **A selector + pruner** that keep only graph-reachable code (symbol-level reference closure), and a **bundler** that emits a dense Markdown stream + a token-reduction report.

Stack notes for this sub: two runtime deps (`@ast-grep/napi` native bindings + `commander`), strict `tsconfig` (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), pure ESM (NodeNext), Node ≥20, Vitest, GitHub Actions CI on Node 20 + 22. Every pipeline stage is a pure module behind an interface, so swapping the AST backend later doesn't touch callers.

```
npx contextdiet trim ./src --focus "add rate limiting to the login route"
```

Repo (MIT): https://github.com/risshabs22-quantified/contextDiet — feedback on the architecture very welcome.

### r/LocalLLaMA

**Title:**

```
Stop stuffing your whole repo into context. ContextDiet does AST graph traversal to send local models only the reachable code paths (100% offline, $0 API)
```

**Body:**

If you're running local models, context window is your scarcest resource — you don't have a 200k window to waste on dead code, and you *definitely* don't want to round-trip your source to some embedding API just to build a prompt.

ContextDiet is fully offline. Given a task like `--focus "verify the token signature"`, it:

1. Parses your code into an AST,
2. Builds a dependency graph,
3. Ranks symbols against your focus string with a **local, deterministic** lexical matcher (no embeddings call),
4. Traverses the graph and keeps only reachable code,
5. Emits a dense Markdown bundle sized to fit a small context window.

No network, no telemetry, no API keys. Measured on our auth-monolith fixture it cut **68%** of tokens on a broad query and **99%** on a narrow one — everything not structurally reachable from the code path you're working on gets sliced, which means more of your precious local context goes to *relevant* code.

```
npx contextdiet trim ./src --focus "verify the token signature"
```

MIT, TypeScript: https://github.com/risshabs22-quantified/contextDiet

### r/LanguageTechnology

**Title:**

```
ContextDiet: using AST dependency-graph reachability (instead of embeddings) to select relevant code context for LLMs
```

**Body:**

Sharing a project that framing-wise might interest this sub. The task is context selection for code LLMs: given a natural-language intent, pick the minimal relevant subset of a codebase.

The common approach is dense retrieval — embed chunks, embed the query, rank by similarity. ContextDiet instead exploits the **structure** of code: it parses to an AST, builds a symbol-level dependency graph, and does reachability from a set of seed nodes.

The interesting NLP-adjacent piece is seed selection. Rather than an embedding model, the ranker uses a deterministic lexical matcher: tokenize the intent (stop-word removal), tokenize identifiers by splitting camelCase/PascalCase/snake_case and acronym runs (`verifyJWT → [verify, jwt]`), then score query–symbol token overlap with exact/partial matching and a mild positional prior on the query. It's cheap, explainable, and reproducible — no vector store, no API.

The tradeoff vs. embeddings: worse on pure semantic paraphrase ("auth" ≠ "identity"), but far better on precision, cost, determinism, and structural correctness (it never sends unreachable code). An embeddings-optional ranker is on the roadmap and would slot behind the same interface.

Repo (MIT, TypeScript): https://github.com/risshabs22-quantified/contextDiet — curious how folks here would improve the seed-ranking step.

---

## 3. X / Twitter — Technical Thread

**1/**
Your AI coding agent is reading your entire repo to fix a one-line JWT bug.

You're paying for every token of that.

I built ContextDiet: AST graph traversal that sends the model *only* the code paths it actually needs. Up to 99% fewer tokens (measured), $0 network overhead. 🧵

**2/**
The problem with "repo → prompt" tools (repomix, gitingest, etc.):

They're text dumpers. Glob files → concatenate → ship.

No understanding of what your code *means*. So your auth fix pays to send the billing module, the PDF generator, and analytics. Dead weight.

**3/**
ContextDiet treats your codebase as a graph, not a pile of text.

Pipeline:
Parser → Dependency Graph → Lexical Seed Ranker → Selector + Pruner → Markdown Bundle

Each stage is a pure module. Source in, data out. No hidden state.

**4/**
① Parser
Real AST via ast-grep → functions, classes, vars, types + imports.
Hits a syntax error? It throws a catchable ParseError — never a silently-wrong partial tree.

**5/**
② Dependency Graph
Resolves import/export edges between symbols. Handles re-exports and aliases (the stuff that quietly breaks regex packers).

Circular deps? `a → b → a` won't infinite-loop. Cycle-safe traversal.

**6/**
③ Lexical Seed Ranker
Your `--focus "verify the token signature"` → weighted seed nodes.

Splits camelCase (verifyJWT → [verify, jwt]), strips stop words, scores overlap.

100% local. Deterministic. $0. No embeddings API.

**7/**
④ Selector + Pruner
Walks the graph from the seeds (symbol-level reference closure), keeps only *reachable* declarations, re-emits them verbatim.

⑤ Bundler
Dense, delimiter-fenced Markdown + a token-reduction report.

**8/**
Real example — a monolith with auth + billing + analytics.

Focus: "verify the token signature"
Kept: authMiddleware → jwtUtils → crypto
Sliced: index, auth route, billing, pdfGenerator, analytics

It follows dependencies from the matched code — never callers. 🎯

**9/**
The measured numbers on that run:

Raw:        9,386 tokens
Compressed: 2,985 tokens
Reduction:     68.2%

And a narrow single-symbol task on our own repo:
30,472 → 302 tokens. **99.0%.**

That's the difference between graph theory and `cat`.

**10/**
One command:

```
npx contextdiet trim ./src --focus "verify the token signature"
```

MIT licensed. Strict TypeScript. Fully offline. No API keys, no telemetry.

⭐ the repo if this saves you tokens:
https://github.com/risshabs22-quantified/contextDiet
