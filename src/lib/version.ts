// App version + build info, shared by the client UI, server components and the API.
//
// next.config.ts inlines NEXT_PUBLIC_APP_VERSION / NEXT_PUBLIC_BUILD_SHA /
// NEXT_PUBLIC_BUILD_TIME at build time, so everything webpack compiles (all UI,
// server components and the /api/* route handler) reports the build it shipped
// in. The fallbacks below only matter for code Bun runs straight from source
// (server.ts, scripts/gateway.ts), where nothing is inlined.
//
// Never hard-code a version string in the UI — import APP_VERSION / VERSION_LABEL.
// Version numbers are bumped by `bun run release` (scripts/release.ts).
import packageJson from "../../package.json";

export type AppEnvironment = "production" | "canary" | "development";

export interface VersionInfo {
  version: string;
  commit: string | null;
  builtAt: string | null;
  environment: AppEnvironment;
}

/** Semver of this build, e.g. "2.0.0". */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION || packageJson.version;

const rawSha = (
  process.env.NEXT_PUBLIC_BUILD_SHA ||
  process.env.SOURCE_COMMIT ||
  process.env.COOLIFY_GIT_COMMIT_SHA ||
  process.env.GIT_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  ""
).trim().toLowerCase();

/** Full commit SHA of this build, or null when it was built outside git/CI. */
export const BUILD_COMMIT: string | null = /^[0-9a-f]{7,40}$/.test(rawSha) ? rawSha : null;

/** Short commit SHA ("a1b2c3d"), or "dev" when unknown. */
export const BUILD_SHA: string = BUILD_COMMIT ? BUILD_COMMIT.slice(0, 7) : "dev";

/** ISO timestamp of the build, or null when unknown. */
export const BUILD_TIME: string | null = process.env.NEXT_PUBLIC_BUILD_TIME || null;

/** "v2.0.0 (a1b2c3d)" — the label shown in settings and bug reports. */
export const VERSION_LABEL = `v${APP_VERSION} (${BUILD_SHA})`;

/** Public GitHub link for this build's commit, if known. */
export const BUILD_COMMIT_URL: string | null = BUILD_COMMIT
  ? `https://github.com/serika-dev/SerikaCord/commit/${BUILD_COMMIT}`
  : null;

/**
 * Which deployment a hostname belongs to. canary.* and serika.chat are the two
 * hosted deployments; anything else (self-hosted, localhost) falls back to
 * NODE_ENV, which Next inlines on the client.
 */
export function resolveEnvironment(hostname?: string | null): AppEnvironment {
  const host = (hostname || "").toLowerCase().split(":")[0];
  if (host.startsWith("canary.")) return "canary";
  if (host === "serika.chat" || host === "www.serika.chat") return "production";
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** Payload of GET /api/version. */
export function getVersionInfo(hostname?: string | null): VersionInfo {
  return {
    version: APP_VERSION,
    commit: BUILD_COMMIT,
    builtAt: BUILD_TIME,
    environment: resolveEnvironment(hostname),
  };
}
