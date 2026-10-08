import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { withGTConfig } from "gt-next/config";
import packageJson from "./package.json";

const isMobileBuild = process.env.MOBILE_BUILD === '1';

// ─── Build identity (read it through src/lib/version.ts) ────────────────────
// Inlined into every bundle via `env` below. The commit comes from the CI/host
// env (Coolify passes SOURCE_COMMIT as a build arg — see Dockerfile), else from
// git when building from a checkout, else "dev".
//
// Both values are written back to process.env so the webpack build workers
// (child processes that re-load this file with our env) agree on one value.
// Otherwise client and server bundles could carry different build times, and
// hydrating anything that renders them would mismatch.
function resolveBuildSha(): string {
  const fromEnv =
    process.env.NEXT_PUBLIC_BUILD_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.COOLIFY_GIT_COMMIT_SHA ||
    process.env.GIT_COMMIT ||
    process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const sha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"], timeout: 2000 })
      .toString()
      .trim();
    return sha || "dev";
  } catch {
    return "dev";
  }
}

const BUILD_SHA = (process.env.NEXT_PUBLIC_BUILD_SHA = resolveBuildSha());
const BUILD_TIME = (process.env.NEXT_PUBLIC_BUILD_TIME ||= new Date().toISOString());

const nextConfig: NextConfig = {
  // Static export for mobile builds; otherwise the default build, served by our
  // custom server (server.ts) which also hosts the bot gateway on the same port.
  output: isMobileBuild ? 'export' : undefined,

  // NOTE: keep Next's built-in gzip OFF. It buffers streaming responses, which
  // breaks our realtime transport — chat/voice use Server-Sent Events, and
  // compressing an SSE stream batches/delays events (laggy chat, and the WebRTC
  // offer/answer/ICE handshake never completes → no voice/screen-share).
  // Do compression at the reverse proxy (nginx/Cloudflare) instead, where SSE
  // (text/event-stream) is excluded automatically.
  compress: false,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,

  // Build identity, inlined at build time (see the top of this file).
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_BUILD_SHA: BUILD_SHA,
    NEXT_PUBLIC_BUILD_TIME: BUILD_TIME,
  },

  // Skip type checking during build for faster builds
  typescript: {
    ignoreBuildErrors: true,
  },

  // Experimental optimizations
  experimental: {
    // Parallel webpack compilation across worker threads — major build speedup.
    webpackBuildWorker: true,
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'date-fns',
      'framer-motion',
      'emoji-picker-react',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@icons-pack/react-simple-icons',
      'react-virtuoso',
      'sonner',
    ],
  },

  // Packages that only need transpilation for ESM/CSS handling. Keeping this
  // list short lets webpack skip processing for everything else.
  transpilePackages: [
    'serika-dev-player',
  ],

  // Server-only packages left as external requires — webpack skips bundling
  // them entirely, and Bun resolves them from node_modules at runtime. This
  // avoids webpack processing tens of thousands of lines of AWS SDK / drizzle
  // / sanitize-html code that never runs in the browser.
  serverExternalPackages: [
    // DB drivers (native bindings — Bun resolves fine from node_modules)
    'pg',
    'ioredis',
    // Auth / crypto
    'bcryptjs',
    'jose',
    // AWS SDK (huge — was the single biggest transpile cost)
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    // Security / sanitization
    'sanitize-html',
    'postcss',
    'xss',
    // Rate limiting
    'rate-limiter-flexible',
    // WebSocket
    'ws',
    // ORM
    'drizzle-orm',
  ],
  
  // Image optimization requires a server, so disable it for mobile static export
  images: {
    unoptimized: isMobileBuild,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.backblazeb2.com',
      },
      {
        protocol: 'https',
        hostname: 'cdn.serika.dev',
      },
      {
        protocol: 'https',
        hostname: 'cdn.discordapp.com',
      },
    ],
  },
  
  // Security headers (server-only, ignored during static export)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
          },
        ],
      },
      // Clickjacking protection everywhere except the public, read-only
      // server widget (/widget/<id>), which owners embed on their own sites.
      // 'widget/' with the slash keeps /widget-editor protected.
      {
        source: '/((?!widget/).*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
        ],
      },
      {
        source: '/widget/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors *',
          },
        ],
      },
    ];
  },
  
  // URL rewrites for Discord-like @me route
  async rewrites() {
    return [
      {
        source: '/channels/@me',
        destination: '/channels/me',
      },
    ];
  },

  // webpack customizations for gt-next
  webpack: (config, { isServer }) => {
    // The /changelog page imports CHANGELOG.md as a plain string, so the notes
    // ship inside the build they describe (the runtime image doesn't copy
    // repo-root markdown). See src/app/changelog/page.tsx.
    config.module.rules.push({
      test: /CHANGELOG\.md$/,
      type: 'asset/source',
    });

    if (isServer) {
      // gt-next's .mjs build files use CommonJS require() for their internal
      // loader specifiers (e.g. gt-next/internal/_load-translations). Webpack
      // treats .mjs as ESM by default and ignores those require() calls, so the
      // resolve.alias set by withGTConfig is never applied and the placeholder
      // stub is reached at runtime. Forcing gt-next .mjs to javascript/auto makes
      // webpack parse require() and resolve the alias to src/loadTranslations.ts.
      config.module.rules.push({
        test: /node_modules[\\/]gt-next[\\/].*\.mjs$/,
        type: 'javascript/auto',
      });
    }
    return config;
  },
};

// IMPORTANT: enable gt-next's compile-time transform (type: 'babel').
//
// Without this, gt-next runs in runtime-hash mode: every <T> and every gt("...")
// call computes a sha256 of its source string ON EACH RENDER to look up the
// translation. For the defaultLocale ('en') gt-next short-circuits and does no
// work, but for ANY other locale this hashing runs across the ~100 components
// that use useGT/<T> — including per-message hot paths (MarkdownRenderer,
// MessageGroup, StaffPill, message hover actions) and live countdown timers.
// The result was a saturated main thread and an unusable, laggy UI on every
// non-English language.
//
// The compiler plugin injects the precomputed hash IDs at build time, so at
// runtime gt-next only does a cheap dictionary lookup — no per-render hashing.
//
// NOTE: @generaltranslation/compiler only ships webpack/esbuild/rollup/vite
// transforms — there is NO Turbopack transform, and gt-next disables the
// compiler entirely when process.env.TURBOPACK is set. So this MUST be built
// and run with webpack:
//   - dev  : the custom server (server.ts → next({ dev })) uses webpack already
//   - build: `next build --webpack` (see package.json) — Next 16 would otherwise
//            default to Turbopack and silently drop the transform.
export default withGTConfig(nextConfig, {
  experimentalCompilerOptions: { type: "babel" },
});
