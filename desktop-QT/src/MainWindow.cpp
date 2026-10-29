#include "MainWindow.h"

#include "AppConfig.h"
#include "AppSettings.h"
#include "AutoStart.h"
#include "DeepLinkHandler.h"
#include "GlobalShortcuts.h"
#include "IdleMonitor.h"
#include "InjectedScripts.h"
#include "NotificationManager.h"
#include "PresenceDetector.h"
#include "RenderSafeMode.h"
#include "ScreenPicker.h"
#include "SerikaWebPage.h"
#include "SerikaWebView.h"
#include "TrayIcon.h"
#include "Updater.h"
#include "WebBridge.h"
#include "qwebchannel_js.h"

#include <QApplication>
#include <QClipboard>
#include <QCloseEvent>
#include <QDesktopServices>
#include <QDir>
#include <QElapsedTimer>
#include <QFileDialog>
#include <QFileInfo>
#include <QGuiApplication>
#include <QHBoxLayout>
#include <QJsonDocument>
#include <QKeyEvent>
#include <QLabel>
#include <QLibraryInfo>
#include <QLocale>
#include <QMessageBox>
#include <QPushButton>
#include <QScreen>
#include <QSettings>
#include <QStackedWidget>
#include <QStandardPaths>
#include <QTimer>
#include <QVBoxLayout>
#include <QWebChannel>
#include <QWebEngineDownloadRequest>
#include <QWebEngineFullScreenRequest>
#include <QWebEngineNotification>
#include <QWebEngineProfile>
#include <QWebEngineScript>
#include <QWebEngineScriptCollection>
#include <QWebEngineSettings>
#include <QWindow>

#include <memory>

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
#include <QWebEnginePermission>
#endif

namespace {
constexpr int UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000; // every 4 hours
// Matches the web splash / dark theme background (--app-bg), so there is no
// colour jump between the window, the page and the splash.
const QColor WINDOW_BG(0x05, 0x06, 0x0a);

QString platformName() {
#if defined(Q_OS_WIN)
    return QStringLiteral("windows");
#elif defined(Q_OS_MACOS)
    return QStringLiteral("macos");
#else
    return QStringLiteral("linux");
#endif
}

// Hunspell dictionaries (.bdic) Qt WebEngine can see; macOS uses the system
// spellchecker instead and accepts any language.
QStringList spellcheckLanguages() {
    QStringList wanted;
    for (QString lang : QLocale::system().uiLanguages()) {
        lang.replace('_', '-');
        if (!wanted.contains(lang)) wanted << lang;
    }
    if (!wanted.contains(QStringLiteral("en-US"))) wanted << QStringLiteral("en-US");
#if defined(Q_OS_MACOS)
    return wanted.mid(0, 3);
#else
    QStringList dirs;
    const QString env = qEnvironmentVariable("QTWEBENGINE_DICTIONARIES_PATH");
    if (!env.isEmpty()) dirs << env;
    dirs << QCoreApplication::applicationDirPath() + QStringLiteral("/qtwebengine_dictionaries");
    dirs << QLibraryInfo::path(QLibraryInfo::DataPath) + QStringLiteral("/qtwebengine_dictionaries");
    QStringList available;
    for (const QString &d : dirs) {
        for (const QFileInfo &fi : QDir(d).entryInfoList({QStringLiteral("*.bdic")}, QDir::Files)) {
            available << fi.completeBaseName();
        }
    }
    QStringList out;
    for (const QString &w : wanted) {
        for (const QString &a : available) {
            if (a.compare(w, Qt::CaseInsensitive) == 0 && !out.contains(a)) out << a;
        }
    }
    return out;
#endif
}

#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
QString permissionLabel(QWebEnginePermission::PermissionType type) {
    using T = QWebEnginePermission::PermissionType;
    switch (type) {
    case T::MediaAudioCapture: return QObject::tr("use your microphone");
    case T::MediaVideoCapture: return QObject::tr("use your camera");
    case T::MediaAudioVideoCapture: return QObject::tr("use your camera and microphone");
    case T::DesktopVideoCapture:
    case T::DesktopAudioVideoCapture: return QObject::tr("share your screen");
    case T::Notifications: return QObject::tr("show notifications");
    case T::Geolocation: return QObject::tr("know your location");
    case T::ClipboardReadWrite: return QObject::tr("read your clipboard");
    default: return {};
    }
}
#endif
} // namespace

