// SerikaCord native desktop shell (Qt6).
//
// Loads the hosted web app and adds what a native client needs: native
// notifications, tray + unread badge, global push-to-talk / mute / deafen,
// a screen-share picker, permissions, single instance, serika:// deep links,
// window state, spellcheck, downloads, auto-idle and auto-update.

#include <QApplication>
#include <QCommandLineParser>
#include <QFileOpenEvent>
#include <QIcon>
#include <QLocalSocket>
#include <QThread>
#include <QTimer>
#include <QUrl>

#include "AppConfig.h"
#include "AppSettings.h"
#include "AutoStart.h"
#include "DeepLinkHandler.h"
#include "KeyState.h"
#include "MainWindow.h"
#include "RenderSafeMode.h"
#include "SingleInstance.h"
#include "Updater.h"
#include "UpdaterWindow.h"

#ifndef SERIKA_APP_VERSION
#define SERIKA_APP_VERSION "0.0.0"
#endif

namespace {
const char *INSTANCE_KEY = "serikacord-desktop-qt-single-instance";
const char *SHOW_MESSAGE = "serika:show";
// Sent by a launch with different overrides (flags, env): exit so it can start.
const char *QUIT_MESSAGE = "serika:quit";

// macOS delivers serika:// links (and dock re-opens) as application events.
class AppEventFilter : public QObject {
public:
    AppEventFilter(DeepLinkHandler *links, MainWindow *window)
        : m_links(links), m_window(window) {}

protected:
    bool eventFilter(QObject *obj, QEvent *event) override {
        if (event->type() == QEvent::FileOpen) {
            auto *open = static_cast<QFileOpenEvent *>(event);
            const QString link = open->url().isValid() ? open->url().toString() : open->file();
            if (m_links->handleLink(link)) return true;
        } else if (event->type() == QEvent::ApplicationActivate && m_window && !m_window->isVisible()) {
#if defined(Q_OS_MACOS)
            // Clicking the dock icon brings back a window closed to the tray.
            m_window->showAndFocus();
#endif
        }
        return QObject::eventFilter(obj, event);
    }

private:
    DeepLinkHandler *m_links;
    MainWindow *m_window;
};
} // namespace

