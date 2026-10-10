#pragma once

#include <QCache>
#include <QHash>
#include <QImage>
#include <QNetworkAccessManager>
#include <QObject>
#include <QString>
#include <QVariantMap>

#include <map>
#include <memory>

class QSystemTrayIcon;
class QWebEngineNotification;

// Native OS notifications for the web app.
//   Linux         : org.freedesktop.Notifications over D-Bus (avatar image,
//                   click action, replace by conversation, close when read)
//   Windows/macOS : the tray icon's notification balloon / toast
// Clicking one emits activated(id, url) so the shell can focus the window and
// route the app to the message.
class NotificationManager : public QObject {
    Q_OBJECT

public:
    explicit NotificationManager(QSystemTrayIcon *tray, QObject *parent = nullptr);
    ~NotificationManager() override;

    // { id, title, body, icon (http(s) URL), url, tag, requireInteraction }
    void show(const QVariantMap &notification);
    // Close the notification for a tag (the conversation was read).
    void close(const QString &tag);
    // Notifications created with `new Notification()` inside the page.
    void presentWebNotification(std::unique_ptr<QWebEngineNotification> notification);

    static bool hasNativeBackend();

signals:
    void activated(const QString &id, const QString &url);

private slots:
    void onDbusActionInvoked(uint id, const QString &action);
    void onDbusClosed(uint id, uint reason);
    void onTrayMessageClicked();

private:
    struct Entry {
        QString id;
        QString url;
        uint dbusId{0};
        bool pending{false};
        bool closeWhenShown{false};
        bool fromWeb{false};
    };

    void display(const QString &key, const QString &title, const QString &body,
                 const QImage &image, bool persistent);
    void displayDbus(const QString &key, const QString &title, const QString &body,
                     const QImage &image, bool persistent);
    QString cacheImage(const QImage &image);
    void activate(const QString &key);
    QString keyForDbusId(uint id) const;
    void dropWebNotification(const QString &key);

    QSystemTrayIcon *m_tray;
    QNetworkAccessManager m_net;
    QCache<QString, QImage> m_iconCache{64};
    QHash<QString, Entry> m_entries;
    std::map<QString, std::unique_ptr<QWebEngineNotification>> m_webNotifications;
    QString m_lastTrayKey;
    bool m_dbus{false};
};
