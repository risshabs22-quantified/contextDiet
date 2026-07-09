/**
 * A leaf module used to exercise re-exports (see `index.ts`, which does
 * `export { hash } from './crypto'`).
 */

export function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashHex(input: string): string {
  return hash(input).toString(16).padStart(8, "0");
}

export const HASH_ALGO = "fnv-1a";
