#pragma once

#include <QObject>
#include <QString>
#include <QStringList>
#include <QVariantList>
#include <QVariantMap>

class AppSettings;
class IdleMonitor;
class GlobalShortcuts;

// The object the page sees as `window.qt.webBridge` (QWebChannel). The web
// side wrapper lives in src/lib/desktop/bridge.ts; bump PROTOCOL_VERSION when
// the surface changes incompatibly.
//
// Signals in the first block are delivered to the page; the "requests" block
// is wiring for MainWindow (QWebChannel exposes them too, harmlessly).
class WebBridge : public QObject {
    Q_OBJECT

public:
    static constexpr int PROTOCOL_VERSION = 2;

    WebBridge(AppSettings *settings, IdleMonitor *idle, GlobalShortcuts *shortcuts,
              QObject *parent = nullptr);
    ~WebBridge() override = default;

    // ── Called from JS ───────────────────────────────────────────────────
    Q_INVOKABLE QVariantMap getInfo();
    // A new document connected (sent by the injected channel script).
    Q_INVOKABLE void pageCreated();
    // The page's bridge client is connected and listening.
    Q_INVOKABLE void webReady();

    Q_INVOKABLE void setZoom(double delta);
    Q_INVOKABLE void toggleFullscreen();
    Q_INVOKABLE void toggleDevTools();
    Q_INVOKABLE void setWindowTitle(const QString &title);
    Q_INVOKABLE void setBadgeCount(int count);
    Q_INVOKABLE void openExternal(const QString &url);
    Q_INVOKABLE void focusWindow();
    Q_INVOKABLE void reportPresence(const QString &jsonPayload);
    // Clipboard image as {rgba (base64), width, height}, or empty.
    Q_INVOKABLE QVariantMap readClipboardImage();

    // { id, title, body, icon, url, tag, requireInteraction }
    Q_INVOKABLE void showNotification(const QVariantMap &notification);
    Q_INVOKABLE void closeNotification(const QString &tag);

    // { connected, muted, deafened } — mirrored in the tray menu.
    Q_INVOKABLE void setVoiceState(const QVariantMap &state);
    // online | idle | dnd | offline (invisible); "" when signed out.
    Q_INVOKABLE void setUserStatus(const QString &status);

    // [{ action, accelerator, hold, whileFocused }] -> actions that were bound.
    Q_INVOKABLE QStringList setGlobalShortcuts(const QVariantList &shortcuts);

    Q_INVOKABLE QVariantMap getSettings();
    Q_INVOKABLE bool setSetting(const QString &key, const QVariant &value);

    Q_INVOKABLE int getIdleSeconds();

    Q_INVOKABLE void checkForUpdates();
    Q_INVOKABLE void installUpdate();
    // { state: idle|checking|downloading|ready|uptodate|error, version, percent }
    Q_INVOKABLE QVariantMap getUpdateState();

    // ── Called from C++ ──────────────────────────────────────────────────
    void setUpdateState(const QVariantMap &state);
    void setPlatformCapabilities(const QVariantMap &caps);
    bool isWebReady() const { return m_webReady; }

signals:
    // ── Delivered to the page ────────────────────────────────────────────
    void notificationClicked(const QString &id, const QString &url);
    void navigateRequested(const QString &path);
    // toggle-mute | toggle-deafen | set-status (value) | open-settings (value)
    void trayAction(const QString &action, const QString &value);
    // push-to-talk (pressed/released) | toggle-mute | toggle-deafen
    void globalShortcut(const QString &action, bool pressed);
    void idleChanged(bool idle);
    void updateStateChanged(const QVariantMap &state);
    void settingsChanged(const QVariantMap &settings);

    // ── Requests handled by MainWindow ───────────────────────────────────
    void webReadyChanged();
    void newDocument();
    void zoomRequested(double delta);
    void fullscreenRequested();
    void devToolsRequested();
    void windowTitleChangeRequested(const QString &title);
    void badgeCountRequested(int count);
    void focusRequested();
    void presenceReported(const QString &jsonPayload);
    void notificationRequested(const QVariantMap &notification);
    void notificationCloseRequested(const QString &tag);
    void voiceStateReported(bool connected, bool muted, bool deafened);
    void userStatusReported(const QString &status);
    void checkUpdatesRequested();
    void installUpdateRequested();

private:
    AppSettings *m_settings;
    IdleMonitor *m_idle;
    GlobalShortcuts *m_shortcuts;
    QVariantMap m_updateState;
    QVariantMap m_caps;
    bool m_webReady{false};
};