MainWindow::MainWindow(AppSettings *settings, QWidget *parent)
    : QMainWindow(parent)
    , m_settings(settings)
    , m_view(new SerikaWebView(this))
    , m_channel(new QWebChannel(this))
    , m_shortcuts(new GlobalShortcuts(this))
    , m_idle(new IdleMonitor(this))
    , m_webBridge(new WebBridge(settings, m_idle, m_shortcuts, this))
    , m_presenceHeartbeat(new QTimer(this))
{
    setWindowTitle(QStringLiteral("SerikaCord"));
    setMinimumSize(940, 500);
    // Native window decorations: the OS provides the title bar, snapping and
    // correct high-DPI behaviour on X11, Wayland, Windows and macOS.
    QPalette pal = palette();
    pal.setColor(QPalette::Window, WINDOW_BG);
    setPalette(pal);
    setAutoFillBackground(true);

    setupProfile();

    m_page = new SerikaWebPage(m_profile, this);
    // Paint the app's dark background instead of a white flash while loading.
    m_page->setBackgroundColor(WINDOW_BG);
    m_view->setPage(m_page);
    setupRendererCrashRecovery();

    auto *s = m_page->settings();
    s->setAttribute(QWebEngineSettings::JavascriptEnabled, true);
    s->setAttribute(QWebEngineSettings::JavascriptCanOpenWindows, true); // caught by PopupCatcherPage
    s->setAttribute(QWebEngineSettings::JavascriptCanAccessClipboard, true);
    s->setAttribute(QWebEngineSettings::JavascriptCanPaste, true);
    s->setAttribute(QWebEngineSettings::LocalContentCanAccessRemoteUrls, true);
    s->setAttribute(QWebEngineSettings::ScrollAnimatorEnabled, true);
    s->setAttribute(QWebEngineSettings::AutoLoadImages, true);
    s->setAttribute(QWebEngineSettings::FullScreenSupportEnabled, true);
    s->setAttribute(QWebEngineSettings::ScreenCaptureEnabled, true);
    s->setAttribute(QWebEngineSettings::PlaybackRequiresUserGesture, false); // ringtones, call audio
    s->setAttribute(QWebEngineSettings::FocusOnNavigationEnabled, true);

    setupScripts();
    setupPermissions();

    m_view->setContentsMargins(0, 0, 0, 0);
    m_stack = new QStackedWidget(this);
    m_stack->addWidget(m_view);
    setCentralWidget(m_stack);
    m_view->setFocus();

    m_channel->registerObject(QStringLiteral("webBridge"), m_webBridge);
    m_page->setWebChannel(m_channel);

    m_currentZoom = m_settings->zoomFactor();
    m_view->setZoomFactor(m_currentZoom);

    connect(m_page, &QWebEnginePage::titleChanged, this, &MainWindow::onTitleChanged);
    connect(m_page, &SerikaWebPage::inAppLinkRequested, this, [this](const QUrl &url) {
        navigateInApp(url.path(QUrl::FullyEncoded) + (url.hasQuery() ? '?' + url.query(QUrl::FullyEncoded) : QString()));
    });
    connect(m_page, &QWebEnginePage::fullScreenRequested, this, [this](QWebEngineFullScreenRequest request) {
        request.accept();
        if (request.toggleOn()) showFullScreen();
        else showNormal();
    });
    // A new document (reload, full navigation) means a new bridge client:
    // forget its shortcuts until it registers them again. Not tied to
    // loadStarted, which also fires for the SPA's in-page navigations.
    connect(m_webBridge, &WebBridge::newDocument, this, [this]() {
        m_shortcuts->setShortcuts({});
    });
    connect(m_view, &SerikaWebView::spellcheckToggled, this, [this](bool on) {
        m_settings->set(QStringLiteral("spellcheck"), on);
    });

    // ── Bridge requests ─────────────────────────────────────────────────
    connect(m_webBridge, &WebBridge::zoomRequested, this, [this](double delta) {
        setZoom(delta == 0.0 ? 1.0 : m_currentZoom + delta);
    });
    connect(m_webBridge, &WebBridge::fullscreenRequested, this, &MainWindow::toggleFullscreen);
    connect(m_webBridge, &WebBridge::devToolsRequested, this, &MainWindow::toggleDevTools);
    connect(m_webBridge, &WebBridge::windowTitleChangeRequested, this, &MainWindow::onTitleChanged);
    connect(m_webBridge, &WebBridge::badgeCountRequested, this, &MainWindow::setBadgeCount);
    connect(m_webBridge, &WebBridge::focusRequested, this, &MainWindow::showAndFocus);
    connect(m_webBridge, &WebBridge::checkUpdatesRequested, this, [this]() { checkForUpdates(true); });
    connect(m_webBridge, &WebBridge::installUpdateRequested, this, &MainWindow::installUpdate);
    connect(m_settings, &AppSettings::changed, this, &MainWindow::applySetting);

    setupTray();

    m_notifications = new NotificationManager(m_trayIcon->systemTrayIcon(), this);
    connect(m_webBridge, &WebBridge::notificationRequested, m_notifications, &NotificationManager::show);
    connect(m_webBridge, &WebBridge::notificationCloseRequested, m_notifications, &NotificationManager::close);
    connect(m_notifications, &NotificationManager::activated, this, [this](const QString &id, const QString &url) {
        showAndFocus();
        emit m_webBridge->notificationClicked(id, url);
    });
    m_profile->setNotificationPresenter([this](std::unique_ptr<QWebEngineNotification> n) {
        if (!m_settings->nativeNotifications()) return;
        m_notifications->presentWebNotification(std::move(n));
    });

    // ── Global shortcuts, idle ──────────────────────────────────────────
    m_shortcuts->setEnabled(m_settings->globalShortcuts());
    connect(m_shortcuts, &GlobalShortcuts::triggered, m_webBridge, &WebBridge::globalShortcut);
    m_idle->setTimeoutMinutes(m_settings->idleTimeoutMinutes());
    connect(m_idle, &IdleMonitor::idleChanged, m_webBridge, &WebBridge::idleChanged);

    QVariantMap caps;
    caps.insert(QStringLiteral("globalShortcuts"), GlobalShortcuts::available());
    caps.insert(QStringLiteral("nativeNotifications"), NotificationManager::hasNativeBackend());
#ifdef SERIKA_HAS_DESKTOP_MEDIA_REQUEST
    caps.insert(QStringLiteral("screenPicker"), true);
#else
    caps.insert(QStringLiteral("screenPicker"), false);
#endif
    caps.insert(QStringLiteral("tray"), QSystemTrayIcon::isSystemTrayAvailable());
    m_webBridge->setPlatformCapabilities(caps);

    // ── Rich presence ───────────────────────────────────────────────────
    m_presenceDetector = new PresenceDetector(this);
    connect(m_presenceDetector, &PresenceDetector::activitiesDetected,
            this, [this](const QJsonArray &activities) { injectPresenceActivities(activities); });
    m_presenceDetector->start();
    m_presenceHeartbeat->setInterval(45000);
    connect(m_presenceHeartbeat, &QTimer::timeout, this, &MainWindow::onPresenceHeartbeat);
    m_presenceHeartbeat->start();

    // ── Window state + updates ──────────────────────────────────────────
    m_saveStateTimer.setSingleShot(true);
    m_saveStateTimer.setInterval(600);
    connect(&m_saveStateTimer, &QTimer::timeout, this, &MainWindow::saveWindowState);
    connect(qApp, &QCoreApplication::aboutToQuit, this, [this]() {
        m_quitting = true;
        saveWindowState();
    });

    m_updateTimer.setInterval(UPDATE_INTERVAL_MS);
    connect(&m_updateTimer, &QTimer::timeout, this, [this]() { checkForUpdates(false); });
    m_updateTimer.start();
}

