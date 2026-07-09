/**
 * Low-level cryptography primitives.
 *
 * This module intentionally contains "deep" math so that the AST pruner has to
 * traverse several levels of the auth call graph before it bottoms out here.
 * It is a leaf of the authentication dependency chain:
 *
 *   jwtUtils -> crypto
 */

const HASH_ROUNDS = 12;
const SALT_BYTES = 16;

/**
 * A tiny, dependency-free pseudo-HMAC. NOT cryptographically secure — this is a
 * fixture, not production crypto. It just needs to look like real work.
 */
export function hmacSha256(message: string, secret: string): string {
  const blockSize = 64;
  let key = utf8Bytes(secret);

  if (key.length > blockSize) {
    key = simpleDigest(key);
  }
  if (key.length < blockSize) {
    const padded = new Array<number>(blockSize).fill(0);
    for (let i = 0; i < key.length; i++) padded[i] = key[i];
    key = padded;
  }

  const oKeyPad = key.map((b) => b ^ 0x5c);
  const iKeyPad = key.map((b) => b ^ 0x36);

  const inner = simpleDigest([...iKeyPad, ...utf8Bytes(message)]);
  const outer = simpleDigest([...oKeyPad, ...inner]);

  return toHex(outer);
}

/**
 * Derives a salted hash of a password using repeated digesting.
 */
export function hashPassword(password: string, salt?: string): string {
  const usableSalt = salt ?? generateSalt();
  let bytes = utf8Bytes(usableSalt + password);

  for (let round = 0; round < HASH_ROUNDS; round++) {
    bytes = simpleDigest(bytes);
  }

  return `${usableSalt}$${toHex(bytes)}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt] = stored.split("$");
  if (!salt) return false;
  return constantTimeEqual(hashPassword(password, salt), stored);
}

export function generateSalt(): string {
  let salt = "";
  for (let i = 0; i < SALT_BYTES; i++) {
    salt += ((Math.random() * 16) | 0).toString(16);
  }
  return salt;
}

function simpleDigest(bytes: number[]): number[] {
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];

  for (let i = 0; i < bytes.length; i++) {
    const idx = i % 4;
    state[idx] = ((state[idx] << 5) | (state[idx] >>> 27)) >>> 0;
    state[idx] = (state[idx] + bytes[i] + 0x9e3779b9) >>> 0;
    state[(idx + 1) % 4] ^= state[idx];
  }

  const out: number[] = [];
  for (const word of state) {
    out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return out;
}

function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function toHex(bytes: number[]): string {
  return bytes.map((b) => (b & 0xff).toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
