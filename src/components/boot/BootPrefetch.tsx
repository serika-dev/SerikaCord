import { preload } from "react-dom";

/**
 * Starts the app's startup API requests from inline HTML, so they run in
 * parallel with downloading/parsing the JS bundle instead of after hydration.
 * Consumed through `sharedGet` (src/lib/bootFetch.ts).
 */
const BOOT_URLS = [
  "/api/users/@me",
  "/api/users/@me/servers",
  "/api/dms",
  "/api/users/me/settings",
  "/api/users/@me/mentions",
  "/api/users/@me/read-states",
  "/api/users/@me/channel-activity",
];

const script = `(function(){try{var b=window.__serikaBoot||(window.__serikaBoot={});var t=performance.now();${JSON.stringify(
  BOOT_URLS,
)}.forEach(function(u){if(!b[u])b[u]={p:fetch(u,{credentials:"include"}),t:t};});}catch(e){}})();`;

export function BootPrefetch() {
  // <link rel=preload as=fetch> in <head> starts these as soon as the head
  // arrives; the inline script below can't run until the stylesheets have
  // loaded. Its fetch() calls then pick up the preloaded responses.
  for (const url of BOOT_URLS) {
    preload(url, { as: "fetch", crossOrigin: "use-credentials" });
  }
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
