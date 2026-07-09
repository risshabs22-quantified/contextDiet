/**
 * Circular dependency: b.ts <-> a.ts
 *
 * The other half of the cycle. Imports from `a`, which imports from `b`.
 */

import { aHelper, A_CONSTANT } from "./a";

export const B_CONSTANT = 2;

export function bHelper(depth: number): number {
  if (depth <= 0) {
    return B_CONSTANT;
  }
  return B_CONSTANT + aHelper(depth - 1);
}

export function describeB(): string {
  return `b uses A_CONSTANT=${A_CONSTANT}`;
}
