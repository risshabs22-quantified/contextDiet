/**
 * Circular dependency: a.ts <-> b.ts
 *
 * `a` imports from `b`, and `b` imports back from `a`. A naive traversal that
 * doesn't track visited nodes will infinite-loop here. The AST engine must
 * detect the cycle and handle it gracefully.
 */

import { bHelper, B_CONSTANT } from "./b";

export const A_CONSTANT = 1;

export function aHelper(depth: number): number {
  if (depth <= 0) {
    return A_CONSTANT;
  }
  // Mutual recursion across the circular boundary.
  return A_CONSTANT + bHelper(depth - 1);
}

export function describeA(): string {
  return `a uses B_CONSTANT=${B_CONSTANT}`;
}