MainWindow::~MainWindow() = default;

QString MainWindow::desktopMarkerScript() const {
    return QString::fromLatin1(DESKTOP_MARKER_JS)
        .arg(WebBridge::PROTOCOL_VERSION)
        .arg(QCoreApplication::applicationVersion().toHtmlEscaped(), platformName());
}

void MainWindow::setupProfile() {
    // QWebEngineProfile::defaultProfile() is off-the-record in Qt6 (cookies
    // wiped on exit); a *named* profile is stored on disk so logins persist.
    m_profile = new QWebEngineProfile(QStringLiteral("SerikaCord"), this);
    m_profile->setPersistentCookiesPolicy(QWebEngineProfile::ForcePersistentCookies);
    QString storagePath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation);
    if (storagePath.isEmpty()) storagePath = QDir::homePath() + QStringLiteral("/.local/share/SerikaCord");
    QDir().mkpath(storagePath);
    m_profile->setPersistentStoragePath(storagePath);
    m_profile->setCachePath(storagePath + QStringLiteral("/cache"));
    m_profile->setHttpCacheType(QWebEngineProfile::DiskHttpCache);
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    // Camera/mic/notification decisions are remembered per origin.
    m_profile->setPersistentPermissionsPolicy(QWebEngineProfile::PersistentPermissionsPolicy::StoreOnDisk);
#endif

    // Desktop UA so the web app serves the full desktop layout.
    QString ua = m_profile->httpUserAgent();
    if (!ua.contains(QLatin1String("Chrome/"))) ua += QStringLiteral(" Chrome/120.0.0.0");
    ua.remove(QStringLiteral("Mobile"));
    ua.remove(QStringLiteral("Android"));
    ua.remove(QStringLiteral("iPhone"));
    ua += QStringLiteral(" SerikaCordDesktop/%1").arg(QCoreApplication::applicationVersion());
    m_profile->setHttpUserAgent(ua);

    applySpellcheck(m_settings->spellcheck());

    connect(m_profile, &QWebEngineProfile::downloadRequested, this, &MainWindow::onDownloadRequested);
}

void MainWindow::applySpellcheck(bool enabled) {
    const QStringList langs = spellcheckLanguages();
    if (!langs.isEmpty()) m_profile->setSpellCheckLanguages(langs);
    m_profile->setSpellCheckEnabled(enabled && !langs.isEmpty());
}

