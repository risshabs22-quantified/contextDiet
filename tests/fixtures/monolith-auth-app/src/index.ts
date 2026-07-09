/**
 * Application entry point.
 *
 * Boots an Express app and mounts all route modules. This is the root of the
 * import graph. The pruner starts traversal here.
 *
 * IMPORTANT for the fixture: `index` imports BOTH the auth flow AND the
 * unrelated routes. A naive "keep everything the entry point touches" pruner
 * would keep billing/analytics too. A correct AST pruner focused on
 * "Fix JWT verification" should follow only the auth -> jwtUtils -> crypto
 * chain and slice the rest away.
 */

import express, { type Express } from "express";
import { authRouter } from "./routes/auth";
import { billingRouter } from "./routes/billing";
import { analytics } from "./services/analytics";

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    analytics.track("request", { path: req.path, method: req.method });
    next();
  });

  app.use("/auth", authRouter);
  app.use("/billing", billingRouter);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  return app;
}

export function start(port = 3000): void {
  const app = createApp();
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`monolith-auth-app listening on :${port}`);
  });
}

if (require.main === module) {
  start(Number(process.env.PORT) || 3000);
}
