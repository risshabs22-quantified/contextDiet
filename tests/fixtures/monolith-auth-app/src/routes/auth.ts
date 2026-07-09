/**
 * Authentication routes: register, login, and a protected "me" endpoint.
 *
 * Part of the authentication dependency chain:
 *
 *   index -> auth route -> { authMiddleware, jwtUtils }
 */

import { Router, type Request, type Response } from "express";
import { authMiddleware, type AuthenticatedRequest } from "../middleware/authMiddleware";
import { signToken } from "../utils/jwtUtils";
import { hashPassword, verifyPassword } from "../utils/crypto";

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  role: string;
}

// In-memory user store for the fixture.
const users = new Map<string, StoredUser>();

export const authRouter = Router();

authRouter.post("/register", (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!isValidEmail(email) || !isStrongPassword(password)) {
    return res.status(400).json({ error: "Invalid email or weak password" });
  }
  if (users.has(email)) {
    return res.status(409).json({ error: "User already exists" });
  }

  const user: StoredUser = {
    id: generateId(),
    email,
    passwordHash: hashPassword(password),
    role: "user",
  };
  users.set(email, user);

  const token = signToken({ sub: user.id, role: user.role });
  return res.status(201).json({ token });
});

authRouter.post("/login", (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const user = users.get(email);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({ sub: user.id, role: user.role });
  return res.json({ token });
});

authRouter.get("/me", authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  return res.json({ user: req.user });
});

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

function isStrongPassword(password: unknown): password is string {
  return typeof password === "string" && password.length >= 8;
}

function generateId(): string {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
