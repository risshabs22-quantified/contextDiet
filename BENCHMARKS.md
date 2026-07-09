# benchmarks (the receipts)

every number quoted in the README comes from a real measured run of
`contextdiet trim` on 2026-07-08. tokens are the same heuristic estimate the
CLI prints (bundle vs. naive concatenation of every source file). reproduce
any row yourself — the fixtures ship in `tests/fixtures/`.

**target: >80% token reduction** on a focused task.

| selection | root | focus | `--hops` | baseline tok | pruned tok | reduction | kept |
|-----------|------|-------|:---:|---:|---:|:---:|:---:|
| symbol | `contextdiet/src` | "malformed syntax ParseError" | 2 | 30,472 | 302 | **99.0%** ✅ | 2/14 |
| symbol | `monolith-auth-app/src` | "Fix JWT verification" (narrow) | 3 | 9,386 | 100 | **98.9%** ✅ | 1/8 |
| symbol | `monolith-auth-app/src` | "verify the token signature" (broad) | 3 | 9,386 | 2,985 | 68.2% | 3/8 |
| whole-file | `contextdiet/src` | "malformed syntax ParseError" | 1 | 27,797 | 6,408 | 77.0% | 2/13 |
| whole-file | `monolith-auth-app/src` | "Fix the JWT verification bug" | 3 | 9,386 | 2,773 | 70.5% | 2/8 |
| whole-file | `contextdiet/src` | "resolve the dependency graph …" (broad) | 3 | 27,797 | 13,663 | 50.9% | 9/13 |

## what the table is telling you

- **symbol-level selection is the whole game.** the exact same query on the
  exact same tree went from 77.0% (whole-file) to **99.0%** (symbol-level)
  because it keeps only the two leaf symbols the query maps to (`ParseError`,
  `hasErrorNode`) plus their exact reference closure — instead of every file
  that happens to contain a match.
- **narrower focus = deeper cuts.** reduction scales with how precisely your
  focus maps to code, not with file boundaries. broad queries legitimately
  keep more, and that's correct behavior — that code really is reachable from
  your task.
- output stays self-contained: no dangling intra-file references, kept code is
  re-emitted verbatim.

try it on this repo:

```bash
npm run build
node bin/contextdiet.js trim ./src --focus "malformed syntax ParseError"
```
