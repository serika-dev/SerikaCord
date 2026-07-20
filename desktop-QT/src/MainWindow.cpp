#include "MainWindow.h"
#include "WebBridge.h"
#include "TrayIcon.h"
#include "PresenceDetector.h"
#include "DeepLinkHandler.h"
#include "SerikaWebPage.h"
#include "qwebchannel_js.h"

#include <QWebEngineSettings>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebChannel>
#include <QDesktopServices>
#include <QCloseEvent>
#include <QKeyEvent>
#include <QJsonDocument>
#include <QJsonArray>
#include <QApplication>
#include <QScreen>
#include <QGuiApplication>
#include <QWindow>
#include <QTimer>
#include <QVBoxLayout>
#include <QMessageBox>
#include <QStandardPaths>
#include <QDir>
#include <QFile>

#ifdef Q_OS_WIN
#include <windows.h>
#include <shellapi.h>
#endif

#ifdef Q_OS_MACOS
#import <Cocoa/Cocoa.h>
#endif

// ── Tauri compatibility shim (injected before page scripts) ─────────────────
// Sets window.__TAURI__ so the web app hides the download button, sets the
// x-serika-client header, and treats this as a desktop client.

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

  // Patch fetch to add x-serika-client header (same as layout.tsx does)
  var _fetch = window.fetch;
  window.fetch = function(u, o) {
    o = o || {};
    o.headers = o.headers || {};
    if (o.headers instanceof Headers) {
      o.headers.set('x-serika-client', 'tauri');
    } else {
      o.headers['x-serika-client'] = 'tauri';
    }
    return _fetch.call(window, u, o);
  };
})();
)";

// ── Presence reporter JS (injected into the web page) ────────────────────────

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

// ── Desktop enhancements JS (injected into the web page) ─────────────────────

static const char *DESKTOP_ENHANCEMENTS_JS = R"(
(function () {
  if (window.__serikaDesktopInit) return;
  window.__serikaDesktopInit = true;

  // Enable spellcheck
  try { document.body.spellcheck = true; } catch (e) {}

  // Keyboard shortcuts
  document.addEventListener('keydown', function (e) {
    var bridge = window.qt && window.qt.webBridge;
    if (!bridge) return;
    var mod = e.ctrlKey || e.metaKey;

    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault(); bridge.setZoom(0.1); return;
    }
    if (mod && e.key === '-') {
      e.preventDefault(); bridge.setZoom(-0.1); return;
    }
    if (mod && e.key === '0') {
      e.preventDefault(); bridge.setZoom(0); return;
    }
    if (e.key === 'F11') {
      e.preventDefault(); bridge.toggleFullscreen(); return;
    }
    if (e.key === 'F12' || (mod && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
      e.preventDefault(); bridge.toggleDevTools(); return;
    }
  });

  // Track SPA title changes
  function updateTitle() {
    try { window.qt.webBridge.setWindowTitle(document.title); } catch (e) {}
  }
  updateTitle();
  if (document.head) {
    new MutationObserver(updateTitle).observe(document.head, {
      childList: true, subtree: true, characterData: true,
    });
  }

  // Expose badge setter
  window.__serikaSetBadge = function (count) {
    try { window.qt.webBridge.setBadgeCount(count); } catch (e) {}
  };
})();
)";

// ── QWebChannel setup JS ─────────────────────────────────────────────────────
// qwebchannel.js is loaded from Qt resources; this script waits for it
static const char *CHANNEL_INIT_JS = R"(
(function () {
  if (window.__serikaChannelInit) return;
  window.__serikaChannelInit = true;

  function initChannel() {
    if (typeof QWebChannel === 'undefined') {
      // qwebchannel.js not loaded yet, retry shortly
      setTimeout(initChannel, 50);
      return;
    }
    new QWebChannel(qt.webChannelTransport, function (channel) {
      window.qt = window.qt || {};
      window.qt.webBridge = channel.objects.webBridge;
    });
  }
  initChannel();
})();
)";

// ── Viewport-unit polyfill for QtWebEngine ───────────────────────────────────
// Qt WebEngine 6.4 ships Chromium 102, which predates dvh/svh/lvh viewport
// units (Chromium 108). The web app sizes its root layout with Tailwind's
// h-dvh, so on old engines the root container collapses and the layout
// breaks (over-tall chat, clipped user panel). When the engine lacks dvh
// support, rewrite every same-origin stylesheet rule using those units to
// plain vh, and keep watching for late-loaded stylesheets.

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

