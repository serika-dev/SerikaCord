// SerikaCord Configuration
// Bun automatically loads .env files

export const config = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  // Accounts API (external auth service)
  ACCOUNTS_API_URL: process.env.ACCOUNTS_URL || 'https://accounts.serika.dev',
  ACCOUNTS_SERVICE_KEY: process.env.AUTH_INTERNAL_KEY || process.env.AUTH_SERVICE_INTERNAL_KEY || 'serika-internal-auth-key-change-in-production',

  // SerikaMoe (streaming) — live "now watching" presence source
  SERIKA_MOE_URL: process.env.SERIKA_MOE_URL || 'https://serika.moe',
  SERIKA_MOE_SERVICE_KEY: process.env.SERIKA_MOE_SERVICE_KEY || process.env.SERIKA_SERVICE_KEY || '',
  
  // Database
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/serikacord',
  MONGO_DB_NAME: process.env.MONGO_DB_NAME || 'serikacord',
  
  // Redis
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'serikacord-super-secret-jwt-key-change-in-production',
  JWT_EXPIRES_IN: '30d',
  JWT_REFRESH_EXPIRES_IN: '90d',
  
  // Email (AWS SES)
  EMAIL_HOST: process.env.AWS_EMAIL_ENDPOINT || 'email-smtp.us-east-1.amazonaws.com',
  EMAIL_PORT: parseInt(process.env.AWS_EMAIL_SMTP_PORT || '587'),
  EMAIL_USER: process.env.AWS_EMAIL_SMTP_USERNAME || '',
  EMAIL_PASS: process.env.AWS_EMAIL_PASS || '',
  EMAIL_FROM: process.env.EMAIL_FROM || 'SerikaCord <noreply@serika.email>',
  
  // Discord OAuth
  DISCORD_CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET || '',
  DISCORD_REDIRECT_URI: process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/api/auth/discord/callback',
  
  // Stripe
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  
  // Backblaze B2
  B2_KEY_ID: process.env.B2_KEY_ID || '',
  B2_APPLICATION_KEY: process.env.B2_APPLICATION_KEY || '',
  B2_BUCKET_NAME: process.env.B2_BUCKET_NAME || 'serikacord-media',
  B2_BUCKET_ID: process.env.B2_BUCKET_ID || '',
  B2_ENDPOINT: process.env.B2_ENDPOINT || 's3.eu-central-003.backblazeb2.com',
  B2_REGION: 'eu-central-003',
  
  // CDN
  CDN_URL: process.env.CDN_URL || `https://${process.env.B2_BUCKET_NAME}.s3.eu-central-003.backblazeb2.com`,
  
  // Security
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || '60000'), // 1 minute
  
  // CORS
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,https://serika.dev,https://serika.chat,https://api.serika.chat,https://serika.cc').split(','),
  
  // File upload limits
  MAX_FILE_SIZE: parseInt(process.env.MAX_FILE_SIZE || '104857600'), // 100MB default (free)
  MAX_FILE_SIZE_PREMIUM: parseInt(process.env.MAX_FILE_SIZE_PREMIUM || '524288000'), // 500MB (Serika+)
  MAX_AVATAR_SIZE: parseInt(process.env.MAX_AVATAR_SIZE || '5242880'), // 5MB
  MAX_BANNER_SIZE: parseInt(process.env.MAX_BANNER_SIZE || '10485760'), // 10MB
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const,
  ALLOWED_FILE_TYPES: [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/mpeg', 'audio/ogg', 'audio/wav',
    'video/mp4', 'video/webm',
    'application/pdf',
    'text/plain',
  ] as const,
  
  // Message limits
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || '4000'),
  MAX_MESSAGES_PER_FETCH: parseInt(process.env.MAX_MESSAGES_PER_FETCH || '100'),
  
  // Bot Gateway (standalone Bun WebSocket process — see scripts/gateway.ts)
  GATEWAY_PORT: parseInt(process.env.GATEWAY_PORT || '3001'),
  // Public wss:// URL bots connect to (behind nginx). Falls back to the loopback port in dev.
  GATEWAY_URL: process.env.GATEWAY_URL || 'wss://api.serika.chat/api/v10/gateway',
  // Base URL bots use for REST + the domain returned in webhook/link payloads.
  API_BASE_URL: process.env.API_BASE_URL || 'https://api.serika.chat',

  // Server limits
  MAX_SERVERS_PER_USER: parseInt(process.env.MAX_SERVERS_PER_USER || '100'),
  MAX_CHANNELS_PER_SERVER: parseInt(process.env.MAX_CHANNELS_PER_SERVER || '500'),
  MAX_ROLES_PER_SERVER: parseInt(process.env.MAX_ROLES_PER_SERVER || '250'),
  MAX_MEMBERS_PER_SERVER: parseInt(process.env.MAX_MEMBERS_PER_SERVER || '250000'),

  // Feature flags
  FEATURE_FLAGS: {
    realtime_ws_enabled: (process.env.FEATURE_REALTIME_WS_ENABLED || 'true') === 'true',
    settings_v2_enabled: (process.env.FEATURE_SETTINGS_V2_ENABLED || 'true') === 'true',
    voice_video_enabled: (process.env.FEATURE_VOICE_VIDEO_ENABLED || 'false') === 'true',
  },
} as const;

export type Config = typeof config;
