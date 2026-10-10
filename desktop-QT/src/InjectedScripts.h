#pragma once

// JavaScript injected into every page load of the hosted app. Kept here so
// MainWindow.cpp reads as wiring rather than a wall of script.

// Desktop marker (DocumentCreation). Built at runtime with the version and
// platform: see MainWindow::desktopMarkerScript(). The web app's
// src/lib/desktop/bridge.ts reads window.__serikaDesktop synchronously.
static const char *DESKTOP_MARKER_JS = R"(
(function () {
  if (window.__serikaDesktop) return;
  window.__serikaDesktop = Object.freeze({ shell: 'qt', protocol: %1, version: '%2', platform: '%3' });
  window.__serikaSetBadge = function (count) {
    try { window.qt.webBridge.setBadgeCount(count); } catch (e) {}
  };
})();
)";

// Tauri compatibility shim (DocumentCreation): older web builds detect the
// desktop client through window.__TAURI__.
static const char *TAURI_SHIM_JS = R"(
(function () {
  if (window.__TAURI__) return;

  // Minimal Tauri shim — enough for the web app to detect desktop client
  window.__TAURI__ = {
    core: {
      invoke: function(cmd) {
        // Intercept clipboard-manager read_image and use Qt native clipboard
        if (cmd === 'plugin:clipboard-manager|read_image') {
          return new Promise(function(resolve, reject) {
            try {
              var bridge = window.qt && window.qt.webBridge;
              if (!bridge || !bridge.readClipboardImage) {
                reject(new Error('WebBridge not ready'));
                return;
              }
              var result = bridge.readClipboardImage();
              if (!result || !result.rgba || !result.width || !result.height) {
                resolve(null);
                return;
              }
              resolve({
                rgba: result.rgba,
                width: result.width,
                height: result.height
              });
            } catch (e) {
              reject(e);
            }
          });
        }
        return Promise.reject(new Error('Not implemented in Qt client: ' + cmd));
      },
    },
    event: {
      listen: function() { return Promise.resolve(function(){}); },
      emit: function() { return Promise.resolve(); },
    },
    window: {
      getCurrent: function() {
        return {
          setTitle: function(t) { try { window.qt.webBridge.setWindowTitle(t); } catch(e) {} },
          setZoom: function(z) { try { window.qt.webBridge.setZoom(z); } catch(e) {} },
          toggleFullscreen: function() { try { window.qt.webBridge.toggleFullscreen(); } catch(e) {} },
          close: function() {},
          minimize: function() {},
          maximize: function() {},
        };
      },
    },
    // Marker so the web app knows this is a desktop client
    __serikaQtClient: true,
  };

  // Tag same-origin API calls as coming from the desktop client. Cross-origin
  // requests (CDN, embeds) are left alone: a custom header would force a CORS
  // preflight those hosts don't answer.
  var _fetch = window.fetch;
  window.fetch = function(u, o) {
    try {
      var href = typeof u === 'string' ? u : (u && u.url) || String(u);
      if (new URL(href, location.href).origin !== location.origin) return _fetch.call(window, u, o);
    } catch (e) { return _fetch.call(window, u, o); }
    o = o || {};
    if (o.headers instanceof Headers) {
      o.headers.set('x-serika-client', 'tauri');
    } else {
      o.headers = Object.assign({}, o.headers || {}, { 'x-serika-client': 'tauri' });
    }
    return _fetch.call(window, u, o);
  };
})();
)";

// Rich-presence reporter: the native PresenceDetector pushes detected
// games/apps here and the page reports them to the API.
static const char *PRESENCE_REPORTER_JS = R"(
(function () {
  if (window.__serikaPresenceInit) return;
  window.__serikaPresenceInit = true;

  var current = [];
  var reported = {};
  var startedAt = {};

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'include' }, opts || {}));
  }

  async function resolveAndReport(activities) {
    if (!activities || activities.length === 0) {
      if (Object.keys(reported).length > 0) {
        reported = {}; startedAt = {};
        try { await api('/api/users/me/rich-presence', { method: 'DELETE' }); } catch (e) {}
      }
      return;
    }

    var payloads = [];
    for (var i = 0; i < activities.length; i++) {
      var activity = activities[i];
      var name = activity.name;
      var largeImageUrl = null;

      if (activity.kind === 'game') {
        try {
          var q = 'name=' + encodeURIComponent(activity.name);
          if (activity.steamAppId) q += '&appId=' + encodeURIComponent(activity.steamAppId);
          var res = await api('/api/igdb/game?' + q);
          if (res.ok) {
            var data = await res.json();
            if (data && data.game) {
              name = data.game.name || name;
              largeImageUrl = data.game.coverUrl || null;
            }
          }
        } catch (e) {}
      }

      var key = activity.kind + '|' + name;
      if (!startedAt[key] || !reported[key] || reported[key].name !== name) {
        startedAt[key] = new Date().toISOString();
      }

      var payload = {
        type: activity.kind === 'game' ? 'game' : activity.kind,
        name: name,
        largeImageUrl: largeImageUrl || undefined,
        largeImageText: name,
        startedAt: startedAt[key],
      };
      payloads.push(payload);
      reported[key] = payload;
    }

    try {
      await api('/api/users/me/rich-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: payloads })
      });
    } catch (e) {}
  }

  window.__serikaSetActivities = function (activities) {
    current = activities || [];
    resolveAndReport(current);
  };

  setInterval(function () { if (current && current.length) resolveAndReport(current); }, 45000);
})();
)";

