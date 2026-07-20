#pragma once

#include <QMainWindow>
#include <QWebEngineView>
#include <QWebEngineProfile>
#include <QWebEnginePage>
#include <QWebEngineScript>
#include <QWebChannel>
#include <QTimer>
#include <QAction>
#include <QLabel>
#include <atomic>

#include "SerikaWebPage.h"

// Shared constants
namespace SerikaConfig {
    inline constexpr const char *APP_URL = "https://serika.chat";
    inline constexpr const char *START_PATH = "/channels/me";
}

class WebBridge;
class TrayIcon;
class PresenceDetector;

class MainWindow : public QMainWindow {
    Q_OBJECT

public:
    explicit MainWindow(QWidget *parent = nullptr);
    ~MainWindow() override;

    void loadUrl(const QString &url);
    void showAndFocus();
    void toggleVisibility();
    void setZoom(double factor);
    void toggleFullscreen();
    void toggleDevTools();
    void setBadgeCount(int count);
    void toggleMute();
    bool isMuted() const { return m_muted.load(); }
    void navigateToDeepLink(const QString &path);
    void injectPresenceActivities(const QJsonArray &activities);

    WebBridge *webBridge() const { return m_webBridge; }

signals:
    void windowTitleChanged(const QString &title);
    void muteToggled(bool muted);

protected:
    void closeEvent(QCloseEvent *event) override;
    void keyPressEvent(QKeyEvent *event) override;

private slots:
    void onTitleChanged(const QString &title);
    void onUrlChanged(const QUrl &url);
    void onPresenceHeartbeat();

private:
    void setupWebChannel();
    void injectInitScripts();

    QWebEngineView *m_view;
    QWebEngineProfile *m_profile{nullptr};
    QWebEnginePage *m_page;
    QWebChannel *m_channel;
    WebBridge *m_webBridge;
    TrayIcon *m_trayIcon;
    PresenceDetector *m_presenceDetector;
    QTimer *m_presenceHeartbeat;

    std::atomic<bool> m_muted{false};
    double m_currentZoom{1.0};
    QString m_lastPresenceJson;
};
