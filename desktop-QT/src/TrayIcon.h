#pragma once

#include <QIcon>
#include <QObject>
#include <QString>
#include <QSystemTrayIcon>

class QAction;
class QActionGroup;
class QMenu;

// Discord-style tray icon: unread dot on the icon, and a menu with
// Open / Mute / Deafen / Status / Check for Updates / Quit. Mute, deafen and
// status mirror the app's live state (pushed from the page through the bridge).
class TrayIcon : public QObject {
    Q_OBJECT

public:
    explicit TrayIcon(QObject *parent = nullptr);
    ~TrayIcon() override;

    void show();
    QSystemTrayIcon *systemTrayIcon() const { return m_tray; }

    void setUnread(int count);
    void setVoiceState(bool connected, bool muted, bool deafened);
    void setStatus(const QString &status); // online | idle | dnd | offline
    void setUpdateReady(const QString &version);

    // Render the app icon with a red unread dot (shared with the window icon).
    static QIcon iconWithDot(const QIcon &base, bool dot);

signals:
    void openRequested();
    void toggleRequested();
    void quitRequested();
    void checkUpdatesRequested();
    void installUpdateRequested();
    void muteToggleRequested();
    void deafenToggleRequested();
    void statusRequested(const QString &status);

private:
    void refreshIcon();

    QSystemTrayIcon *m_tray;
    QMenu *m_menu;
    QAction *m_openAction;
    QAction *m_muteAction;
    QAction *m_deafenAction;
    QMenu *m_statusMenu;
    QActionGroup *m_statusGroup;
    QAction *m_updateAction;
    QAction *m_installAction;
    QAction *m_quitAction;
    QIcon m_baseIcon;
    int m_unread{0};
};