void MainWindow::setupScripts() {
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
    auto *scripts = m_profile->scripts();
    scripts->insert(makeScript("serika_desktop_marker", desktopMarkerScript(), QWebEngineScript::DocumentCreation));
    scripts->insert(makeScript("qwebchannel_lib", QString::fromUtf8(QWEBCHANNEL_JS), QWebEngineScript::DocumentCreation));
    scripts->insert(makeScript("tauri_shim", QString::fromUtf8(TAURI_SHIM_JS), QWebEngineScript::DocumentCreation));
    scripts->insert(makeScript("presence_reporter", QString::fromUtf8(PRESENCE_REPORTER_JS), QWebEngineScript::DocumentCreation));
    scripts->insert(makeScript("channel_init", QString::fromUtf8(CHANNEL_INIT_JS), QWebEngineScript::DocumentCreation));
    scripts->insert(makeScript("viewport_polyfill", QString::fromUtf8(VIEWPORT_POLYFILL_JS), QWebEngineScript::DocumentReady));
    scripts->insert(makeScript("css_fixes", QString::fromUtf8(CSS_FIXES_JS), QWebEngineScript::DocumentReady));
    scripts->insert(makeScript("desktop_enhancements", QString::fromUtf8(DESKTOP_ENHANCEMENTS_JS), QWebEngineScript::DocumentReady));
}

void MainWindow::setupPermissions() {
#if QT_VERSION >= QT_VERSION_CHECK(6, 8, 0)
    connect(m_page, &QWebEnginePage::permissionRequested, this, [this](QWebEnginePermission permission) {
        using T = QWebEnginePermission::PermissionType;
        const T type = permission.permissionType();
        const QUrl origin = permission.origin();
        // The app itself gets what a native client would have: mic, camera,
        // screen capture, notifications, clipboard. Granted once, stored on disk.
        if (SerikaConfig::isAppUrl(origin)) {
            switch (type) {
            case T::MediaAudioCapture:
            case T::MediaVideoCapture:
            case T::MediaAudioVideoCapture:
            case T::DesktopVideoCapture:
            case T::DesktopAudioVideoCapture:
            case T::Notifications:
            case T::ClipboardReadWrite:
                permission.grant();
                return;
            default:
                break;
            }
        }
        const QString what = permissionLabel(type);
        if (what.isEmpty()) {
            permission.deny();
            return;
        }
        // Third-party frames (embeds) ask once; the answer is remembered.
        auto *box = new QMessageBox(QMessageBox::Question, QStringLiteral("SerikaCord"),
            tr("%1 wants to %2.").arg(origin.host(), what), QMessageBox::NoButton, this);
        QPushButton *allow = box->addButton(tr("Allow"), QMessageBox::AcceptRole);
        box->addButton(tr("Block"), QMessageBox::RejectRole);
        box->setAttribute(Qt::WA_DeleteOnClose);
        connect(box, &QMessageBox::finished, this, [box, allow, permission]() mutable {
            if (box->clickedButton() == allow) permission.grant();
            else permission.deny();
        });
        box->open();
    });
#else
    connect(m_page, &QWebEnginePage::featurePermissionRequested, this,
            [this](const QUrl &origin, QWebEnginePage::Feature feature) {
        const bool app = SerikaConfig::isAppUrl(origin);
        const bool mediaLike = feature == QWebEnginePage::MediaAudioCapture
            || feature == QWebEnginePage::MediaVideoCapture
            || feature == QWebEnginePage::MediaAudioVideoCapture
            || feature == QWebEnginePage::DesktopVideoCapture
            || feature == QWebEnginePage::DesktopAudioVideoCapture
            || feature == QWebEnginePage::Notifications;
        if (app && mediaLike) {
            m_page->setFeaturePermission(origin, feature, QWebEnginePage::PermissionGrantedByUser);
            return;
        }
        // Remember third-party answers ourselves on older Qt.
        QSettings store;
        const QString key = QStringLiteral("permissions/%1/%2").arg(origin.host()).arg(int(feature));
        if (store.contains(key)) {
            m_page->setFeaturePermission(origin, feature, store.value(key).toBool()
                ? QWebEnginePage::PermissionGrantedByUser : QWebEnginePage::PermissionDeniedByUser);
            return;
        }
        const auto answer = QMessageBox::question(this, QStringLiteral("SerikaCord"),
            tr("%1 is asking for permission to use a device or feature. Allow?").arg(origin.host()));
        const bool granted = answer == QMessageBox::Yes;
        store.setValue(key, granted);
        m_page->setFeaturePermission(origin, feature, granted
            ? QWebEnginePage::PermissionGrantedByUser : QWebEnginePage::PermissionDeniedByUser);
    });
#endif

#ifdef SERIKA_HAS_DESKTOP_MEDIA_REQUEST
    // getDisplayMedia(): show our own Screens / Applications picker.
    connect(m_page, &QWebEnginePage::desktopMediaRequested, this, [this](const QWebEngineDesktopMediaRequest &request) {
        showAndFocus();
        auto *picker = new ScreenPicker(request, this);
        picker->setAttribute(Qt::WA_DeleteOnClose);
        picker->open();
    });
#endif
}

