/**
 * Express authentication middleware.
 *
 * Part of the authentication dependency chain:
 *
 *   auth route -> authMiddleware -> jwtUtils -> crypto
 */

import type { NextFunction, Request, Response } from "express";
import { verifyToken, TokenError, type JwtPayload } from "../utils/jwtUtils";

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Extracts a bearer token from the Authorization header, verifies it, and
 * attaches the decoded payload to `req.user`.
 */
export function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractBearerToken(req);

  if (!token) {
    res.status(401).json({ error: "Missing Authorization header" });
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    if (err instanceof TokenError) {
      res.status(401).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "Authentication failure" });
  }
}

/**
 * Guards a route so that only users with a specific role may proceed.
 */
export function requireRole(role: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: `Requires role: ${role}` });
      return;
    }
    next();
  };
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;

  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;

  return value.trim();
}
