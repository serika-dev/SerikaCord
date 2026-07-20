#pragma once

#include <QObject>
#include <QString>
#include <QVariantMap>

class WebBridge : public QObject {
    Q_OBJECT

public:
    explicit WebBridge(QObject *parent = nullptr);
    ~WebBridge() override = default;

    // Called from JS via QWebChannel
    Q_INVOKABLE void setZoom(double delta);
    Q_INVOKABLE void toggleFullscreen();
    Q_INVOKABLE void toggleDevTools();
    Q_INVOKABLE void setWindowTitle(const QString &title);
    Q_INVOKABLE void setBadgeCount(int count);
    Q_INVOKABLE bool isMuted();
    Q_INVOKABLE bool toggleMute();
    Q_INVOKABLE void openExternal(const QString &url);
    Q_INVOKABLE void reportPresence(const QString &jsonPayload);

    // Clipboard support — returns {rgba, width, height} or empty
    Q_INVOKABLE QVariantMap readClipboardImage();

signals:
    void zoomRequested(double delta);
    void fullscreenRequested();
    void devToolsRequested();
    void windowTitleChangeRequested(const QString &title);
    void badgeCountRequested(int count);
    void muteToggled(bool muted);
    void openExternalRequested(const QString &url);
    void presenceReported(const QString &jsonPayload);
};
