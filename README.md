<div align="center">

# ContextDiet

### your AI agent is reading your ENTIRE repo to fix one bug. and you're paying for every single token of that. i fixed it.

[![CI](https://github.com/risshabs22-quantified/contextDiet/actions/workflows/ci.yml/badge.svg)](https://github.com/risshabs22-quantified/contextDiet/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4.svg)](#wanna-hack-on-it)

**stop paying LLMs to read your dead code lol**

</div>

---

## ok so what is this

basically: you're fixing a JWT bug. your AI agent does NOT need to see your billing module, your pdf generator, or your analytics service to fix a JWT bug. but every "repo to prompt" tool out there is literally just `cat` with extra steps — it dumps your whole repo into the context window and your wallet takes the hit.

ContextDiet actually *reads* your code. like properly — it parses it into an AST (a real syntax tree, not regex, we don't do regex crimes here), builds a dependency graph of what imports what, figures out which symbols match the thing you're trying to do, and then keeps ONLY the code that's actually reachable from there. everything else? gone. sliced. it never existed.

```bash
npx contextdiet-cli trim ./src --focus "verify the token signature"
```

the markdown bundle goes to **stdout** (pipe it wherever — a file, your clipboard, straight into an LLM), and the pretty stats dashboard goes to **stderr**, so this gives you a totally clean file:

```bash
npx contextdiet-cli trim ./src --focus "verify the token signature" > context.md
```

and here's a **100% real run** of ContextDiet eating its own source code (`npm run build && node bin/contextdiet.js trim ./src --focus "malformed syntax ParseError"` — try it yourself, it's reproducible):

```
  ContextDiet · trim
  ────────────────────────────────────────────────────
  focus      malformed syntax ParseError
  root       ./src  (ContextDiet's own engine)
  seeds      2 matched   ·   kept 2/14 files
  ────────────────────────────────────────────────────
  original     62.6 KB   ~30,472 tok
  pruned         616 B      ~302 tok
  ────────────────────────────────────────────────────
  reduction  99.0% tokens   ✓ >80% target met
             99.0% bytes
  output     (stdout)
```

> yes that says **99.0%**. no i didn't make it up — every number in this readme is from an actual measured run, receipts are in [`BENCHMARKS.md`](./BENCHMARKS.md). narrow focused tasks get you up to 99%, broader tasks that genuinely touch more code get less (like 68.2% on the example further down). the more precisely you describe your task, the harder it cuts. that's just how graphs work.

---

## why not just use repomix or whatever

because those are **text dumpers**. they walk your folders, glue the files together, maybe strip some comments if they're feeling fancy. they have zero idea what your code *means*, so they send all of it and let you sort it out. with your money.

| | text dumpers | **ContextDiet** |
|---|---|---|
| what it understands | files & bytes | AST symbols & the actual graph |
| what gets sent | literally everything | only code reachable from your task |
| dead code | shipped to the model 💸 | sliced 🔪 |
| circular imports | duplicated / mangled | handled, `a → b → a` won't loop |
| re-exports & aliases | regex breaks them quietly | resolved via real AST |
| network / API calls | sometimes (embeddings 🤢) | **zero. runs fully on your machine.** |
| same input twice | order-dependent chaos | byte-identical output every time |

> the whole insight is stupidly simple: LLMs bill per token, and most tokens in a repo dump are irrelevant to your task. your billing module has ZERO structural connection to your auth bug. so why are you paying to send it?? ContextDiet answers "what does the model actually need to see" with graph theory instead of vibes.

---

## how do i use it

```bash
# zero install, just run it
npx contextdiet-cli trim ./src --focus "verify the token signature"

# or install it globally (the command you get is just `contextdiet`, short and clean)
npm install -g contextdiet-cli
contextdiet trim ./src --focus "add rate limiting to the login route"
```

**`contextdiet trim <path> [options]`**

| flag | what it does | default |
|---|---|---|
| `<path>` | the folder to analyze | *(required)* |
| `-f, --focus <query>` | describe your task in normal words. this picks the seeds. | *(required)* |
| `--hops <n>` | how many dependency-graph jumps out from the seeds | `2` |
| `-o, --output <file>` | write the bundle to a file instead of stdout | *(stdout)* |

> bundle → stdout, dashboard → stderr. so `contextdiet trim … > bundle.md` gives you a clean file with zero dashboard noise in it. you're welcome.

---

## how it works (the nerdy part)

it's a five-stage pipeline. every stage is a pure module — source in, data out, no hidden state, all independently tested. i spent way too long on this diagram so you WILL look at it:

```
                         ┌───────────────────────────────────────────────┐
   ./src  ──────────────▶│                  ContextDiet                   │
   --focus "verify…"     └───────────────────────────────────────────────┘
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
┌───────────────────────┐   kept code    ┌──────────────────────────┐
│  4. SELECT + PRUNE    │───────────────▶│   5. MARKDOWN BUNDLER    │─────▶  stdout  (→ pipe to file)
│                       │                │                          │        + metrics → stderr
│ walks the graph from  │                │ fences each kept file    │
│ the seeds (reference  │                │ with START/END delimiters│        Raw:         30,472 tok
│ closure), keeps only  │                │ optimized for LLM        │        Compressed:      302 tok
│ reachable declarations│                │ context parsing          │        Reduction:       99.0%
└───────────────────────┘                └──────────────────────────┘
```

| stage | where it lives | what it does |
|---|---|---|
| **1. parser** | `src/core/parser` | pulls imports & top-level symbols out of every file with a real AST (ast-grep). if your file has broken syntax it throws a catchable `ParseError` instead of silently handing you a half-wrong tree like some tools i could mention |
| **2. dependency graph** | `src/core/graph` | maps who imports who, including re-exports and aliases. cycle-safe, so circular imports can't infinite-loop it |
| **3. lexical seed ranker** | `src/core/ranker` | turns your `--focus` sentence into weighted seed symbols. strips filler words, splits camelCase (`verifyJWT → verify, jwt`), scores the overlap. costs $0, no API, same answer every time |
| **4. selector + pruner** | `src/core/graph` · `src/core/pruner` | walks the graph outward from the seeds and keeps the reference closure (same-file helpers always come along so nothing dangles), then re-emits the survivors *verbatim* — it never rewrites your code |
| **5. markdown bundler** | `src/core/bundler` | packs the survivors into one dense delimiter-fenced stream + a metrics report proving how much it saved you |

---

## example: the monolith test app

imagine a backend where `index.ts` boots express and mounts **auth**, **billing**, and **analytics**:

```
src/
├── index.ts                  ← 🔴 sliced  (it's a dependent, not a dependency)
├── routes/auth.ts            ← 🔴 sliced  (calls the token code, but the model doesn't need it)
├── middleware/authMiddleware ← 🟢 kept    (its token handlers match the focus)
├── utils/jwtUtils.ts         ← 🟢 kept    (verifyToken and the gang)
├── utils/crypto.ts           ← 🟢 kept    (jwtUtils needs it)
├── routes/billing.ts         ← 🔴 sliced
├── utils/pdfGenerator.ts     ← 🔴 sliced
└── services/analytics.ts     ← 🔴 sliced
```

run `--focus "verify the token signature"` and it seeds the symbols matching the task (the middleware's token handlers, `verifyToken`) and keeps their **dependency chain**: `authMiddleware → jwtUtils → crypto`. that's 3 of 8 files, measured at **9,386 → 2,985 tokens (68.2%)**.

the direction matters and it's the whole trick: ContextDiet keeps what your focused code **depends on**, never what just *calls into it*. the entry point imports the JWT stuff, sure — but you don't need the entry point to understand token verification. and billing / pdf / analytics have zero structural connection to the token path so they never even had a chance.

narrower focus = deeper cuts: point it at ContextDiet's own repo with `--focus "malformed syntax ParseError"` and it finds exactly two leaf symbols → **99.0%** (30,472 → 302 tokens). fr.

---

## wanna hack on it

```bash
git clone https://github.com/risshabs22-quantified/contextDiet.git
cd contextDiet
npm install

npm run typecheck   # strict TS, no implicit any, no mercy
npm test            # the whole vitest suite
npm run build       # compiles to dist/
```

needs Node `>= 20`. that's it.

PRs are extremely welcome, just keep the vibe:

1. **fork it**, branch it (`git checkout -b feat/my-cool-thing`)
2. **keep it strict** — everything has to pass `npm run typecheck` and `npm test`, no exceptions, the CI will catch you
3. **tests first** — every new thing ships with vitest coverage, copy the style in `tests/unit`
4. **stay modular** — every pipeline stage is a pure module behind an interface. new parser backends (tree-sitter, SWC) should slot in without touching anything else
5. **open the PR** — CI runs on every push. green check = ready

good first issues if you want in: more language parsers, a smarter ranker (embeddings as an *option*, never a requirement), more bundle formats (JSON, XML).

---

## license

**[MIT](./LICENSE)**. use it, fork it, ship it, sell it, i genuinely do not mind. © 2026 the ContextDiet contributors.

<div align="center">

**if this saved you tokens, [drop a ⭐](https://github.com/risshabs22-quantified/contextDiet) — it costs you nothing and it makes my whole day, fr**

</div>
