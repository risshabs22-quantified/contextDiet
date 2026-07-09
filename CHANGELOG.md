# changelog

## unreleased

- new `--list` flag — dry run that prints just the kept file paths so you can
  sanity-check the selection before dumping the whole bundle anywhere
- way better error messages: nonexistent path, path-is-a-file, and unwritable
  `-o` targets now all say exactly what went wrong instead of a vague
  "no source files found"
- `--version` now reads from `package.json` instead of a hardcoded string
  (with a test so the two can never drift again)
- benchmark receipts moved into [`BENCHMARKS.md`](./BENCHMARKS.md)

## 0.1.0 — 2026-07-09

first release! `contextdiet-cli` on npm.

- `contextdiet trim <path> --focus "<task>"` — parses your codebase with a
  real AST (ast-grep), builds the dependency graph, seeds it from your focus
  query, keeps the symbol-level reference closure, prunes everything else,
  bundles the survivors into one dense markdown stream
- bundle → stdout, stats dashboard → stderr
- `--hops`, `-o/--output`
- measured up to 99.0% token reduction on narrow queries (see BENCHMARKS.md)
