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
  "/api/users/@me/mentions?unread=1",
  "/api/users/@me/read-states",
  "/api/users/@me/channel-activity",
  "/api/changelogs",
];

// The page's own data: the open channel (its channel list, permissions and
// first page of messages), DM, or group DM (the group + its first page). Skipped when the message cache already has
// the conversation (the client then asks only for newer messages).
const routeScript = `var p=location.pathname.split("/"),U=/^[0-9a-f-]{36}$/i,add=function(u){if(!b[u])b[u]={p:fetch(u,{credentials:"include"}),t:t};},cached=function(k){try{var v=localStorage.getItem("sc:msgcache:"+k);return v&&v.length>2;}catch(e){return false;}};
if(p[1]==="channels"&&U.test(p[2]||"")){add("/api/servers/"+p[2]+"/channels");add("/api/servers/"+p[2]+"/members/@me/permissions");if(U.test(p[3]||"")&&!cached("/api/channels/"+p[3]))add("/api/channels/"+p[3]+"/messages?limit=50");}
else if(p[1]==="dm"&&p[2]==="group"&&U.test(p[3]||"")){add("/api/group-dms/"+p[3]);if(!cached("/api/group-dms/"+p[3]))add("/api/group-dms/"+p[3]+"/messages?limit=50");}
else if(p[1]==="dm"&&U.test(p[2]||"")&&!cached("/api/dms/"+p[2]))add("/api/dms/"+p[2]+"/messages?limit=50");`;

// Only the app shell (/channels/*, /dm/*) has startup data; on other pages
// (landing, login, docs) the script returns at once.
const script = `(function(){try{if(!/^\\/(channels|dm)(\\/|$)/.test(location.pathname))return;var b=window.__serikaBoot||(window.__serikaBoot={});var t=performance.now();${JSON.stringify(
  BOOT_URLS,
)}.forEach(function(u){if(!b[u])b[u]={p:fetch(u,{credentials:"include"}),t:t};});${routeScript}}catch(e){}})();`;

/**
 * Rendered in the root layout's <head>: it runs while the head is parsed, as
 * early as a preload link would start these, and outside the app shell's auth
 * gate (which renders nothing until the session is known). The shell is
 * mounted once above /channels and /dm, so this can't live in their layouts.
 */
export function BootPrefetch() {
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: script }} />;
}

// Android app (Capacitor): hide the native launch screen as soon as the page
// has painted, instead of waiting out its fixed duration. Placed after the
// layout's markup, so it runs once the stylesheets and the web splash
// (AppSplash) are ready. A no-op in browsers and the desktop app.
const hideNativeSplash = `(function(){try{var c=window.Capacitor;if(!c||!c.isNativePlatform||!c.isNativePlatform())return;var o={fadeOutDuration:150},s=c.Plugins&&c.Plugins.SplashScreen,p=s&&s.hide?s.hide(o):c.nativePromise?c.nativePromise("SplashScreen","hide",o):null;if(p&&p.catch)p.catch(function(){});}catch(e){}})();`;

export function NativeSplashHide() {
  return <script dangerouslySetInnerHTML={{ __html: hideNativeSplash }} />;
}