int main(int argc, char *argv[]) {
    // Chromium flags and the render safe mode must be set before QApplication.
    RenderSafeMode::configure(argc, argv);
    QGuiApplication::setHighDpiScaleFactorRoundingPolicy(Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);

    QApplication app(argc, argv);
    app.setApplicationName(QStringLiteral("SerikaCord"));
    app.setApplicationVersion(QStringLiteral(SERIKA_APP_VERSION));
    app.setOrganizationName(QStringLiteral("SerikaCord"));
    app.setOrganizationDomain(QStringLiteral("serika.chat"));
    app.setQuitOnLastWindowClosed(false); // keep running in the tray
    QGuiApplication::setDesktopFileName(QStringLiteral("serikacord")); // badges, Wayland app id
    app.setWindowIcon(QIcon(QStringLiteral(":/icons/app-icon.png")));

    QCommandLineParser parser;
    parser.setApplicationDescription(QStringLiteral("SerikaCord — native desktop client"));
    const QCommandLineOption helpOpt = parser.addHelpOption();
    const QCommandLineOption versionOpt = parser.addVersionOption();
    QCommandLineOption autostartOpt(QStringLiteral("autostart"), QStringLiteral("Launched at login."));
    QCommandLineOption minimizedOpt(QStringLiteral("start-minimized"), QStringLiteral("Start in the tray."));
    QCommandLineOption appUrlOpt(QStringLiteral("app-url"),
                                 QStringLiteral("Load the app from this URL (development)."), QStringLiteral("url"));
    parser.addOption(autostartOpt);
    parser.addOption(minimizedOpt);
    QCommandLineOption diagnosticsOpt(QStringLiteral("diagnostics"),
        QStringLiteral("Print Qt WebEngine paths, environment, Chromium flags and page renderer exits to stderr "
                       "(same as SERIKACORD_DEBUG=1)."));
    parser.addOption(appUrlOpt);
    parser.addOption(diagnosticsOpt);
    parser.addPositionalArgument(QStringLiteral("link"), QStringLiteral("Optional serika:// link to open"));
    // parse(), not process(): process() exits on unknown options, which
    // swallowed Chromium switches like --no-sandbox (QtWebEngine reads those
    // from the application arguments itself).
    parser.parse(QCoreApplication::arguments());
    if (parser.isSet(helpOpt)) parser.showHelp();
    if (parser.isSet(versionOpt)) parser.showVersion();

    if (parser.isSet(appUrlOpt)) SerikaConfig::setAppUrl(parser.value(appUrlOpt));

    QString launchLink;
    for (const QString &arg : parser.positionalArguments()) {
        if (DeepLinkHandler::isDeepLink(arg)) { launchLink = arg; break; }
    }

    if (RenderSafeMode::diagnostics()) RenderSafeMode::printReport();

    // ── Single instance: hand the link to the running app and exit ───────
    // A process relaunched in a safer render mode waits for its predecessor.
    RenderSafeMode::waitForPreviousInstance();
    const QString overrides = RenderSafeMode::overridesFingerprint(parser.unknownOptionNames());
    SingleInstance single(QString::fromLatin1(INSTANCE_KEY));
    if (!single.tryLock()) {
        // Flags and environment variables only reach Chromium when it starts,
        // so a launch that sets different ones replaces the running instance
        // instead of just showing it (CORD-69: a blank instance kept in the
        // tray swallowed every retry with QTWEBENGINE_DISABLE_SANDBOX=1).
        const bool replace = !overrides.isEmpty() && overrides != RenderSafeMode::runningFingerprint();
        QLocalSocket socket;
        socket.connectToServer(QString::fromLatin1(INSTANCE_KEY));
        if (socket.waitForConnected(1000)) {
            // A second login-time launch shouldn't pop the window up.
            const QString msg = replace ? QString::fromLatin1(QUIT_MESSAGE)
                : !launchLink.isEmpty() ? launchLink
                : parser.isSet(autostartOpt) ? QString() : QString::fromLatin1(SHOW_MESSAGE);
            socket.write(msg.toUtf8());
            socket.flush();
            socket.waitForBytesWritten(1000);
            socket.disconnectFromServer();
        }
        bool locked = false;
        if (replace) {
            RenderSafeMode::log(QStringLiteral("restarting the running instance so the new flags/environment apply"));
            for (int i = 0; i < 60 && !locked; ++i) {
                QThread::msleep(250);
                locked = single.tryLock();
            }
            if (!locked) {
                RenderSafeMode::log(QStringLiteral("SerikaCord is still running (an older version ignores the restart "
                                                   "request). Quit it from its tray icon, or run `pkill -x SerikaCord`, "
                                                   "then start it again."));
            }
        } else {
            RenderSafeMode::log(QStringLiteral("already running: showing that window. Flags and "
                                               "environment variables only apply when it starts; quit it from the "
                                               "tray icon first to use them."));
        }
        if (!locked) return 0;
    }
    RenderSafeMode::rememberRunningFingerprint(overrides);

    AppSettings settings;
    // Keep the OS login entry in sync with the preference (the binary may
    // have moved since it was written, e.g. a new AppImage).
    if (settings.startOnLogin()) AutoStart::setEnabled(true);

    MainWindow mainWindow(&settings);
    mainWindow.restoreWindowState();

    DeepLinkHandler deepLinks;
    deepLinks.registerScheme();
    QObject::connect(&deepLinks, &DeepLinkHandler::deepLinkReceived, &mainWindow, &MainWindow::navigateToDeepLink);

    AppEventFilter filter(&deepLinks, &mainWindow);
    app.installEventFilter(&filter);

    QObject::connect(&single, &SingleInstance::anotherInstanceStarted, &mainWindow,
                     [&mainWindow, &deepLinks](const QString &msg) {
        if (msg.isEmpty()) return;
        if (msg == QLatin1String(QUIT_MESSAGE)) {
            mainWindow.quitApp();
        } else if (msg == QLatin1String(SHOW_MESSAGE)) {
            mainWindow.returnToAppIfAway();
            mainWindow.showAndFocus();
        } else if (!deepLinks.handleLink(msg)) {
            mainWindow.showAndFocus();
        }
    });

    const QString startPath = launchLink.isEmpty()
        ? QString::fromLatin1(SerikaConfig::START_PATH)
        : DeepLinkHandler::normalizeLink(launchLink);
    const QString startUrl = SerikaConfig::appUrl()
        + (startPath.isEmpty() ? QString::fromLatin1(SerikaConfig::START_PATH) : startPath);

    const bool startHidden = parser.isSet(minimizedOpt)
        || (parser.isSet(autostartOpt) && settings.startMinimized() && launchLink.isEmpty());

    if (startHidden) {
        // Straight to the tray: no splash, update check in the background.
        mainWindow.loadUrl(startUrl);
        QTimer::singleShot(60 * 1000, &mainWindow, [&mainWindow]() { mainWindow.checkForUpdates(false); });
        const int rc = app.exec();
        KeyState::shutdown();
        return rc;
    }

    // ── Splash + update check, then the app ─────────────────────────────
    UpdaterWindow splash;
    splash.setVersionText(QStringLiteral("v%1").arg(app.applicationVersion()));
    splash.showSplash();

    bool launched = false;
    auto launchApp = [&]() {
        if (launched) return;
        launched = true;
        splash.closeSplash();
        mainWindow.loadUrl(startUrl);
        mainWindow.showAndFocus();
    };

    Updater updateChecker(app.applicationVersion());
    QObject::connect(&updateChecker, &Updater::indeterminate, &splash, &UpdaterWindow::setIndeterminate);
    QObject::connect(&updateChecker, &Updater::progressChanged, &splash, &UpdaterWindow::setProgress);
    QObject::connect(&updateChecker, &Updater::statusChanged, &splash, &UpdaterWindow::setIndeterminate);
    QObject::connect(&updateChecker, &Updater::noUpdate, &mainWindow, launchApp);
    QObject::connect(&updateChecker, &Updater::readyToInstall, &mainWindow,
                     [&](const QString &installerPath, const QString &newVersion) {
        if (launched) return; // took too long; the in-app banner picks it up later
        splash.setDone(QStringLiteral("Installing %1…").arg(newVersion));
        Updater::launchInstaller(installerPath);
        QApplication::quit();
    });

    QTimer::singleShot(400, &updateChecker, [&updateChecker]() { updateChecker.checkForUpdates(); });
    // Never let a slow network keep the splash up.
    QTimer::singleShot(12000, &mainWindow, launchApp);

    const int rc = app.exec();
    KeyState::shutdown();
    return rc;
}
