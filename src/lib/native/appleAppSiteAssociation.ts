/**
 * The apple-app-site-association document served at
 * /.well-known/apple-app-site-association (src/app/.well-known/...).
 *
 * - applinks: https links to these paths open the iOS app instead of Safari
 *   (the app routes them in NativeAppBridge, App `appUrlOpen`).
 * - webcredentials: the app may use passwords / passkeys saved for this site.
 *
 * The app ID is "<Apple Team ID>.<bundle id>" and must match the signed app.
 */

/** Apple Developer team that signs the iOS app (override with APPLE_TEAM_ID). */
export const DEFAULT_APPLE_TEAM_ID = "B648X59JCQ";
export const IOS_BUNDLE_ID = "dev.serika.serikacord";

/** In-app paths that open the app when tapped elsewhere. Everything else stays in the browser. */
export const UNIVERSAL_LINK_PATHS = ["/channels/*", "/invite/*", "/dm/*", "/qr/*", "/oauth2/*"] as const;

const TEAM_ID_RE = /^[A-Z0-9]{10}$/;

export function iosAppId(teamId?: string | null): string {
  const team = (teamId ?? "").trim().toUpperCase();
  return `${TEAM_ID_RE.test(team) ? team : DEFAULT_APPLE_TEAM_ID}.${IOS_BUNDLE_ID}`;
}

export function buildAppleAppSiteAssociation(teamId?: string | null) {
  const appId = iosAppId(teamId);
  return {
    applinks: {
      // `apps` must be present and empty for the legacy (iOS 12) format.
      apps: [] as string[],
      details: [
        {
          // iOS 13+ reads appIDs + components; older versions appID + paths.
          appIDs: [appId],
          components: UNIVERSAL_LINK_PATHS.map((path) => ({ "/": path })),
          appID: appId,
          paths: [...UNIVERSAL_LINK_PATHS],
        },
      ],
    },
    webcredentials: {
      apps: [appId],
    },
  };
}