void MainWindow::setupTray() {
    m_trayIcon = new TrayIcon(this);
    if (QSystemTrayIcon::isSystemTrayAvailable()) m_trayIcon->show();
    connect(m_trayIcon, &TrayIcon::openRequested, this, &MainWindow::showAndFocus);
    connect(m_trayIcon, &TrayIcon::toggleRequested, this, &MainWindow::toggleVisibility);
    connect(m_trayIcon, &TrayIcon::quitRequested, this, &MainWindow::quitApp);
    connect(m_trayIcon, &TrayIcon::checkUpdatesRequested, this, [this]() { checkForUpdates(true); });
    connect(m_trayIcon, &TrayIcon::installUpdateRequested, this, &MainWindow::installUpdate);
    connect(m_trayIcon, &TrayIcon::muteToggleRequested, this, [this]() {
        emit m_webBridge->trayAction(QStringLiteral("toggle-mute"), QString());
    });
    connect(m_trayIcon, &TrayIcon::deafenToggleRequested, this, [this]() {
        emit m_webBridge->trayAction(QStringLiteral("toggle-deafen"), QString());
    });
    connect(m_trayIcon, &TrayIcon::statusRequested, this, [this](const QString &status) {
        emit m_webBridge->trayAction(QStringLiteral("set-status"), status);
    });
    connect(m_webBridge, &WebBridge::voiceStateReported, m_trayIcon, &TrayIcon::setVoiceState);
    connect(m_webBridge, &WebBridge::userStatusReported, m_trayIcon, &TrayIcon::setStatus);
}

void MainWindow::applySetting(const QString &key, const QVariant &value) {
    if (key == QLatin1String("startOnLogin")) {
        AutoStart::setEnabled(value.toBool());
    } else if (key == QLatin1String("spellcheck")) {
        applySpellcheck(value.toBool());
    } else if (key == QLatin1String("globalShortcuts")) {
        m_shortcuts->setEnabled(value.toBool());
    } else if (key == QLatin1String("idleTimeoutMinutes")) {
        m_idle->setTimeoutMinutes(value.toInt());
    }
}

void MainWindow::loadUrl(const QString &url) {
    m_view->setUrl(QUrl(url));
}

void MainWindow::restoreWindowState() {
    const QByteArray geometry = m_settings->windowGeometry();
    if (!geometry.isEmpty() && restoreGeometry(geometry)) {
        // Off-screen (monitor unplugged)? Fall back to the default placement.
        bool visible = false;
        for (QScreen *s : QGuiApplication::screens()) {
            if (s->availableGeometry().intersects(frameGeometry())) visible = true;
        }
        if (visible) {
            if (m_settings->windowMaximized()) setWindowState(windowState() | Qt::WindowMaximized);
            return;
        }
    }
    // Default: 80% of the screen, capped at 1600x1000, centred.
    if (QScreen *screen = QGuiApplication::primaryScreen()) {
        const QRect g = screen->availableGeometry();
        const int w = qMin(static_cast<int>(g.width() * 0.8), 1600);
        const int h = qMin(static_cast<int>(g.height() * 0.85), 1000);
        resize(w, h);
        move(g.x() + (g.width() - w) / 2, g.y() + (g.height() - h) / 2);
    } else {
        resize(1280, 800);
    }
}

void MainWindow::saveWindowState() {
    if (isFullScreen()) return;
    m_settings->saveWindowState(saveGeometry(), isMaximized());
}

void MainWindow::moveEvent(QMoveEvent *event) {
    QMainWindow::moveEvent(event);
    if (isVisible()) m_saveStateTimer.start();
}

void MainWindow::resizeEvent(QResizeEvent *event) {
    QMainWindow::resizeEvent(event);
    if (isVisible()) m_saveStateTimer.start();
}

void MainWindow::showAndFocus() {
    if (isMinimized()) showNormal();
    show();
    raise();
    activateWindow();
    setWindowState((windowState() & ~Qt::WindowMinimized) | Qt::WindowActive);
    if (QWindow *w = windowHandle()) w->requestActivate();
}

