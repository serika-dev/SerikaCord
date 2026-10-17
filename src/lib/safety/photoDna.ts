// PhotoDNA Cloud Service "Match" response handling (pure). The network call is
// in src/lib/services/photoDnaClient.ts.
//
//   POST https://eu-api.microsoftmoderator.com/photodna/v1.0/Match
//   Ocp-Apim-Subscription-Key: <key>     body: the image (jpeg/png/gif/bmp/tiff)
//   → { Status: { Code: 3000 }, IsMatch, MatchDetails: { MatchFlags: [{ Source, Violations, MatchDistance }] }, TrackingId }
//
// Images must be at least 160x160 and at most 4 MB; the client normalises.

// Accounts live in one datacenter and the others answer 401 "invalid
// subscription key". Serika's account is in the EU one (PhotoDNA support,
// Oct 2026); PHOTODNA_ENDPOINT overrides it.
export const PHOTODNA_ENDPOINT =
  process.env.PHOTODNA_ENDPOINT || 'https://eu-api.microsoftmoderator.com/photodna/v1.0/Match';
export const PHOTODNA_MIN_SIDE = 160;
export const PHOTODNA_MAX_BYTES = 4 * 1024 * 1024;

export interface PhotoDnaMatchFlag {
  source: string;
  violations: string[];
  matchDistance: number | null;
  matchId: string | null;
}

export type PhotoDnaResult =
  | { status: 'match'; trackingId: string | null; flags: PhotoDnaMatchFlag[]; isTestSource: boolean }
  | { status: 'clean'; trackingId: string | null }
  | { status: 'error'; code: number | null; description: string; retryWithOtherKey: boolean };

/** Reads a Match response body + HTTP status into a decision. */
export function parsePhotoDnaResponse(httpStatus: number, body: unknown): PhotoDnaResult {
  // Bad/expired key or quota: try the secondary key.
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return { status: 'error', code: httpStatus, description: `HTTP ${httpStatus}`, retryWithOtherKey: true };
  }
  if (!body || typeof body !== 'object') {
    return { status: 'error', code: httpStatus, description: `HTTP ${httpStatus}: no body`, retryWithOtherKey: httpStatus >= 500 };
  }
  const b = body as Record<string, unknown>;
  const statusObj = (b.Status && typeof b.Status === 'object' ? b.Status : {}) as Record<string, unknown>;
  const code = typeof statusObj.Code === 'number' ? statusObj.Code : null;
  const trackingId = typeof b.TrackingId === 'string' ? b.TrackingId : null;
  if (httpStatus >= 400 || (code !== null && code !== 3000)) {
    return {
      status: 'error',
      code,
      description: typeof statusObj.Description === 'string' ? statusObj.Description : `HTTP ${httpStatus}`,
      retryWithOtherKey: httpStatus >= 500,
    };
  }
  if (b.IsMatch !== true) return { status: 'clean', trackingId };
  const details = (b.MatchDetails && typeof b.MatchDetails === 'object' ? b.MatchDetails : {}) as Record<string, unknown>;
  const flags: PhotoDnaMatchFlag[] = (Array.isArray(details.MatchFlags) ? details.MatchFlags : []).map((f) => {
    const flag = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
    const info = Array.isArray(flag.AdvancedInfo) ? flag.AdvancedInfo as Array<{ Key?: unknown; Value?: unknown }> : [];
    const matchId = info.find((i) => i?.Key === 'MatchId')?.Value;
    return {
      source: typeof flag.Source === 'string' ? flag.Source : 'unknown',
      violations: Array.isArray(flag.Violations) ? flag.Violations.filter((v): v is string => typeof v === 'string') : [],
      matchDistance: typeof flag.MatchDistance === 'number' ? flag.MatchDistance : null,
      matchId: typeof matchId === 'string' ? matchId : null,
    };
  });
  // Microsoft's sample images match the "Test" source: handy for checking the
  // integration without treating it as a real report.
  const isTestSource = flags.length > 0 && flags.every((f) => f.source.toLowerCase() === 'test');
  return { status: 'match', trackingId, flags, isTestSource };
}

/** Content types PhotoDNA accepts as-is. */
export function isPhotoDnaNativeType(contentType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff'].includes(contentType.toLowerCase().split(';')[0].trim());
}
