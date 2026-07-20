// SerikaCord native desktop shell (Qt6).
//
// Loads the hosted web app and provides desktop niceties: tray icon,
// close-to-tray, single instance, serikacord:// deep links, external
// links opening in the browser, rich-presence detection, and an
// updater splash window — all with full feature parity to the Tauri app.

#include <QApplication>
#include <QCommandLineParser>
#include <QUrl>
#include <QTimer>
#include <QStandardPaths>
#include <QDir>
#include <QWebEngineProfile>
#include <QIcon>
#include <QLocalSocket>
#include <QGuiApplication>
#include <QScreen>

#include "MainWindow.h"
#include "SingleInstance.h"
#include "UpdaterWindow.h"
#include "DeepLinkHandler.h"
#include "TrayIcon.h"
#include "PresenceDetector.h"

#ifdef Q_OS_WIN
#include <windows.h>
#endif

// Set Chromium flags for hardware acceleration and smooth rendering
// Must be set before QApplication is created
static void setupChromiumFlags() {
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS",
        "--enable-gpu-rasterization "
        "--enable-smooth-scrolling "
        "--enable-features=OverlayScrollbar "
        "--disable-background-timer-throttling "
        "--disable-renderer-backgrounding "
        "--disable-backgrounding-occluded-windows "
        "--disable-features=BackForwardCache"
    );
}

// Enable high-DPI scaling so the app looks crisp on all displays
static void setupHighDpi() {
    // Qt6 enables high-DPI by default, but we set the rounding policy
    // to pass-through for fractional scaling (e.g. 1.25x, 1.5x)
    qputenv("QT_ENABLE_HIGHDPI_SCALING", "1");
    qputenv("QT_AUTO_SCREEN_SCALE_FACTOR", "1");
    // Use pass-through rounding so 1.5x displays don't get rounded to 1x or 2x
    QGuiApplication::setHighDpiScaleFactorRoundingPolicy(
        Qt::HighDpiScaleFactorRoundingPolicy::PassThrough);
}

static const char *INSTANCE_KEY = "serikacord-desktop-qt-single-instance";

int main(int argc, char *argv[]) {
    // Set Chromium flags before QApplication is created
    setupChromiumFlags();
    setupHighDpi();

    // High-DPI support is automatic in Qt6.

    QApplication app(argc, argv);
    app.setApplicationName("SerikaCord");
    app.setApplicationVersion("1.2.7");
    app.setOrganizationName("SerikaCord");
    app.setQuitOnLastWindowClosed(false); // keep running in tray

    // Set app icon
    app.setWindowIcon(QIcon(":/icons/app-icon.png"));

    // Parse command line for deep links
    QCommandLineParser parser;
    parser.setApplicationDescription("SerikaCord — native desktop client");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addPositionalArgument("url", "Optional serikacord:// deep link to open");
    parser.process(app);

    // ── Single instance guard ────────────────────────────────────────────────
    SingleInstance single(INSTANCE_KEY);
    if (!single.tryLock()) {
        // Another instance is already running. Send it the deep link (if any)
        // via a local socket so it can navigate + focus.
        const auto positional = parser.positionalArguments();
        QString message = positional.isEmpty() ? "" : positional.first();
        QLocalSocket socket;
        socket.connectToServer(INSTANCE_KEY);
        if (socket.waitForConnected(1000)) {
            socket.write(message.toUtf8());
            socket.waitForBytesWritten(1000);
            socket.disconnectFromServer();
        }
        return 0;
    }

    // ── Updater splash window ────────────────────────────────────────────────
    UpdaterWindow updater;
    updater.showSplash();

    // ── Main window ──────────────────────────────────────────────────────────
    MainWindow mainWindow;

    // ── Deep link handler ────────────────────────────────────────────────────
    DeepLinkHandler deepLinkHandler;
    deepLinkHandler.registerScheme();
    QObject::connect(&deepLinkHandler, &DeepLinkHandler::deepLinkReceived,
                     &mainWindow, &MainWindow::navigateToDeepLink);

    // Handle deep link passed as command-line argument
    const auto positional = parser.positionalArguments();
    for (const auto &arg : positional) {
        if (arg.startsWith("serikacord://")) {
            deepLinkHandler.handleLink(arg);
        }
    }

    // ── Single instance: focus existing window when another launches ─────────
    QObject::connect(&single, &SingleInstance::anotherInstanceStarted,
                     &mainWindow, [&mainWindow, &deepLinkHandler](const QString &msg) {
        if (msg.startsWith("serikacord://")) {
            deepLinkHandler.handleLink(msg);
        }
        mainWindow.showAndFocus();
    });

    // ── Simulate update check, then show main window ─────────────────────────
    // In a real build this would hit the GitHub releases endpoint and download
    // an update. For now we just show the splash briefly, then proceed.
    QTimer::singleShot(1500, [&]() {
        updater.setVersionText("v1.2.7");
        updater.setIndeterminate("Starting SerikaCord…");
    });

    QTimer::singleShot(2200, [&]() {
        updater.closeSplash();

        // Load the main URL
        QString startUrl = QString("%1%2").arg(SerikaConfig::APP_URL, SerikaConfig::START_PATH);
        mainWindow.loadUrl(startUrl);
        mainWindow.showAndFocus();
    });

    return app.exec();
}