// ── Minimal CSS polish (Tauri parity — no layout overrides) ──────────────────
// Runs at DocumentReady when document.head is guaranteed to exist

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

// ── MainWindow implementation ────────────────────────────────────────────────

MainWindow::MainWindow(QWidget *parent)
    : QMainWindow(parent)
    , m_view(new QWebEngineView(this))
    , m_channel(new QWebChannel(this))
    , m_webBridge(new WebBridge(this))
    , m_trayIcon(nullptr)
    , m_presenceDetector(nullptr)
    , m_presenceHeartbeat(new QTimer(this))
{
    setWindowTitle("SerikaCord");
    setMinimumSize(940, 500);

    // Native window decorations (matches the Tauri client): the OS provides the
    // title bar, dragging, resize handles and window snapping. This gives correct
    // high-DPI scaling and reliable behaviour on X11, Wayland, Windows and macOS —
    // unlike a frameless window, which has to reimplement all of that by hand.
    setStyleSheet("QMainWindow { background: #1a1a1e; }");

    // Dynamic window sizing: 80% of available screen, capped at 1600x1000
    auto screen = QGuiApplication::primaryScreen();
    if (screen) {
        auto geometry = screen->availableGeometry();
        int w = qMin(static_cast<int>(geometry.width() * 0.8), 1600);
        int h = qMin(static_cast<int>(geometry.height() * 0.85), 1000);
        resize(w, h);
        move((geometry.width() - w) / 2 + geometry.x(),
             (geometry.height() - h) / 2 + geometry.y());
    } else {
        resize(1280, 800);
    }

    // Set up web engine profile with persistent storage for session persistence.
    //
    // IMPORTANT: QWebEngineProfile::defaultProfile() is OFF-THE-RECORD (in-memory)
    // in Qt6 — its cookies and storage are wiped on exit and setPersistentStoragePath
    // is a no-op on it. To actually persist the login session across restarts we must
    // construct a *named* profile, which is on-disk by default.
    auto *profile = new QWebEngineProfile(QStringLiteral("SerikaCord"), this);
    m_profile = profile;
    profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
    // Set a persistent storage path so cookies/cache survive restart
    QString storagePath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    if (storagePath.isEmpty())
        storagePath = QDir::homePath() + "/.local/share/SerikaCord";
    QDir().mkpath(storagePath);
    profile->setPersistentStoragePath(storagePath);
    profile->setCachePath(storagePath + "/cache");
    profile->setHttpCacheType(QWebEngineProfile::DiskHttpCache);

    // Set a desktop user-agent so the web app serves the full desktop layout
    QString ua = profile->httpUserAgent();
    // Ensure "Tauri" is NOT in the UA (we want the web app to rely on __TAURI__)
    // Make sure it looks like a desktop Chrome browser
    if (!ua.contains("Chrome/")) {
        ua += " Chrome/120.0.0.0";
    }
    // Remove any mobile indicators
    ua.remove("Mobile");
    ua.remove("Android");
    ua.remove("iPhone");
    profile->setHttpUserAgent(ua);

    // Set up the page
    m_page = new SerikaWebPage(profile, this);
    m_view->setPage(m_page);
    m_view->setParent(this);
    // Enable standard settings
    auto *settings = m_page->settings();
    settings->setAttribute(QWebEngineSettings::JavascriptEnabled, true);
    settings->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, false);
    settings->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, true);
    settings->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, true);
    // SpellCheckEnabled is available in Qt 6.5+; skip on 6.4
#if QT_VERSION >= QT_VERSION_CHECK(6, 5, 0)
    settings->setAttribute(QWebEngineSettings::SpellCheckEnabled, true);
