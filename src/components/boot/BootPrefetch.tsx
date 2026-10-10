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

// The page's own data: the open channel (its channel list, permissions and
// first page of messages), DM, or group DM (the group + its first page). Skipped when the message cache already has
// the conversation (the client then asks only for newer messages).
const routeScript = `var p=location.pathname.split("/"),U=/^[0-9a-f-]{36}$/i,add=function(u){if(!b[u])b[u]={p:fetch(u,{credentials:"include"}),t:t};},cached=function(k){try{var v=localStorage.getItem("sc:msgcache:"+k);return v&&v.length>2;}catch(e){return false;}};
if(p[1]==="channels"&&U.test(p[2]||"")){add("/api/servers/"+p[2]+"/channels");add("/api/servers/"+p[2]+"/members/@me/permissions");if(U.test(p[3]||"")&&!cached("/api/channels/"+p[3]))add("/api/channels/"+p[3]+"/messages?limit=50");}
else if(p[1]==="dm"&&p[2]==="group"&&U.test(p[3]||"")){add("/api/group-dms/"+p[3]);if(!cached("/api/group-dms/"+p[3]))add("/api/group-dms/"+p[3]+"/messages?limit=50");}
else if(p[1]==="dm"&&U.test(p[2]||"")&&!cached("/api/dms/"+p[2]))add("/api/dms/"+p[2]+"/messages?limit=50");`;

const script = `(function(){try{var b=window.__serikaBoot||(window.__serikaBoot={});var t=performance.now();${JSON.stringify(
  BOOT_URLS,
)}.forEach(function(u){if(!b[u])b[u]={p:fetch(u,{credentials:"include"}),t:t};});${routeScript}}catch(e){}})();`;

export function BootPrefetch() {
  // <link rel=preload as=fetch> in <head> starts these as soon as the head
  // arrives; the inline script below can't run until the stylesheets have
  // loaded. Its fetch() calls then pick up the preloaded responses.
  for (const url of BOOT_URLS) {
    preload(url, { as: "fetch", crossOrigin: "use-credentials" });
  }
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
