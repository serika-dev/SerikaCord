// Server-only build info. The API runs from source under Bun (server.ts), so
// nothing from next.config.ts `env` is inlined into it — and next.config.ts,
// loaded again at server boot, would report the boot time as the build time.
// The mtime of .next/BUILD_ID is when `next build` actually finished.
import { statSync } from "node:fs";
import { join } from "node:path";

let cached: string | null | undefined;

/** ISO time the Next build on disk was produced, or null (e.g. `next dev`). */
export function getServerBuildTime(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = statSync(join(process.cwd(), ".next", "BUILD_ID")).mtime.toISOString();
  } catch {
    cached = null;
  }
  return cached;
}