#endif
    settings->setAttribute(QWebEngineSettings::AutoLoadImages, true);
    settings->setAttribute(QWebEngineSettings::PluginsEnabled, true);
    settings->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
    // Smooth scrolling
    settings->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, true);

    // Inject scripts before page loads
    auto makeScript = [](const QString &name, const QString &source,
                         QWebEngineScript::InjectionPoint point) {
        QWebEngineScript s;
        s.setName(name);
        s.setSourceCode(source);
        s.setInjectionPoint(point);
        s.setWorldId(QWebEngineScript::MainWorld);
        s.setRunsOnSubFrames(false);
        return s;
    };

    // Inject qwebchannel.js library first, before channel init
    profile->scripts()->insert(
        makeScript("qwebchannel_lib", QWEBCHANNEL_JS,
                   QWebEngineScript::DocumentCreation));

    // Tauri shim must run first, before any page scripts
    profile->scripts()->insert(
        makeScript("tauri_shim", TAURI_SHIM_JS,
                   QWebEngineScript::DocumentCreation));
    profile->scripts()->insert(
        makeScript("presence_reporter", PRESENCE_REPORTER_JS,
                   QWebEngineScript::DocumentCreation));
    profile->scripts()->insert(
        makeScript("channel_init", CHANNEL_INIT_JS,
                   QWebEngineScript::DocumentCreation));
    profile->scripts()->insert(
        makeScript("viewport_polyfill", VIEWPORT_POLYFILL_JS,
                   QWebEngineScript::DocumentReady));
    profile->scripts()->insert(
        makeScript("css_fixes", CSS_FIXES_JS,
                   QWebEngineScript::DocumentReady));
    profile->scripts()->insert(
        makeScript("desktop_enhancements", DESKTOP_ENHANCEMENTS_JS,
                   QWebEngineScript::DocumentReady));

    // The web view is the central widget and fills the entire content area below
    // the native title bar.
    m_view->setContentsMargins(0, 0, 0, 0);
    setCentralWidget(m_view);

    // Focus the web view so keyboard events work immediately
    m_view->setFocus();

    // Web channel for JS ↔ C++ communication
    setupWebChannel();

    // Connect web page signals
    connect(m_page, &QWebEnginePage::titleChanged, this, &MainWindow::onTitleChanged);
    connect(m_page, &QWebEnginePage::urlChanged, this, &MainWindow::onUrlChanged);

    // Connect web bridge signals
    connect(m_webBridge, &WebBridge::zoomRequested, this, [this](double delta) {
        setZoom(delta == 0.0 ? 1.0 : m_currentZoom + delta);
    });
    connect(m_webBridge, &WebBridge::fullscreenRequested, this, &MainWindow::toggleFullscreen);
    connect(m_webBridge, &WebBridge::devToolsRequested, this, &MainWindow::toggleDevTools);
    connect(m_webBridge, &WebBridge::windowTitleChangeRequested, this,
            [this](const QString &title) {
        setWindowTitle(title.isEmpty() ? "SerikaCord" : title);
        emit windowTitleChanged(title);
    });
    connect(m_webBridge, &WebBridge::badgeCountRequested, this, &MainWindow::setBadgeCount);
    connect(m_webBridge, &WebBridge::muteToggled, this, [this](bool muted) {
        m_muted.store(muted);
        emit muteToggled(muted);
    });

    // Tray icon
    m_trayIcon = new TrayIcon(this, this);
    m_trayIcon->show();
    connect(m_trayIcon, &TrayIcon::quitRequested, qApp, &QApplication::quit);
    connect(m_trayIcon, &TrayIcon::muteToggled, this, [this](bool muted) {
        m_muted.store(muted);
        QString js = muted
            ? "document.querySelectorAll('audio,video').forEach(function(e){e.muted=true;e.volume=0;});"
            : "document.querySelectorAll('audio,video').forEach(function(e){e.muted=false;e.volume=1;});";
        m_page->runJavaScript(js);
    });

    // Presence detector
    m_presenceDetector = new PresenceDetector(this);
    connect(m_presenceDetector, &PresenceDetector::activitiesDetected,
            this, [this](const QJsonArray &activities) {
        injectPresenceActivities(activities);
    });
    m_presenceDetector->start();

    // Presence heartbeat (re-report every 45s to keep server TTL alive)
    m_presenceHeartbeat->setInterval(45000);
    connect(m_presenceHeartbeat, &QTimer::timeout, this, &MainWindow::onPresenceHeartbeat);
    m_presenceHeartbeat->start();
}

MainWindow::~MainWindow() = default;

void MainWindow::setupWebChannel() {
    m_channel->registerObject("webBridge", m_webBridge);
    m_page->setWebChannel(m_channel);
}

void MainWindow::loadUrl(const QString &url) {
    m_view->setUrl(QUrl(url));
}

void MainWindow::showAndFocus() {
    show();
    raise();
    activateWindow();
    setWindowState((windowState() & ~Qt::WindowMinimized) | Qt::WindowActive);
}