// A page renderer that dies leaves a blank window (CORD-69: the bundled
// QtWebEngine's seccomp filter kills it with SIGSYS on new distros). Early in
// a session RenderSafeMode moves to the next safer render mode and the app
// restarts in it; a crash after the app had been working reloads the page.
// When nothing helps, a native message replaces the blank page.
void MainWindow::setupRendererCrashRecovery() {
    struct LoadState {
        bool everLoaded = false;
        QElapsedTimer sinceFirstLoad;
    };
    auto state = std::make_shared<LoadState>();
    if (RenderSafeMode::diagnostics()) {
        connect(m_page, &QWebEnginePage::loadStarted, this, [this]() {
            RenderSafeMode::debug(QStringLiteral("load started: %1").arg(m_page->requestedUrl().toString()));
        });
    }
    connect(m_page, &QWebEnginePage::loadFinished, this, [this, state](bool ok) {
        RenderSafeMode::debug(QStringLiteral("load finished (%1): %2")
                                  .arg(ok ? QStringLiteral("ok") : QStringLiteral("failed"), m_page->url().toString()));
        if (ok && !state->everLoaded) {
            state->everLoaded = true;
            state->sinceFirstLoad.start();
        }
    });
    connect(m_page, &QWebEnginePage::renderProcessTerminated, this,
            [this, state](QWebEnginePage::RenderProcessTerminationStatus status, int exitCode) {
        if (m_renderFailure && m_stack->currentWidget() == m_renderFailure) return; // already gave up
        // A renderer killed right after the first load (e.g. when the app's
        // scripts start their workers) counts as never having worked.
        const bool early = !state->everLoaded || state->sinceFirstLoad.elapsed() < 20000;
        switch (RenderSafeMode::onRendererTerminated(int(status), exitCode, early)) {
        case RenderSafeMode::Action::Ignore:
            return;
        case RenderSafeMode::Action::Relaunch:
            if (RenderSafeMode::relaunch(false)) {
                quitApp();
                return;
            }
            showRenderFailure();
            return;
        case RenderSafeMode::Action::GiveUp:
            showRenderFailure();
            return;
        case RenderSafeMode::Action::Reload:
            QTimer::singleShot(1500, m_view, [this]() { m_view->reload(); });
            return;
        }
    });
}

void MainWindow::showRenderFailure() {
    if (!m_renderFailure) {
        auto *panel = new QWidget(m_stack);
        panel->setAutoFillBackground(true);
        QPalette pal = panel->palette();
        pal.setColor(QPalette::Window, WINDOW_BG);
        pal.setColor(QPalette::WindowText, QColor(0xe6, 0xe8, 0xee));
        panel->setPalette(pal);

        auto *title = new QLabel(tr("SerikaCord can't display the app on this system"), panel);
        QFont titleFont = title->font();
        titleFont.setPointSizeF(titleFont.pointSizeF() * 1.4);
        titleFont.setBold(true);
        title->setFont(titleFont);
        title->setAlignment(Qt::AlignCenter);
        title->setWordWrap(true);

        auto *body = new QLabel(tr("The built-in browser engine keeps stopping before the app can load, even in "
                                   "the safest mode. You can keep using SerikaCord in your web browser.\n\n"
                                   "To help us fix it, start SerikaCord from a terminal with --diagnostics and "
                                   "attach the output to your bug report, or use \"Copy details\"."),
                                panel);
        body->setAlignment(Qt::AlignCenter);
        body->setWordWrap(true);
        body->setMaximumWidth(560);
        body->setTextInteractionFlags(Qt::TextSelectableByMouse);

        auto *detail = new QLabel(panel);
        detail->setObjectName(QStringLiteral("renderFailureDetail"));
        detail->setAlignment(Qt::AlignCenter);
        detail->setWordWrap(true);
        detail->setMaximumWidth(560);
        detail->setTextInteractionFlags(Qt::TextSelectableByMouse);
        QPalette detailPal = detail->palette();
        detailPal.setColor(QPalette::WindowText, QColor(0x9a, 0xa0, 0xad));
        detail->setPalette(detailPal);

        auto *openBrowser = new QPushButton(tr("Open in browser"), panel);
        openBrowser->setDefault(true);
        auto *retry = new QPushButton(tr("Try again"), panel);
        auto *copy = new QPushButton(tr("Copy details"), panel);
        auto *quit = new QPushButton(tr("Quit"), panel);
        connect(openBrowser, &QPushButton::clicked, this, []() {
            QDesktopServices::openUrl(QUrl(SerikaConfig::appUrl() + QString::fromLatin1(SerikaConfig::START_PATH)));
        });
        connect(retry, &QPushButton::clicked, this, [this]() {
            // From the full sandbox again: the next crash walks down the modes.
            if (RenderSafeMode::relaunch(true)) quitApp();
        });
        connect(copy, &QPushButton::clicked, this, []() {
            QGuiApplication::clipboard()->setText(RenderSafeMode::report());
        });
        connect(quit, &QPushButton::clicked, this, &MainWindow::quitApp);

        auto *buttons = new QHBoxLayout;
        buttons->addStretch();
        buttons->addWidget(openBrowser);
        buttons->addWidget(retry);
        buttons->addWidget(copy);
        buttons->addWidget(quit);
        buttons->addStretch();

        auto *layout = new QVBoxLayout(panel);
        layout->setContentsMargins(32, 32, 32, 32);
        layout->setSpacing(16);
        layout->addStretch();
        layout->addWidget(title, 0, Qt::AlignHCenter);
        layout->addWidget(body, 0, Qt::AlignHCenter);
        layout->addWidget(detail, 0, Qt::AlignHCenter);
        layout->addLayout(buttons);
        layout->addStretch();

        m_stack->addWidget(panel);
        m_renderFailure = panel;
    }
    if (auto *detail = m_renderFailure->findChild<QLabel *>(QStringLiteral("renderFailureDetail"))) {
        detail->setText(tr("Last error: %1 (render mode %2: %3)")
                            .arg(RenderSafeMode::lastFailure())
                            .arg(RenderSafeMode::level())
                            .arg(RenderSafeMode::levelName(RenderSafeMode::level())));
    }
    RenderSafeMode::log(QStringLiteral("giving up on the page renderer; showing the fallback message"));
    m_page->triggerAction(QWebEnginePage::Stop);
    m_stack->setCurrentWidget(m_renderFailure);
    showAndFocus();
}

