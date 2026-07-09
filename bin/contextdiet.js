#!/usr/bin/env node
// Executable shim for the published package. Delegates to the compiled CLI.
// For development: `npm run build && node bin/contextdiet.js …` (emits dist/).
import './../dist/cli/index.js';