void MainWindow::toggleVisibility() {
    if (isVisible()) {
        hide();
    } else {
        showAndFocus();
    }
}

void MainWindow::setZoom(double factor) {
    m_currentZoom = factor;
    m_view->setZoomFactor(factor);
}

void MainWindow::toggleFullscreen() {
    if (isFullScreen())
        showNormal();
    else
        showFullScreen();
}

void MainWindow::toggleDevTools() {
    // Toggle DevTools — works in both debug and release
    m_page->runJavaScript(
        "if (!document.querySelector('qt-devtools')) {"
        "  var s = document.createElement('script');"
        "  s.src = 'https://cdn.jsdelivr.net/npm/eruda@3.0.1/eruda.min.js';"
        "  s.onload = function() { eruda.init({ tool: ['console', 'network', 'resources', 'elements'] }); eruda.show(); };"
        "  s.id = 'qt-devtools';"
        "  document.head.appendChild(s);"
        "} else { eruda.destroy(); document.getElementById('qt-devtools').remove(); }"
    );
}

void MainWindow::setBadgeCount(int count) {
#ifdef Q_OS_WIN
    // Windows: set taskbar overlay icon badge
    Q_UNUSED(count)
    // Qt doesn't have a direct badge API; would need ITaskbarList3
#elif Q_OS_MACOS
    // macOS: set dock badge
    [[NSApp dockTile] setBadgeLabel:[NSString stringWithFormat:@"%d", count > 0 ? count : 0]];
#else
    Q_UNUSED(count)
#endif
}

void MainWindow::toggleMute() {
    bool newMuted = !m_muted.load();
    m_muted.store(newMuted);
    QString js = newMuted
        ? "document.querySelectorAll('audio,video').forEach(function(e){e.muted=true;e.volume=0;});"
        : "document.querySelectorAll('audio,video').forEach(function(e){e.muted=false;e.volume=1;});";
    m_page->runJavaScript(js);
    emit muteToggled(newMuted);
}

void MainWindow::navigateToDeepLink(const QString &path) {
    // Convert serikacord://path to https://serika.chat/path
    QString urlPath = DeepLinkHandler::normalizeLink(path);
    QString fullUrl = QString("%1%2").arg(SerikaConfig::APP_URL, urlPath);
    loadUrl(fullUrl);
    showAndFocus();
}

void MainWindow::injectPresenceActivities(const QJsonArray &activities) {
    QString jsonStr = QJsonDocument(activities).toJson(QJsonDocument::Compact);
    m_lastPresenceJson = jsonStr;
    QString js = QString("window.__serikaSetActivities && window.__serikaSetActivities(%1);")
                     .arg(jsonStr);
    m_page->runJavaScript(js);
}

void MainWindow::onPresenceHeartbeat() {
    if (!m_lastPresenceJson.isEmpty() && m_lastPresenceJson != "[]") {
        QString js = QString("window.__serikaSetActivities && window.__serikaSetActivities(%1);")
                         .arg(m_lastPresenceJson);
        m_page->runJavaScript(js);
    }
}

void MainWindow::onTitleChanged(const QString &title) {
    setWindowTitle(title.isEmpty() ? "SerikaCord" : title);
    emit windowTitleChanged(title);
}

void MainWindow::onUrlChanged(const QUrl &url) {
    // Could be used for deep link handling
    Q_UNUSED(url)
}

void MainWindow::closeEvent(QCloseEvent *event) {
    // Close-to-tray: hide instead of quit
    event->ignore();
    hide();
}

void MainWindow::keyPressEvent(QKeyEvent *event) {
    // Handle keyboard shortcuts at the native level too
    auto mod = event->modifiers();
    bool ctrlOrCmd = mod & (Qt::ControlModifier | Qt::MetaModifier);

    if (ctrlOrCmd && (event->key() == Qt::Key_Equal || event->key() == Qt::Key_Plus)) {
        setZoom(m_currentZoom + 0.1);
        return;
    }
    if (ctrlOrCmd && event->key() == Qt::Key_Minus) {
        setZoom(m_currentZoom - 0.1);
        return;
    }
    if (ctrlOrCmd && event->key() == Qt::Key_0) {
        setZoom(1.0);
        return;
    }
    if (event->key() == Qt::Key_F11) {
        toggleFullscreen();
        return;
    }

    QMainWindow::keyPressEvent(event);
}
