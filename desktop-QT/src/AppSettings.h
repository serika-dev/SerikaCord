#pragma once

#include <QObject>
#include <QSettings>
#include <QVariantMap>

// Desktop-only preferences (stored with QSettings in the OS-native place:
// registry on Windows, plist on macOS, ~/.config/SerikaCord on Linux). The web
// app's "Desktop" settings section reads and writes them through the bridge.
class AppSettings : public QObject {
    Q_OBJECT

public:
    explicit AppSettings(QObject *parent = nullptr);

    bool closeToTray() const;
    bool minimizeToTray() const;
    bool startOnLogin() const;
    bool startMinimized() const;
    bool spellcheck() const;
    bool nativeNotifications() const;
    bool globalShortcuts() const;
    bool hardwareAcceleration() const;
    // Minutes without keyboard/mouse input before you're shown as Idle; 0 = never.
    int idleTimeoutMinutes() const;

    // All preferences as a JSON-friendly map (what the web app sees).
    QVariantMap toMap() const;

    // Update one preference. Returns false for unknown keys / bad values.
    bool set(const QString &key, const QVariant &value);

    // Window/zoom state (not part of the web-visible map).
    QByteArray windowGeometry() const;
    bool windowMaximized() const;
    void saveWindowState(const QByteArray &geometry, bool maximized);
    double zoomFactor() const;
    void setZoomFactor(double factor);

signals:
    void changed(const QString &key, const QVariant &value);

private:
    bool boolValue(const char *key, bool fallback) const;
    mutable QSettings m_settings;
};