// QWebChannel hookup (DocumentCreation, after qwebchannel.js). Exposes
// window.qt.webBridge and fires `serika-desktop-bridge` once it's usable.
static const char *CHANNEL_INIT_JS = R"(
(function () {
  if (window.__serikaChannelInit) return;
  window.__serikaChannelInit = true;

  function initChannel() {
    if (typeof QWebChannel === 'undefined' || !window.qt || !window.qt.webChannelTransport) {
      setTimeout(initChannel, 30);
      return;
    }
    new QWebChannel(window.qt.webChannelTransport, function (channel) {
      window.qt.webBridge = channel.objects.webBridge;
      try { window.qt.webBridge.pageCreated(); } catch (e) {}
      try { window.dispatchEvent(new Event('serika-desktop-bridge')); } catch (e) {}
    });
  }
  initChannel();
})();
)";

// Viewport-unit polyfill for old QtWebEngine (Chromium < 108 lacks dvh).
static const char *VIEWPORT_POLYFILL_JS = R"(
(function () {
  if (window.__serikaViewportFix) return;
  window.__serikaViewportFix = true;

  var supported = false;
  try { supported = CSS.supports('height', '100dvh'); } catch (e) {}
  if (supported) return;

  // Chromium drops unparseable declarations, so the dvh rules can't be
  // recovered from the CSSOM. Instead, scan the DOM for Tailwind utility
  // classes that use the new units and synthesize equivalent vh/vw rules.
  var PROPS = {
    'h': 'height', 'min-h': 'min-height', 'max-h': 'max-height',
    'w': 'width',  'min-w': 'min-width',  'max-w': 'max-width'
  };
  var TOKEN_RE = /^(!?)((?:min-|max-)?[hw])-(?:([dsl]v[hw])|\[(\d*\.?\d+)([dsl]v[hw])\])$/;

  function ruleFor(token) {
    var m = TOKEN_RE.exec(token);
    if (!m) return '';
    var prop = PROPS[m[2]];
    if (!prop) return '';
    var unit = (m[3] || m[5]).slice(-2) === 'vw' ? 'vw' : 'vh';
    var value = (m[4] || '100') + unit;
    var bang = m[1] ? ' !important' : '';
    return '.' + CSS.escape(token) + '{' + prop + ':' + value + bang + '}\n';
  }

  var seen = {};
  var styleEl = null;
  function scan() {
    var els = document.querySelectorAll(
      '[class*="dvh"],[class*="dvw"],[class*="svh"],[class*="svw"],[class*="lvh"],[class*="lvw"]');
    var add = '';
    for (var i = 0; i < els.length; i++) {
      var classes = els[i].classList;
      for (var j = 0; j < classes.length; j++) {
        var token = classes[j];
        if (seen[token]) continue;
        seen[token] = true;
        add += ruleFor(token);
      }
    }
    if (!add) return;
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement('style');
      styleEl.id = 'serika-dvh-polyfill';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    styleEl.textContent += add;
  }

  var pending = null;
  function scheduleScan() {
    if (pending) return;
    pending = setTimeout(function () { pending = null; scan(); }, 100);
  }

  scan();
  document.addEventListener('DOMContentLoaded', scan);
  window.addEventListener('load', scan);
  new MutationObserver(scheduleScan).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['class']
  });
})();
)";

static const char *CSS_FIXES_JS = R"(
(function () {
  if (window.__serikaCssFixes) return;
  window.__serikaCssFixes = true;

  var root = document.head || document.documentElement;
  if (!root) return;

  var style = document.createElement('style');
  style.id = 'serika-qt-fixes';
  style.textContent = [
    // Crisp font rendering
    'body { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }',
    // Native app feel: no image dragging
    'img { -webkit-user-drag: none; }',
  ].join('\n');
  root.appendChild(style);
})();
)";

// Desktop keyboard shortcuts (DocumentReady): zoom, fullscreen, devtools, reload.
static const char *DESKTOP_ENHANCEMENTS_JS = R"(
(function () {
  if (window.__serikaDesktopInit) return;
  window.__serikaDesktopInit = true;

  try { document.body.spellcheck = true; } catch (e) {}

  document.addEventListener('keydown', function (e) {
    var bridge = window.qt && window.qt.webBridge;
    if (!bridge) return;
    var mod = e.ctrlKey || e.metaKey;

    if (mod && !e.altKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault(); bridge.setZoom(0.1); return;
    }
    if (mod && !e.altKey && e.key === '-') {
      e.preventDefault(); bridge.setZoom(-0.1); return;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key === '0') {
      e.preventDefault(); bridge.setZoom(0); return;
    }
    if (e.key === 'F11') {
      e.preventDefault(); bridge.toggleFullscreen(); return;
    }
    if (e.key === 'F12' || (mod && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
      e.preventDefault(); bridge.toggleDevTools(); return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault(); location.reload(); return;
    }
  }, true);
})();
)";
