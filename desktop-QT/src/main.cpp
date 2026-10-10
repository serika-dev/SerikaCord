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
#include <QSettings>
#include <QTimer>
#include <QUrl>

#include "AppConfig.h"
#include "AppSettings.h"
#include "AutoStart.h"
#include "DeepLinkHandler.h"
#include "KeyState.h"
#include "MainWindow.h"
#include "SingleInstance.h"
#include "Updater.h"
#include "UpdaterWindow.h"

#ifndef SERIKA_APP_VERSION
#define SERIKA_APP_VERSION "0.0.0"
#endif

namespace {
const char *INSTANCE_KEY = "serikacord-desktop-qt-single-instance";
const char *SHOW_MESSAGE = "serika:show";

// Chromium flags must be set before QApplication exists, so the hardware
// acceleration preference is read straight from QSettings here.
void setupChromiumFlags() {
    QSettings prefs(QSettings::NativeFormat, QSettings::UserScope,
                    QStringLiteral("SerikaCord"), QStringLiteral("SerikaCord"));
    const bool gpu = prefs.value(QStringLiteral("prefs/hardwareAcceleration"), true).toBool();
    QByteArray flags =
        "--enable-smooth-scrolling "
        "--enable-features=OverlayScrollbar "
        // Keep timers/rendering alive while hidden in the tray, so calls,
        // notifications and presence keep working like Discord's client.
        "--disable-background-timer-throttling "
        "--disable-renderer-backgrounding "
        "--disable-backgrounding-occluded-windows "
        "--disable-features=BackForwardCache ";
    flags += gpu ? "--enable-gpu-rasterization" : "--disable-gpu --disable-gpu-compositing";
    const QByteArray existing = qgetenv("QTWEBENGINE_CHROMIUM_FLAGS");
    if (!existing.isEmpty()) flags = existing + ' ' + flags;
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", flags);
}

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
    setupChromiumFlags();
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
    parser.addHelpOption();
    parser.addVersionOption();
    QCommandLineOption autostartOpt(QStringLiteral("autostart"), QStringLiteral("Launched at login."));
    QCommandLineOption minimizedOpt(QStringLiteral("start-minimized"), QStringLiteral("Start in the tray."));
    QCommandLineOption appUrlOpt(QStringLiteral("app-url"),
                                 QStringLiteral("Load the app from this URL (development)."), QStringLiteral("url"));
    parser.addOption(autostartOpt);
    parser.addOption(minimizedOpt);
    parser.addOption(appUrlOpt);
    parser.addPositionalArgument(QStringLiteral("link"), QStringLiteral("Optional serika:// link to open"));
    parser.process(app);

    if (parser.isSet(appUrlOpt)) SerikaConfig::setAppUrl(parser.value(appUrlOpt));

    QString launchLink;
    for (const QString &arg : parser.positionalArguments()) {
        if (DeepLinkHandler::isDeepLink(arg)) { launchLink = arg; break; }
    }

    // ── Single instance: hand the link to the running app and exit ───────
    SingleInstance single(QString::fromLatin1(INSTANCE_KEY));
    if (!single.tryLock()) {
        QLocalSocket socket;
        socket.connectToServer(QString::fromLatin1(INSTANCE_KEY));
        if (socket.waitForConnected(1000)) {
            // A second login-time launch shouldn't pop the window up.
            const QString msg = !launchLink.isEmpty() ? launchLink
                : parser.isSet(autostartOpt) ? QString() : QString::fromLatin1(SHOW_MESSAGE);
            socket.write(msg.toUtf8());
            socket.flush();
            socket.waitForBytesWritten(1000);
            socket.disconnectFromServer();
        }
        return 0;
    }

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
        if (msg == QLatin1String(SHOW_MESSAGE) || !deepLinks.handleLink(msg)) mainWindow.showAndFocus();
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
