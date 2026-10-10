#pragma once

#include <QJsonArray>
#include <QMainWindow>
#include <QPointer>
#include <QString>
#include <QTimer>
#include <QUrl>
#include <QVariantMap>

#include "AppConfig.h"

class AppSettings;
class GlobalShortcuts;
class IdleMonitor;
class NotificationManager;
class PresenceDetector;
class QWebChannel;
class QWebEngineDownloadRequest;
class QWebEngineProfile;
class SerikaWebPage;
class SerikaWebView;
class TrayIcon;
class Updater;
class WebBridge;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(AppSettings *settings, QWidget *parent = nullptr);
    ~MainWindow() override;

    void loadUrl(const QString &url);
    void showAndFocus();
    void toggleVisibility();
    void setZoom(double factor);
    void toggleFullscreen();
    void toggleDevTools();
    void setBadgeCount(int count);
    // Route an in-app path (from a deep link) into the running app.
    void navigateToDeepLink(const QString &path);
    void injectPresenceActivities(const QJsonArray &activities);

    // Background update check (manual = from the tray/settings: report
    // "up to date" / errors instead of staying quiet).
    void checkForUpdates(bool manual);
    void installUpdate();
    // Restore the saved size/position (call before the first show()).
    void restoreWindowState();

    WebBridge *webBridge() const { return m_webBridge; }

protected:
    void closeEvent(QCloseEvent *event) override;
    void changeEvent(QEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;
    void moveEvent(QMoveEvent *event) override;
    void resizeEvent(QResizeEvent *event) override;

private slots:
    void onTitleChanged(const QString &title);
    void onPresenceHeartbeat();
    void onDownloadRequested(QWebEngineDownloadRequest *download);
    void saveWindowState();

private:
    void setupProfile();
    void setupScripts();
    void setupPermissions();
    void setupTray();
    void applySetting(const QString &key, const QVariant &value);
    void applySpellcheck(bool enabled);
    void navigateInApp(const QString &pathAndQuery);
    void setUpdateState(const QString &state, const QString &version = QString(), int percent = -1);
    QString desktopMarkerScript() const;
    void quitApp();

    AppSettings *m_settings;
    SerikaWebView *m_view;
    QWebEngineProfile *m_profile{nullptr};
    SerikaWebPage *m_page{nullptr};
    QWebChannel *m_channel;
    GlobalShortcuts *m_shortcuts;
    IdleMonitor *m_idle;
    WebBridge *m_webBridge;
    TrayIcon *m_trayIcon{nullptr};
    NotificationManager *m_notifications{nullptr};
    PresenceDetector *m_presenceDetector{nullptr};
    QTimer *m_presenceHeartbeat;
    QTimer m_saveStateTimer;
    QTimer m_updateTimer;
    QPointer<QMainWindow> m_devTools;
    QPointer<Updater> m_updater;
    bool m_manualUpdateCheck{false};
    QString m_pendingInstaller;
    QString m_pendingVersion;

    double m_currentZoom{1.0};
    QString m_lastPresenceJson;
    bool m_quitting{false};
};
