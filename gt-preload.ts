// gt-next runtime loader shim (server-side).
//
// gt-next resolves local translations by doing, at runtime:
//     require("gt-next/internal/_load-translations")
// That specifier is a placeholder stub in node_modules that THROWS unless the
// bundler rewrites it to our loader. gt-next relies on webpack/turbopack
// resolve.alias to do that rewrite — but webpack does NOT rewrite a CommonJS
// require() that lives inside gt-next's ESM (.mjs) build, so under webpack the
// require reaches the throwing stub → "loadTranslations() ... could not be
// resolved at runtime" (500 in dev, silent English fallback in prod).
//
// Since our whole app is served by a custom server (server.ts), we fix it at the
// Node module-resolution layer: Module._resolveFilename is patched to point the
// gt-next internal specifier to the real loadTranslations.ts before any gt-next
// server code runs. This is runtime-only and works in both Bun and Node.
//
// This MUST be imported before any gt-next server code executes — see server.ts,
// where it is the very first import.
import { resolve } from "node:path";
import Module from "node:module";

const LOAD_TRANSLATIONS_PATH = resolve(
  process.cwd(),
  "src",
  "loadTranslations.ts"
);

const NodeModule = Module as any;
const originalResolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (
  request: string,
  parent: any,
  isMain?: boolean,
  options?: any
): string {
  if (request === "gt-next/internal/_load-translations") {
    return LOAD_TRANSLATIONS_PATH;
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
