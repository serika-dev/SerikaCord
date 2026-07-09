import type { NextConfig } from "next";

const isMobileBuild = process.env.MOBILE_BUILD === '1';

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

  // Skip type checking during build for faster builds
  typescript: {
    ignoreBuildErrors: false,
  },

  // Experimental optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons', 'date-fns', 'framer-motion', 'emoji-picker-react'],
  },

  // Transpile serika-dev-player for proper CSS/ESM handling
  // Also transpile CJS/native packages that Turbopack auto-externalizes with hashed
  // symlinks (e.g. pg-587764f78a6c7a9c). Bun's module resolver cannot follow these
  // symlinks, so we force Turbopack to bundle them instead. See:
  // https://github.com/vercel/next.js/issues/86866
  transpilePackages: [
    'serika-dev-player',
    // DB drivers
    'pg',
    'ioredis',
    // Auth / crypto
    'bcryptjs',
    'jose',
    // AWS SDK (auto-externalized by default)
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    // Security / sanitization (postcss is pulled in by sanitize-html)
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
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
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
};

export default nextConfig;
