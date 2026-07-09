#!/usr/bin/env node
// Executable shim for the published package. Delegates to the compiled CLI.
// Run `npm run build` first (emits dist/). For development, invoke the TypeScript
// entry directly via `npx tsx src/cli/index.ts …`.
import './../dist/cli/index.js';
