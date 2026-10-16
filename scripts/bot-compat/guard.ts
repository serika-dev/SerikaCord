/**
 * Safety guard for the bot-compat test stack. Every bot-compat script calls
 * assertLocalStack() BEFORE importing any app module (imports are dynamic),
 * so nothing can connect to the production Postgres/Redis or call an
 * external service.
 *
 * Rules:
 *  - POSTGRES_URI must point at 127.0.0.1:55432 and REDIS_URL at 127.0.0.1:56379
 *    (the throwaway docker containers from ./stack.sh).
 *  - Every secret for an external service must be unset.
 *  - URL settings that default to real services are forced to a dead local
 *    port (127.0.0.1:9) unless already local.
 */

const PG_RE = /^postgres(?:ql)?:\/\/[^@/]*@127\.0\.0\.1:55432\/[A-Za-z0-9_]+$/;
const REDIS_RE = /^redis:\/\/127\.0\.0\.1:56379(?:\/\d+)?$/;

/** Secrets / credentials for external services: must be unset. */
const FORBIDDEN = [
  'B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_ID', 'FCM_SERVICE_ACCOUNT_JSON', 'PHOTODNA_KEY', 'PHOTODNA_KEY_SECONDARY',
  'AUTH_INTERNAL_KEY', 'AUTH_SERVICE_INTERNAL_KEY', 'SERIKA_MOE_SERVICE_KEY', 'SERIKA_SERVICE_KEY', 'LASTFM_API_KEY',
  'LASTFM_API_SECRET', 'TWITCH_CLIENT_ID', 'TWITCH_CLIENT_SECRET', 'AWS_EMAIL_SMTP_USERNAME', 'AWS_EMAIL_PASS',
  'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'SERIKA_DISCORD_TOKEN', 'SERIKA_DISCORD_ID', 'BOT_TOKEN',
  'STRIPE_SECRET_KEY', 'TURN_USERNAME', 'TURN_PASSWORD', 'TURN_URL', 'TURN_WORKER_URL', 'FISH_API_KEY',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET', 'STEAM_API_KEY',
  'SERIKA_GIFS_API_KEY', 'SERIKA_GIFS_KEY', 'SERIKA_TRANSLATE_KEY', 'FIELD_ENCRYPTION_KEY', 'E2EE_PIN_PEPPER',
];

/** URLs that default to real hosts: forced local. */
const LOCAL_URLS = ['ACCOUNTS_URL', 'ACCOUNTS_PUBLIC_URL', 'SERIKA_MOE_URL', 'SERIKA_GIFS_API', 'SERIKA_GIFS', 'B2_ENDPOINT', 'AWS_EMAIL_ENDPOINT'];
const DEAD = 'http://127.0.0.1:9';

function isLocalUrl(v: string): boolean {
  try {
    const u = new URL(v.includes('://') ? v : `http://${v}`);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

export function assertLocalStack(): void {
  const problems: string[] = [];
  const pg = process.env.POSTGRES_URI ?? '';
  const redis = process.env.REDIS_URL ?? '';
  if (!PG_RE.test(pg)) problems.push('POSTGRES_URI must be postgres://…@127.0.0.1:55432/<db>');
  if (!REDIS_RE.test(redis)) problems.push('REDIS_URL must be redis://127.0.0.1:56379');
  for (const k of FORBIDDEN) if (process.env[k]) problems.push(`${k} must be unset`);
  for (const k of LOCAL_URLS) {
    const v = process.env[k];
    if (v && !isLocalUrl(v)) problems.push(`${k} must be unset or local`);
  }
  if (problems.length > 0) {
    console.error('bot-compat: refusing to start, this is not the local test stack:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(2);
  }
  for (const k of LOCAL_URLS) if (!process.env[k]) process.env[k] = DEAD;
  process.env.DISABLE_DISCORD_BOT = '1';
  process.env.DISABLE_SEARCH_BACKFILL = '1';
  process.env.CDN_URL ||= 'http://127.0.0.1:9/cdn';
}
