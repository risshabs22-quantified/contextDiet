/**
 * JWT signing and verification utilities.
 *
 * Part of the authentication dependency chain:
 *
 *   authMiddleware -> jwtUtils -> crypto
 *
 * This is the file most relevant to a "Fix JWT verification" task, so the
 * pruner MUST keep it (and its `crypto` dependency).
 */

import { hmacSha256 } from "./crypto";

const DEFAULT_SECRET = "context-diet-fixture-secret";
const DEFAULT_TTL_SECONDS = 60 * 60; // 1 hour

export interface JwtPayload {
  sub: string;
  role?: string;
  iat: number;
  exp: number;
  [claim: string]: unknown;
}

export interface SignOptions {
  secret?: string;
  ttlSeconds?: number;
}

/**
 * Signs a JWT-like token: base64url(header).base64url(payload).signature
 */
export function signToken(
  claims: Record<string, unknown>,
  options: SignOptions = {}
): string {
  const secret = options.secret ?? DEFAULT_SECRET;
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: String(claims.sub ?? "anonymous"),
    iat: now,
    exp: now + ttl,
    ...claims,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`, secret);

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verifies a token's signature and expiry. Returns the decoded payload or
 * throws a TokenError. This is the function `authMiddleware` depends on.
 */
export function verifyToken(token: string, secret: string = DEFAULT_SECRET): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenError("Malformed token: expected 3 segments");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expected = sign(`${encodedHeader}.${encodedPayload}`, secret);

  if (!timingSafeEqual(signature, expected)) {
    throw new TokenError("Invalid signature");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp < now) {
    throw new TokenError("Token expired");
  }

  return payload;
}

export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

function sign(data: string, secret: string): string {
  return base64UrlEncode(hmacSha256(data, secret));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}
