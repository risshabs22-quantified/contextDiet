# ContextDiet — PROJECT_STATUS.md

> **State Machine Memory Protocol.** This file is the single source of truth for
> project state across Claude Code sessions. It MUST be updated at the end of
> every major task: advance the Feature Checklist, append an ADL entry for any
> feature added/modified/**removed** (with justification), and record any new
> benchmark in the Efficiency Metrics Ledger. A `Stop` hook
> (`.claude/hooks/update-status.sh`) appends timestamped checkpoints to the
> AUTO-LOG block as a safety net — but the curated sections below are authored by
> Claude, not the hook.

- **Project:** ContextDiet — AST-based token optimizer for AI agents
- **Repo root (absolute):** `/Users/risshabs.22/Documents/GitHub/contextDiet`
- **Last major update:** 2026-07-08 — **Ultracode final audit** (20 agents, 5 dimensions, adversarial verify): 15/15 confirmed findings fixed; npm tarball verified by a real install
- **Current stage:** **LAUNCH-READY.** 123/123 tests, 0 type errors, tarball smoke-tested end-to-end (`npm pack` → install → run), docs 100% ledger-backed. Awaiting `git push`.

---

## 1. Core System Architecture

ContextDiet is a **staged, interface-driven pipeline**. Each stage is a unit with
one responsibility, communicating through explicit contracts so backends and
strategies can be swapped without a rewrite.

```
discover → parse → resolve graph → rank(focus) → select → prune → bundle → emit
```

| Stage | Module (`src/core/…`) | Responsibility | Status |
|-------|-----------------------|----------------|--------|
| **Parser** (interface) | `parser/` | `extractImports` / `extractSymbols` / `extractDependencies` / `extractImportStatements` / `collectReferences` / `sliceNode`. Backend = ast-grep. | ✅ Done |
| **DependencyGraphResolver** | `graph/` | Directed file graph (imports + re-exports), resolved to disk, `node_modules`-bounded. | ✅ Done |
| **Ranker** (interface) | `ranker/` | `determineSeeds(focus, symbols) → SeedNode[]`. v1 = `LexicalRanker` (2nd agent). | ✅ Done |
| **Selector** | `graph/symbol-selector.ts` | `ReferenceClosureSelector` (active): symbol-level reference closure → precise `Map<file, Set<symbol>>`. `GraphSelector` (file-level) retained as the horizon primitive. | ✅ Done |
| **AstPruner** | `pruner/` | Re-emit kept symbols + referenced imports verbatim; drop the rest. | ✅ Done |
| **MarkdownBundler** | `bundler/` | Dense START/END-delimited stream; verbatim, deterministic (2nd agent, reviewed). | ✅ Done |
| **Metrics** | `metrics/` | Byte + heuristic-token counts → reduction % (2nd agent, reviewed). | ✅ Done |
| **Pipeline orchestrator** | `pipeline.ts` | `trim(root, focus, opts)` — wires graph→rank→select→prune→bundle→metrics. | ✅ Done |
| **CLI** | `src/cli/` + `bin/` | `commander` binary; bundle→stdout, dashboard→stderr, `-o` to file. | ✅ Done |

**Load-bearing property:** the graph/prune/bundle core never knows *how* seeds
were chosen (Ranker interface) or *how* files were parsed (Parser interface).
That indirection is the entire extensibility story.

**Proven efficiency (measured, §6):** **99.0%** token reduction on `./src`
(narrow focus), **98.9%** on the monolith narrow run, **68.2%** on a broad
query — compression scales with how precisely the focus maps to code.
**Direction canon:** the selector keeps what matched code *depends on*, never
what merely calls into it — all docs/marketing must use this framing (ADR-019).

---

## 2. Tech Stack & Absolute Path Dependencies

| Concern | Choice |
|---------|--------|
| Runtime | Node.js ≥ 20, ESM (`"type": "module"`) |
| Language | TypeScript 5+/7 (`strict`, `noImplicitAny`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`) |
| AST engine | `@ast-grep/napi` (`^0.44.1`) — native bindings |
| CLI framework | `commander` (`^15`) |
| Test runner | `vitest` (`^4`) |
| Module resolution | `NodeNext` (relative imports use explicit `.js`) |
| Distribution | npm package **`context-diet`** (the name `contextdiet` is squatted by a third party — ADR-020; bin command stays `contextdiet`); tarball **verified**: `files: ["dist","bin"]` allowlist, `prepublishOnly` gate, `exports`/`types` for library use; real tarball-install smoke test green |

**Absolute path dependencies**

| Purpose | Absolute path |
|---------|---------------|
| Repo root | `/Users/risshabs.22/Documents/GitHub/contextDiet` |
| Parser contracts | `…/src/core/parser/types.ts` |
| Parser implementation | `…/src/core/parser/index.ts` |
| Parser unit tests | `…/tests/unit/parser.test.ts` |
| Graph contracts | `…/src/core/graph/types.ts` |
| Graph resolver + `collectReachable` | `…/src/core/graph/index.ts` |
| Selector (file-level / horizon) | `…/src/core/graph/selector.ts` |
| Selector (symbol-level, active) | `…/src/core/graph/symbol-selector.ts` · `…/tests/unit/symbol-selector.test.ts` |
| Ranker (2nd agent) | `…/src/core/ranker/{types,index}.ts` |
| Pruner | `…/src/core/pruner/{types,index}.ts` |
| Graph / selector / pruner / ranker tests | `…/tests/unit/{graph,selector,pruner,ranker}.test.ts` |
| Bundler / Metrics | `…/src/core/{bundler,metrics}/index.ts` |
| Pipeline orchestrator | `…/src/core/pipeline.ts` |
| CLI + bin shim | `…/src/cli/index.ts` · `…/bin/contextdiet.js` |
| E2E CLI test | `…/tests/integration/cli.test.ts` |
| Stop hook | `…/.claude/hooks/update-status.sh` |
| Harness settings | `…/.claude/settings.json` |

---

## 3. UX / CLI Specification

**Target syntax — one command, one dense Markdown stream:**

```bash
contextdiet trim ./src --focus "Fix the JWT authentication bug"
```

**Implemented flags (`contextdiet trim <path> …`):**

| Flag | Meaning | Default |
|------|---------|---------|
| `<path>` (positional) | Root directory to analyze. | required |
| `-f, --focus <task>` | Natural-language task; seeds which code to keep. | **required** |
| `--hops <n>` | Dependency-graph traversal depth from seed nodes. | `2` |
| `-o, --output <file>` | Write bundle to a file instead of stdout. | stdout |

**Output contract:** stdout carries ONLY the dense Markdown bundle (pipes cleanly
into an LLM / file); the human summary **dashboard is always printed to stderr**
(so `> bundle.md` stays pristine — no separate `--stats` flag needed). Each file
block is delimited by `--- START FILE: <relative/path> ---` / `--- END FILE: … ---`
containing only the declarations relevant to `--focus` plus their required imports.

**Deferred flags:** `--lang` (multi-language), `--json` (machine-readable metrics).

---

## 4. Active System State & Feature Checklist

### ✅ Completed
- [x] Repository scaffold (core engine / CLI / test-suite separation)
- [x] `.gitignore` shielding secrets, `node_modules`, build & ast-grep artifacts, Python venvs
- [x] Strict `tsconfig.json` (no implicit `any`)
- [x] `PROJECT_STATUS.md` memory ledger (this file)
- [x] `Stop` hook wired in `.claude/settings.json`
- [x] **Task 1.0 — AST Parsing MVP**: `Parser` contract + `AstGrepperParser`
      (named/default/namespace/aliased imports; **top-level** exported & internal
      class/function/variable symbols; exact `sliceNode`; `ParseError` on malformed syntax)
- [x] **Task 2.0 — DependencyGraphResolver**: filesystem-enumerated directed graph;
      imports **and** re-exports as edges (`extractDependencies`); relative→absolute
      module resolution; strict `node_modules` boundary; cycle-safe `collectReachable`
- [x] **Task 2.5 — Ranker + LexicalRanker** (2nd agent): deterministic, $0 keyword
      seeding; integrated + typechecked under strict; own suite green
- [x] **Task 3.0 — GraphSelector**: seeds → N-hop dependency traversal → keep-set
      `Map<file, Set<symbol>>`; follows dependencies (not dependents); hop-limited
- [x] **Task 3.5 — AstPruner**: keeps focused symbols + the imports they reference,
      slices the rest; dead-import elimination via `collectReferences`; verbatim,
      cannot corrupt emitted code
- [x] **Task 4.0 — MarkdownBundler** (2nd agent, reviewed): dense START/END-delimited
      stream, verbatim + deterministic, integrates via `BundleFile[]`
- [x] **Task 4.5 — Metrics** (2nd agent, reviewed): UTF-8 byte counts + local
      heuristic token estimate (no BPE vocab, no network); `computeReduction`
- [x] **Task 5.0 — Pipeline + CLI**: `trim()` orchestrator; `commander` CLI
      `contextdiet trim <path> -f <focus> [--hops n] [-o file]`; bundle→stdout,
      dashboard→stderr; `bin/contextdiet.js` shim; `npm run build` emits `dist/`
- [x] **Task 6.0 — E2E integration test**: `tests/integration/cli.test.ts` spins up
      the real CLI (via `tsx`) against `monolith-auth-app`; asserts clean stream,
      relative paths, `-o` file write, non-zero exit on missing focus
- [x] **Task 7.0 — Symbol-level selection** (`ReferenceClosureSelector`): reference-
      closure traversal — intra-file refs followed unbounded (no dangling helpers),
      cross-file within the hop horizon; drops internal helpers no seed touches.
      **Cleared the >80% target: 99.0% tokens** on `./src` + "malformed syntax ParseError"
      (was 77.0% under whole-file selection).
- [x] **Task 8.0 — Hermetic E2E harness** (ADR-017): integration test builds `dist/`
      with `tsc` and runs the shipped `bin` via plain `node`; `tsx` dep removed.
      Fixes the QA-reported 3/4 integration failures in `tsx`-less environments.
- [x] Vitest suite: **123/123 passing** (9 files); `tsc` typecheck clean; live CLI verified;
      integration suite verified green even with `tsx` absent (the QA condition)
- [x] **Task 9.0 — Ultracode launch audit** (5 dimensions × adversarial verification;
      20 agents; **15/15 confirmed findings → all FIXED**):
      * npm packaging (ADR-018): `files` allowlist, `prepublishOnly` gate, library
        `exports`/`types`, repository/homepage/bugs/author — **verified by installing
        the real tarball in a clean dir and running the binary**
      * README + LAUNCH_COPY rewritten to **ledger-backed numbers only** and true
        dependency-direction examples (ADR-019); false "zero-dependency" and
        fabricated 128,400/11,900/90.7% figures removed
      * hygiene: stale `tsx` comment in bin shim fixed; 3 stale `.gitkeep` removed
      * clean dimensions: CLI-docs mechanics ✓ (all flags/defaults/scripts match
        code), test integrity ✓ (per-file `it()` census = exactly 123; no
        `.only`/`.skip`; hermetic harness confirmed)

### 🔧 In-Progress
- _(none — nothing blocks launch)_

### 🗺 Post-launch roadmap (intentionally NOT marked complete — not yet built)
- [ ] `EmbeddingRanker` (better seed recall — lexical seeds are substring-based;
      see the "verification" vs `verify` gap noted in ADR-016)
- [ ] Multi-language parsing (`--lang`); watch mode; `--json` metrics output

---

## 5. Architectural Decision Log (ADL)

> Chronological. Every entry states the decision, the justification, and what was
> explicitly rejected — so future sessions never re-litigate settled choices.

**ADR-001 — Runtime: TypeScript / Node.js.** *(2026-07-08)*
Chosen for the widest reach for a developer CLI (`npx`) and first-class
`@ast-grep/napi` bindings. **Rejected:** Python (weaker for a JS/TS-first tool),
Rust (best perf/single-binary but too slow to iterate for an MVP and a smaller
contributor pool).

**ADR-002 — AST engine: ast-grep, behind a `Parser` interface.** *(2026-07-08)*
ast-grep gives high-level pattern matching + multi-language out of the box.
Hidden behind `Parser` so tree-sitter/SWC can replace it per-language later.
**Rejected (for now):** raw tree-sitter — more control but hand-written queries
per grammar; not worth the boilerplate at MVP.

**ADR-003 — Focus strategy: lexical + graph, behind a `Ranker` interface.** *(2026-07-08)*
The deterministic, zero-API-cost `LexicalRanker` ships first (it makes no sense
to spend LLM calls preparing an LLM prompt). `EmbeddingRanker` drops in later
without touching the graph/prune core. **Rejected (for now):** embeddings-first —
better fuzzy recall but adds a model + vector index before the core exists.

**ADR-004 — Malformed syntax → `ParseError` via ERROR-node DFS.** *(2026-07-08)*
tree-sitter is error-tolerant: it never throws, it returns a partial tree with
`ERROR` nodes. Silently trusting that tree would produce wrong output. We DFS for
`ERROR` nodes and raise an explicit, catchable `ParseError` (carrying `filePath`)
so the pipeline can skip a file instead of crashing or emitting garbage.

**ADR-005 — Exported-symbol ranges widen to the `export_statement`.** *(2026-07-08)*
For exported declarations, `SymbolNode.range` spans the whole `export …`
statement (not just the inner declaration) so `sliceNode` yields a
self-contained, re-emittable chunk that keeps the `export` keyword. Internal
declarations use their own range.

**ADR-006 — Stop hook automates the AUTO-LOG only; curated sections by convention.** *(2026-07-08)*
A shell hook cannot author prose (ADL entries, checklist edits). The `Stop` hook
therefore only stamps timestamped checkpoints into the machine-managed AUTO-LOG
block; Claude updates the curated sections at the end of each major task. This is
the honest division of labor between automation and judgment.

**ADR-007 — Re-exports are dependency edges; `extractDependencies` added to the parser.** *(2026-07-08)*
`export { x } from './y'` and `export * from './y'` create real file-to-file
edges just like imports. Missing them would mis-map boundaries (the fixture's
`index → crypto` link is reachable *only* via a re-export). Added a single
file-level `extractDependencies` method (returns both `import` and `re-export`
refs from one parse) rather than have the resolver re-parse or overload
`extractImports` (which stays binding-level for the future pruner).

**ADR-008 — Graph is built by filesystem enumeration, not import-following recursion.** *(2026-07-08)*
`buildGraph` enumerates source files by walking the (acyclic) directory tree,
then resolves each file's edges independently. Because construction never follows
import edges recursively, **import cycles cannot cause infinite loops or stack
overflow at build time** — they are simply represented as cycles in the adjacency
data. Cycle handling is pushed to *consumers*, which must use a visited set; the
shipped `collectReachable` (iterative BFS + visited set + optional hop limit) is
the reference implementation and the seed of the Task 3.0 Selector.
**Rejected:** recursive import-following with a visited guard — equivalent result,
but more fragile (stack depth) and conflates discovery with traversal.

**ADR-009 — Symbol extraction restricted to TOP-LEVEL declarations (bugfix).** *(2026-07-08)*
Task 1.0 used `findAll`, which walks the entire tree and so captured nested
locals (e.g. a `for (let i …)` loop variable) as module symbols — surfaced by the
`crypto.ts` fixture in Task 2.0. `extractSymbols` now iterates only the program's
direct statements (descending one level into `export_statement`). Module symbols
are, by definition, top-level; nested bindings are never independently
addressable by the graph or pruner. Parser tests still pass (they only ever
asserted top-level symbols); the graph fixture is what exposed the gap.

**ADR-010 — Two parser methods added for pruning: `extractImportStatements` + `collectReferences`.** *(2026-07-08)*
The pruner must (a) re-emit *valid* imports — so it needs the whole import
statement span, not the per-binding spans `extractImports` returns — and (b)
know which imports a surviving symbol still uses. `extractImportStatements`
yields `{source, localNames, range}` at statement granularity;
`collectReferences(source, ranges)` returns the identifier + `type_identifier`
names used inside given ranges. Keeping these in the parser (not the pruner)
preserves the single-AST-authority rule (ADR-002). **Rejected:** a substring/regex
scan in the pruner — cheaper but false-matches names in comments/strings.

**ADR-011 — Selection granularity is file-level (whole reachable files) for now.** *(2026-07-08)*
The dependency graph is file-level, so the Selector keeps every top-level symbol
of each file the seeds transitively depend on, and drops unreachable files
whole (billing/pdf/analytics for a JWT focus). This preserves intra-file helper
dependencies without a symbol-level call graph. The keep-set is still expressed
at symbol granularity (`Map<file, Set<symbol>>`) so the pruner and a future
symbol-level graph / `EmbeddingRanker` need no interface change. **Rejected (for
now):** narrowing seed files to only seed symbols — would silently drop same-file
helpers the seed calls and emit broken context. Symbol-level narrowing is
deferred until reference edges exist.

**ADR-012 — Pruner keeps whole import *statements*, verbatim, with dead-import elimination.** *(2026-07-08)*
An import statement is kept iff ≥1 of its local bindings is referenced by a
surviving symbol; it is then re-emitted whole (unused sibling bindings ride
along). Symbols and imports are sliced verbatim at AST boundaries and re-joined
in source order, with identical ranges de-duplicated (so `const a=1, b=2` kept
under both names emits once). Verbatim re-emission means the pruner can never
introduce a syntax error into the code it keeps. **Rejected (for now):**
rebuilding trimmed import lists (drop unused siblings) — more compression, but
per-kind reconstruction (default/namespace/named/type) is error-prone; deferred.
**Known limitation:** whole-file selection (ADR-011) means the pruner currently
receives all symbols of a kept file, so intra-file dead code isn't trimmed
end-to-end yet — the pruner *supports* it (unit-tested with narrow keep-sets),
the Selector just doesn't emit narrow sets until symbol-level edges land.

**ADR-013 — Single `trim()` orchestrator is the one public entry point.** *(2026-07-08)*
`src/core/pipeline.ts` exposes `trim(rootDir, focus, opts) → TrimResult` and wires
graph → rank → select → prune → bundle → metrics. Every stage is reached only
through its contract, so the CLI (and future SDK/HTTP callers) share one code
path. Source files are read exactly once and reused for both the metrics baseline
and pruning. **Rejected:** letting the CLI call each stage itself — would fork the
assembly logic across entry points.

**ADR-014 — CLI stream discipline: bundle→stdout, dashboard→stderr.** *(2026-07-08)*
stdout carries ONLY the Markdown bundle so `contextdiet trim … > b.md` (or a pipe
into an LLM) is pristine; the summary dashboard always goes to stderr. Colour is
auto-disabled when stderr isn't a TTY or `NO_COLOR` is set. This removes any need
for a `--stats` flag. **Rejected:** interleaving dashboard + bundle on stdout —
corrupts piped output.

**ADR-015 — Metrics baseline = naive concatenation of all source files; tokens estimated locally.** *(2026-07-08)*
Reduction is measured against what a developer would otherwise do — dump every
source file into the prompt — i.e. the concatenation of all discovered files.
Tokens are a dependency-free structural estimate (no bundled BPE vocab, no
network), within a few percent of tiktoken on code. **Honest status on the >80%
target:** current end-to-end runs land ~70–77% because whole-file selection
(ADR-011) keeps kept files' internal helpers. The bundle stage already strips
module docblocks/blank framing; the remaining gap closes with **symbol-level
selection** (narrow keep-sets → the pruner trims intra-file dead code it already
supports). The target is therefore a known, scoped next step — not a wall.

**ADR-016 — Symbol-level selection via reference closure (supersedes the ADR-011 limitation).** *(2026-07-08)*
`ReferenceClosureSelector` replaces whole-file selection in the pipeline. From the
seed symbols it walks the reference graph and keeps only what is reachable:
**intra-file references are followed unbounded** (a kept symbol's same-file helpers
are always kept — emitted code never dangles internally), **cross-file references
are followed only within the `--hops` file horizon**, and **namespace/default
imports keep the whole target module** (a `*`/default binding hides which members
are used). The pruner was already symbol-level (Task 3.5), so no pruner change was
needed — only the Selector's precision. **Result:** the `./src` + "malformed syntax
ParseError" benchmark jumped **77.0% → 99.0%** tokens, clearing >80% with correct,
self-contained output. **`GraphSelector` is retained** — `ReferenceClosureSelector`
composes it to compute the file horizon, and it stays valid as a coarse mode.
**Rejected:** bounding intra-file closure by hops — would drop helpers a kept symbol
calls and emit broken context. **Honest caveat surfaced:** symbol-level precision
exposes ranker recall — the lexical ranker seeds by substring, so "JWT verification"
seeds the `JwtPayload` type (contains `jwt`) but not `verifyToken` (`verify`/`token`
aren't substrings of the query tokens). Whole-file selection masked this by keeping
everything nearby; precise selection makes seed quality matter — the motivation for
the roadmapped `EmbeddingRanker`.

**ADR-017 — E2E CLI test runs the shipped `dist/` via plain `node` (drop the `tsx` runtime dep).** *(2026-07-08)*
QA found 3/4 integration tests failing (exit 1) in environments where `tsx` can't
run. Root cause (reproduced by hiding the `tsx` binary → exactly 3 fail / 1 pass):
the e2e harness spawned the CLI through `tsx`, which needs esbuild's native binary
installed via a postinstall that `npm ci` / `--omit=dev` / restricted sandboxes can
block. **Not a CLI or pipeline bug** — orchestration was proven correct by the 99%
benchmark and all unit tests. Fix: `tests/integration/cli.test.ts` now builds
`dist/` once with `tsc` (already required, no native postinstall) and runs the real
`bin/contextdiet.js → dist/cli/index.js` with `process.execPath` (plain `node`).
`tsx` was removed from devDependencies entirely. This is both more robust
(depends only on `node` + already-present tooling) and more faithful (tests the
exact artifact `npx contextdiet` runs). **Rejected:** in-process import of the CLI
— faster, but wouldn't exercise the shipped bin/argv path a user actually hits.

**ADR-018 — npm packaging: `files` allowlist + `prepublishOnly` gate + library exports.** *(2026-07-08)*
The ultracode audit found the published package would have been **broken for every
installer**: with no `files` field, npm falls back to `.gitignore` as its ignore
list, and `.gitignore` excludes `dist/` — so the tarball shipped tests, fixtures,
uncompiled `src/`, and internal docs, but NOT the compiled code the bin shim
imports (`ERR_MODULE_NOT_FOUND` on first run). Fix: `"files": ["dist", "bin"]`
(one allowlist excludes all cruft and includes the artifact), `"prepublishOnly":
"npm run typecheck && npm test && npm run build"` (publishing always ships a
fresh, verified build), `main`/`types`/`exports` → `dist/core/pipeline.js` (the
README markets a library surface; `import { trim } from 'contextdiet'` now works),
plus `repository`/`homepage`/`bugs`/`author`. **Verified end-to-end**: `npm pack`
→ install the real tarball into a clean directory → run the installed binary →
correct bundle + dashboard. **Rejected:** `.npmignore` — a denylist that silently
drifts; the allowlist is the standard, fail-safe fix.

**ADR-019 — Truth-in-marketing: every public number must exist in §6; dependency-direction canon.** *(2026-07-08)*
The audit (20 agents; 15/15 findings adversarially confirmed) caught the launch
docs contradicting the shipped product: a fabricated benchmark presented as "the
numbers on that run" (128,400 → 11,900 tok, 90.7% — no such run exists), flat
"90%" headlines (real range: 68.2–99.0% by focus breadth), a false
"zero-dependency-at-runtime" claim (two runtime deps: `@ast-grep/napi`,
`commander`), and — worst — a kept-chain story (`index → auth → authMiddleware →
jwtUtils → crypto`) that runs **backwards**: our own tests assert dependents are
NOT kept. All copy was rewritten to measured runs (68.2% broad / 98.9% & 99.0%
narrow) and to the canonical framing: *ContextDiet keeps what matched code
depends on, never what calls into it.* **Standing policy:** no number ships in
README/LAUNCH_COPY unless it has a row in §6; direction language follows the
canon. The middleware example is honest because the middleware *lexically
matches* a token-focused query and seeds itself — not because callers are traversed.

**ADR-020 — npm package name: `context-diet` (the unscoped brand word is squatted).** *(2026-07-08)*
Pre-push registry check found `contextdiet@0.2.0` already published (2026-05-19,
maintainer `soilair`, repo Tehlikeli107/contextdiet) — a *different* project with
a near-identical pitch. Publishing was impossible and, worse, every `npx
contextdiet` line in our copy would have executed the third-party package.
Renamed the npm package to **`context-diet`** (verified free) while the **bin
command stays `contextdiet`** — npm runs a package's single bin regardless of
name, so `npx context-diet` works and `npm i -g context-diet` still installs a
`contextdiet` command; the GitHub repo name is unaffected. All ~15 command
strings in README/LAUNCH_COPY updated. **Rejected:** scoped `@user/contextdiet`
(clunkier npx lines), `contextdiet-cli` (undersells the library entry point),
skipping npm (all launch copy leans on the one-line npx demo).

---

## 6. Efficiency Metrics Ledger

**Target: > 80% context compression** (token reduction vs. feeding the raw tree).

Measured end-to-end via `contextdiet trim` (estimated tokens; bundle vs. naive
concatenation of all source files):

| Date | Selection | Root | Focus | `--hops` | Baseline tok | Pruned tok | Token Red. % | ≥80%? | Kept |
|------|-----------|------|-------|:---:|---:|---:|:---:|:---:|:---:|
| 2026-07-08 | **symbol** | `contextdiet/src` | "malformed syntax ParseError" | 2 | 30,472 | 302 | **99.0%** | ✅ **MET** | 2/14 |
| 2026-07-08 | **symbol** | `monolith-auth-app/src` | "Fix JWT verification" (narrow) | 3 | 9,386 | 100 | **98.9%** | ✅ **MET** | 1/8 |
| 2026-07-08 | **symbol** | `monolith-auth-app/src` | "verify the token signature" (broad) | 3 | 9,386 | 2,985 | 68.2% | ⚠️ broad | 3/8 |
| 2026-07-08 | whole-file | `contextdiet/src` | "malformed syntax ParseError" | 1 | 27,797 | 6,408 | 77.0% | ⚠️ | 2/13 |
| 2026-07-08 | whole-file | `monolith-auth-app/src` | "Fix the JWT verification bug" | 3 | 9,386 | 2,773 | 70.5% | ⚠️ | 2/8 |
| 2026-07-08 | whole-file | `contextdiet/src` | "resolve the dependency graph …" (broad) | 3 | 27,797 | 13,663 | 50.9% | ⚠️ | 9/13 |

> **✅ Target MET.** Symbol-level selection (ADR-016) took the same
> `./src` + "malformed syntax ParseError" query from **77.0% → 99.0%** token
> reduction — comfortably past the >80% objective — by keeping only the two leaf
> symbols the query maps to (`ParseError`, `hasErrorNode`) plus their exact
> reference closure, and dropping every unrelated declaration. Output stays
> correct/self-contained (no dangling intra-file references). Absolute reduction
> now scales with how narrowly the focus maps to the code, not with file
> boundaries; broader queries legitimately keep more.

---

## 7. AST Blueprint — Dependency Tracing & Safe Pruning

**How we recursively trace imports and slice away dead code without breaking logic.**

1. **Parse (done).** Each file → `ImportNode[]` + `SymbolNode[]` via
   `AstGrepperParser`. We work on whole declaration nodes, never raw line ranges,
   so any emitted chunk is syntactically complete by construction.

2. **Resolve modules (Task 2.0).** For each `ImportNode.source`, resolve relative
   specifiers (and, later, `tsconfig` path aliases) to concrete files. Treat
   `node_modules` as an **external boundary**: a bare specifier becomes a leaf
   node (recorded, not descended into) — this bounds traversal and keeps the
   graph focused on first-party code.

3. **Build the graph (Task 2.0).** A directed graph over symbols:
   - *import edges*: `localName` in file A → the resolved exported symbol in file B.
   - *reference edges*: within a declaration's body, identifier usages that match
     an in-scope symbol (via ast-grep pattern queries) → call/use edges.
   The symbol table is keyed by `(filePath, name)`.

4. **Seed (Task 2.5).** `Ranker.seed(focus, symbols)` maps the `--focus` string to
   starting symbols. `LexicalRanker`: tokenize the focus, match against symbol
   names / file paths / doc-comments, rank, take the top seeds.

5. **Select (Task 3.0).** BFS/DFS `--hops` levels out from the seed set over the
   graph → the **keep-set** of symbols. Everything unreached is
   "dead *for this task*" (not dead globally — we never delete from disk).

6. **Prune (Task 3.5).** For each file touched by the keep-set, emit only the
   kept symbols via `sliceNode`, plus **only** the imports those symbols actually
   reference. Because we slice at AST declaration boundaries and carry the imports
   each kept node depends on, every emitted unit stays self-consistent — we
   *select* code, we never rewrite it.

7. **Bundle + measure (Task 4.0 / 4.5).** Concatenate into dependency-annotated
   Markdown; tokenize baseline vs. bundle to compute the reduction % logged in §6.

**Safety invariant:** ContextDiet only ever *omits* whole declarations and
re-emits kept ones verbatim. It performs no code transformation, so it cannot
introduce a syntax or logic error into the code it does emit.

---

<!-- AUTO-LOG:START -->
## 8. Auto-Log (machine-managed — do not hand-edit below)

Timestamped session checkpoints appended by `.claude/hooks/update-status.sh`.

- 2026-07-08T22:24:27Z — session checkpoint recorded
- 2026-07-08T22:30:11Z — session checkpoint recorded
- 2026-07-08T22:41:25Z — session checkpoint recorded
- 2026-07-08T22:58:46Z — session checkpoint recorded
- 2026-07-08T23:08:22Z — session checkpoint recorded
- 2026-07-09T02:39:59Z — session checkpoint recorded
- 2026-07-09T03:31:53Z — session checkpoint recorded
- 2026-07-09T03:40:10Z — session checkpoint recorded
- 2026-07-09T03:50:21Z — session checkpoint recorded
<!-- AUTO-LOG:END -->