void MainWindow::returnToAppIfAway() {
    // Relaunching the app while the window sits on an outside page (an
    // abandoned OAuth login) brings back the app instead of that page.
    const QUrl current = m_view->url();
    if ((current.scheme() == QLatin1String("http") || current.scheme() == QLatin1String("https"))
        && !SerikaConfig::isInAppNavigation(current)) {
        loadUrl(SerikaConfig::appUrl() + QString::fromLatin1(SerikaConfig::START_PATH));
    }
}

void MainWindow::toggleVisibility() {
    if (isVisible() && !isMinimized() && isActiveWindow()) hide();
    else showAndFocus();
}

void MainWindow::setZoom(double factor) {
    m_currentZoom = qBound(0.5, factor, 2.0);
    m_view->setZoomFactor(m_currentZoom);
    m_settings->setZoomFactor(m_currentZoom);
}

void MainWindow::toggleFullscreen() {
    if (isFullScreen()) showNormal();
    else showFullScreen();
}

void MainWindow::toggleDevTools() {
    if (m_devTools) {
        if (m_devTools->isVisible()) m_devTools->close();
        else { m_devTools->show(); m_devTools->raise(); }
        return;
    }
    auto *win = new QMainWindow();
    win->setAttribute(Qt::WA_DeleteOnClose);
    win->setWindowTitle(tr("Developer Tools — SerikaCord"));
    auto *view = new QWebEngineView(win);
    auto *devPage = new QWebEnginePage(m_profile, view);
    view->setPage(devPage);
    m_page->setDevToolsPage(devPage);
    win->setCentralWidget(view);
    win->resize(1000, 700);
    connect(win, &QObject::destroyed, this, [this]() {
        if (m_page) m_page->setDevToolsPage(nullptr);
    });
    m_devTools = win;
    win->show();
}

void MainWindow::setBadgeCount(int count) {
    count = qMax(0, count);
    if (m_trayIcon) m_trayIcon->setUnread(count);
#if QT_VERSION >= QT_VERSION_CHECK(6, 5, 0)
    // Dock badge on macOS, taskbar overlay on Windows, launcher count on Linux
    // (Unity LauncherEntry: KDE, Dash to Dock, Plank...).
    if (auto *app = qobject_cast<QGuiApplication *>(QCoreApplication::instance())) app->setBadgeNumber(count);
#endif
    // The window icon carries the dot too (taskbars that ignore badges).
    setWindowIcon(TrayIcon::iconWithDot(QApplication::windowIcon(), count > 0));
}

void MainWindow::navigateInApp(const QString &pathAndQuery) {
    if (pathAndQuery.isEmpty() || !pathAndQuery.startsWith('/')) return;
    if (m_webBridge->isWebReady()) emit m_webBridge->navigateRequested(pathAndQuery);
    else loadUrl(SerikaConfig::appUrl() + pathAndQuery);
}

void MainWindow::navigateToDeepLink(const QString &path) {
    navigateInApp(path);
    showAndFocus();
}

void MainWindow::injectPresenceActivities(const QJsonArray &activities) {
    const QString jsonStr = QString::fromUtf8(QJsonDocument(activities).toJson(QJsonDocument::Compact));
    m_lastPresenceJson = jsonStr;
    m_page->runJavaScript(QStringLiteral("window.__serikaSetActivities && window.__serikaSetActivities(%1);").arg(jsonStr));
}

void MainWindow::onPresenceHeartbeat() {
    if (!m_lastPresenceJson.isEmpty() && m_lastPresenceJson != QLatin1String("[]")) {
        m_page->runJavaScript(QStringLiteral("window.__serikaSetActivities && window.__serikaSetActivities(%1);")
                                  .arg(m_lastPresenceJson));
    }
}

void MainWindow::onTitleChanged(const QString &title) {
    setWindowTitle(title.isEmpty() ? QStringLiteral("SerikaCord") : title);
}

// ── Downloads ────────────────────────────────────────────────────────────────

