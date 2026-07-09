/**
 * Entry point for the edge-cases fixture. This single file combines every
 * import/export style that tends to break naive regex-based token packers:
 *
 *   1. Named import          -> import { aHelper } from './a'
 *   2. Default import        -> import config from './config'
 *   3. Namespace/star import -> import * as DB from './db'
 *   4. Mixed default+named   -> import config2, { AppConfig } from './config'
 *   5. Type-only import      -> import type { Record } from './db'
 *   6. Re-export             -> export { hash } from './crypto'
 *
 * Note the circular pair a.ts <-> b.ts is reachable through this graph.
 */

// 1. Named imports (reaches the circular a <-> b pair).
import { aHelper, describeA } from "./a";
import { describeB } from "./b";

// 2. Default import.
import config from "./config";

// 3. Namespace / star import.
import * as DB from "./db";

// 4. Mixed default + named import from the same module.
import config2, { type AppConfig } from "./config";

// 5. Type-only import.
import type { Record as DbRecord } from "./db";

// 6. Re-export a named symbol from another module.
export { hash } from "./crypto";

// Also re-export a renamed symbol to stress alias resolution.
export { hashHex as digestHex } from "./crypto";

export function bootstrap(): AppConfig {
  DB.connect(DB.DEFAULT_URL);

  const seeded: DbRecord = DB.insert("seed", { at: Date.now() });
  void seeded;

  // Exercise the circular helpers so the cycle is genuinely reachable.
  const total = aHelper(4);

  // eslint-disable-next-line no-console
  console.log(describeA(), describeB(), `total=${total}`, `count=${DB.count()}`);

  return config;
}

export const runtimeConfig = config2;
