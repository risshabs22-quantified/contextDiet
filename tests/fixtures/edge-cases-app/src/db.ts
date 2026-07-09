/**
 * A module designed to be consumed via a star/namespace import
 * (`import * as DB from './db'`). It exports many named symbols so the AST
 * engine has to resolve namespace member access, not just direct named imports.
 */

export interface Record {
  id: string;
  value: unknown;
}

const store = new Map<string, Record>();

export function connect(url: string): void {
  // No-op fixture connection.
  void url;
}

export function insert(id: string, value: unknown): Record {
  const record: Record = { id, value };
  store.set(id, record);
  return record;
}

export function find(id: string): Record | undefined {
  return store.get(id);
}

export function remove(id: string): boolean {
  return store.delete(id);
}

export function count(): number {
  return store.size;
}

export const DEFAULT_URL = "memory://localhost";
