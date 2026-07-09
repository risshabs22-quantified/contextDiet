/**
 * A module with a DEFAULT export, used to exercise default-import resolution
 * (`import config from './config'`).
 */

export interface AppConfig {
  env: "development" | "production" | "test";
  port: number;
  featureFlags: Record<string, boolean>;
}

const config: AppConfig = {
  env: "development",
  port: 3000,
  featureFlags: {
    circularCheck: true,
    strictImports: true,
  },
};

export default config;