void MainWindow::onDownloadRequested(QWebEngineDownloadRequest *download) {
    if (!download || download->state() != QWebEngineDownloadRequest::DownloadRequested) return;
    QString dir = QStandardPaths::writableLocation(QStandardPaths::DownloadLocation);
    if (dir.isEmpty()) dir = QDir::homePath();
    const QString suggested = QDir(dir).filePath(download->downloadFileName());
    const QString target = QFileDialog::getSaveFileName(this, tr("Save File"), suggested);
    if (target.isEmpty()) {
        download->cancel();
        return;
    }
    const QFileInfo fi(target);
    download->setDownloadDirectory(fi.absolutePath());
    download->setDownloadFileName(fi.fileName());
    connect(download, &QWebEngineDownloadRequest::isFinishedChanged, this, [this, download]() {
        if (!download->isFinished()) return;
        QSystemTrayIcon *tray = m_trayIcon ? m_trayIcon->systemTrayIcon() : nullptr;
        if (!tray || !QSystemTrayIcon::supportsMessages()) return;
        if (download->state() == QWebEngineDownloadRequest::DownloadCompleted) {
            tray->showMessage(tr("Download complete"), download->downloadFileName(),
                              QSystemTrayIcon::Information, 4000);
        } else if (download->state() == QWebEngineDownloadRequest::DownloadInterrupted) {
            tray->showMessage(tr("Download failed"), download->interruptReasonString(),
                              QSystemTrayIcon::Warning, 4000);
        }
    });
    download->accept();
}

// ── Updates ──────────────────────────────────────────────────────────────────

void MainWindow::setUpdateState(const QString &state, const QString &version, int percent) {
    QVariantMap m;
    m.insert(QStringLiteral("state"), state);
    if (!version.isEmpty()) m.insert(QStringLiteral("version"), version);
    if (percent >= 0) m.insert(QStringLiteral("percent"), percent);
    m_webBridge->setUpdateState(m);
}

void MainWindow::checkForUpdates(bool manual) {
    if (!m_pendingInstaller.isEmpty()) {
        setUpdateState(QStringLiteral("ready"), m_pendingVersion);
        return;
    }
    m_manualUpdateCheck = m_manualUpdateCheck || manual;
    if (m_updater) return; // already running
    auto *updater = new Updater(QCoreApplication::applicationVersion(), this);
    m_updater = updater;
    setUpdateState(QStringLiteral("checking"));
    connect(updater, &Updater::progressChanged, this, [this](const QString &, int percent) {
        setUpdateState(QStringLiteral("downloading"), QString(), percent);
    });
    auto failed = std::make_shared<bool>(false);
    connect(updater, &Updater::checkFailed, this, [failed]() { *failed = true; });
    connect(updater, &Updater::noUpdate, this, [this, updater, failed]() {
        const bool manual = m_manualUpdateCheck;
        m_manualUpdateCheck = false;
        setUpdateState(*failed ? QStringLiteral("error") : QStringLiteral("uptodate"));
        if (manual && m_trayIcon && QSystemTrayIcon::supportsMessages() && !isActiveWindow()) {
            m_trayIcon->systemTrayIcon()->showMessage(QStringLiteral("SerikaCord"),
                *failed ? tr("Couldn't check for updates. Try again later.")
                        : tr("You're on the latest version (%1).").arg(QCoreApplication::applicationVersion()),
                QSystemTrayIcon::Information, 4000);
        }
        updater->deleteLater();
    });
    connect(updater, &Updater::readyToInstall, this, [this, updater](const QString &path, const QString &version) {
        m_manualUpdateCheck = false;
        m_pendingInstaller = path;
        m_pendingVersion = version;
        setUpdateState(QStringLiteral("ready"), version);
        if (m_trayIcon) m_trayIcon->setUpdateReady(version);
        updater->deleteLater();
    });
    updater->checkForUpdates();
}

void MainWindow::installUpdate() {
    if (m_pendingInstaller.isEmpty()) {
        checkForUpdates(true);
        return;
    }
    saveWindowState();
    Updater::launchInstaller(m_pendingInstaller);
    quitApp();
}

void MainWindow::quitApp() {
    m_quitting = true;
    saveWindowState();
    QApplication::quit();
}

// ── Window behaviour ─────────────────────────────────────────────────────────

void MainWindow::closeEvent(QCloseEvent *event) {
    saveWindowState();
    if (m_quitting) {
        event->accept();
        return;
    }
    if (m_settings->closeToTray() && QSystemTrayIcon::isSystemTrayAvailable()) {
        // Close to tray, like Discord: the app keeps running for notifications.
        event->ignore();
        hide();
        return;
    }
    event->accept();
    quitApp();
}

void MainWindow::changeEvent(QEvent *event) {
    QMainWindow::changeEvent(event);
    if (event->type() == QEvent::WindowStateChange && isMinimized() && m_settings->minimizeToTray()
        && QSystemTrayIcon::isSystemTrayAvailable()) {
        QTimer::singleShot(0, this, [this]() {
            hide();
            setWindowState(windowState() & ~Qt::WindowMinimized);
        });
    }
}

void MainWindow::keyPressEvent(QKeyEvent *event) {
    // Native fallback for zoom/fullscreen when the page isn't focused.
    const bool ctrlOrCmd = event->modifiers() & (Qt::ControlModifier | Qt::MetaModifier);
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
