#include "NotificationManager.h"

#include <QApplication>
#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QIcon>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QStandardPaths>
#include <QSystemTrayIcon>
#include <QUrl>
#include <QWebEngineNotification>

#if defined(SERIKA_HAVE_DBUS)
#include <QDBusConnection>
#include <QDBusConnectionInterface>
#include <QDBusMessage>
#include <QDBusPendingCallWatcher>
#include <QDBusPendingReply>
#endif

namespace {
constexpr const char *DBUS_SERVICE = "org.freedesktop.Notifications";
constexpr const char *DBUS_PATH = "/org/freedesktop/Notifications";
constexpr const char *DBUS_IFACE = "org.freedesktop.Notifications";
constexpr int ICON_SIZE = 96;

// Avatars look like Discord's: a circle.
QImage roundAvatar(const QImage &src) {
    if (src.isNull()) return {};
    const QImage scaled = src.scaled(ICON_SIZE, ICON_SIZE, Qt::KeepAspectRatioByExpanding,
                                     Qt::SmoothTransformation);
    QImage out(ICON_SIZE, ICON_SIZE, QImage::Format_ARGB32_Premultiplied);
    out.fill(Qt::transparent);
    QPainter p(&out);
    p.setRenderHint(QPainter::Antialiasing);
    QPainterPath clip;
    clip.addEllipse(0, 0, ICON_SIZE, ICON_SIZE);
    p.setClipPath(clip);
    p.drawImage((ICON_SIZE - scaled.width()) / 2, (ICON_SIZE - scaled.height()) / 2, scaled);
    p.end();
    return out;
}

QString escapeMarkup(QString s) {
    // Notification servers may treat the body as a small HTML subset.
    s.replace('&', QLatin1String("&amp;"));
    s.replace('<', QLatin1String("&lt;"));
    s.replace('>', QLatin1String("&gt;"));
    return s;
}

bool fetchableIcon(const QUrl &url) {
    if (!url.isValid()) return false;
    if (url.scheme() == QLatin1String("https")) return true;
    const QString host = url.host();
    return url.scheme() == QLatin1String("http")
        && (host == QLatin1String("localhost") || host == QLatin1String("127.0.0.1"));
}
} // namespace

NotificationManager::NotificationManager(QSystemTrayIcon *tray, QObject *parent)
    : QObject(parent)
    , m_tray(tray)
{
#if defined(SERIKA_HAVE_DBUS)
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (bus.isConnected() && bus.interface()
        && bus.interface()->isServiceRegistered(QString::fromLatin1(DBUS_SERVICE))) {
        m_dbus = true;
        bus.connect(QString::fromLatin1(DBUS_SERVICE), QString::fromLatin1(DBUS_PATH),
                    QString::fromLatin1(DBUS_IFACE), QStringLiteral("ActionInvoked"),
                    this, SLOT(onDbusActionInvoked(uint,QString)));
        bus.connect(QString::fromLatin1(DBUS_SERVICE), QString::fromLatin1(DBUS_PATH),
                    QString::fromLatin1(DBUS_IFACE), QStringLiteral("NotificationClosed"),
                    this, SLOT(onDbusClosed(uint,uint)));
    }
#endif
    if (m_tray) {
        connect(m_tray, &QSystemTrayIcon::messageClicked, this, &NotificationManager::onTrayMessageClicked);
    }
}

NotificationManager::~NotificationManager() = default;

bool NotificationManager::hasNativeBackend() {
#if defined(SERIKA_HAVE_DBUS)
    return true;
#else
    return QSystemTrayIcon::supportsMessages();
#endif
}

void NotificationManager::show(const QVariantMap &n) {
    const QString id = n.value("id").toString();
    const QString tag = n.value("tag").toString();
    const QString key = tag.isEmpty() ? id : tag;
    if (key.isEmpty()) return;
    const QString title = n.value("title").toString().left(200);
    const QString body = n.value("body").toString().left(600);
    const bool persistent = n.value("requireInteraction").toBool();

    Entry &e = m_entries[key];
    e.id = id;
    e.url = n.value("url").toString();
    e.fromWeb = false;
    e.closeWhenShown = false;

    const QUrl iconUrl(n.value("icon").toString());
    if (!fetchableIcon(iconUrl)) {
        display(key, title, body, QImage(), persistent);
        return;
    }
    const QString cacheKey = iconUrl.toString();
    if (QImage *cached = m_iconCache.object(cacheKey)) {
        display(key, title, body, *cached, persistent);
        return;
    }
    QNetworkRequest req(iconUrl);
    req.setTransferTimeout(4000);
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    QNetworkReply *reply = m_net.get(req);
    connect(reply, &QNetworkReply::finished, this, [=, this]() {
        reply->deleteLater();
        QImage img;
        if (reply->error() == QNetworkReply::NoError) {
            const QByteArray data = reply->read(4 * 1024 * 1024);
            img = roundAvatar(QImage::fromData(data));
            if (!img.isNull()) m_iconCache.insert(cacheKey, new QImage(img));
        }
        // The conversation may have been read while the avatar loaded.
        auto it = m_entries.find(key);
        if (it == m_entries.end() || it->id != id) return;
        display(key, title, body, img, persistent);
    });
}

void NotificationManager::display(const QString &key, const QString &title, const QString &body,
                                  const QImage &image, bool persistent) {
    if (m_dbus) {
        displayDbus(key, title, body, image, persistent);
        return;
    }
    if (!m_tray) return;
    QIcon icon = image.isNull() ? QApplication::windowIcon() : QIcon(QPixmap::fromImage(image));
    m_lastTrayKey = key;
    m_tray->showMessage(title, body, icon, persistent ? 30000 : 6000);
}

QString NotificationManager::cacheImage(const QImage &image) {
    if (image.isNull()) return {};
    QString dir = QStandardPaths::writableLocation(QStandardPaths::CacheLocation);
    if (dir.isEmpty()) dir = QDir::tempPath();
    dir += QStringLiteral("/notification-icons");
    QDir().mkpath(dir);
    const QByteArray bytes(reinterpret_cast<const char *>(image.constBits()), image.sizeInBytes());
    const QString name = QString::fromLatin1(
        QCryptographicHash::hash(bytes, QCryptographicHash::Sha1).toHex().left(20));
    const QString path = dir + '/' + name + QStringLiteral(".png");
    if (!QFile::exists(path)) image.save(path, "PNG");
    return path;
}

void NotificationManager::displayDbus(const QString &key, const QString &title, const QString &body,
                                      const QImage &image, bool persistent) {
#if defined(SERIKA_HAVE_DBUS)
    Entry &e = m_entries[key];
    QVariantMap hints;
    hints.insert(QStringLiteral("desktop-entry"), QStringLiteral("serikacord"));
    hints.insert(QStringLiteral("category"), QStringLiteral("im.received"));
    // The web app plays its own notification sound.
    hints.insert(QStringLiteral("suppress-sound"), true);
    hints.insert(QStringLiteral("urgency"), QVariant::fromValue<uchar>(persistent ? 2 : 1));
    const QString imagePath = cacheImage(image);
    if (!imagePath.isEmpty()) hints.insert(QStringLiteral("image-path"), imagePath);

    QDBusMessage msg = QDBusMessage::createMethodCall(QString::fromLatin1(DBUS_SERVICE),
        QString::fromLatin1(DBUS_PATH), QString::fromLatin1(DBUS_IFACE), QStringLiteral("Notify"));
    msg << QStringLiteral("SerikaCord")
        << static_cast<uint>(e.dbusId)
        << QStringLiteral("serikacord")
        << title
        << escapeMarkup(body)
        << QStringList{QStringLiteral("default"), QStringLiteral("Open")}
        << hints
        << static_cast<int>(persistent ? 0 : -1);
    e.pending = true;
    QDBusPendingCallWatcher *w = new QDBusPendingCallWatcher(QDBusConnection::sessionBus().asyncCall(msg), this);
    const QString id = e.id;
    connect(w, &QDBusPendingCallWatcher::finished, this, [this, key, id](QDBusPendingCallWatcher *watcher) {
        watcher->deleteLater();
        QDBusPendingReply<uint> reply = *watcher;
        auto it = m_entries.find(key);
        if (it == m_entries.end() || it->id != id) {
            // Closed (or replaced) before the server answered.
            if (reply.isValid() && (it == m_entries.end())) {
                QDBusConnection::sessionBus().asyncCall(QDBusMessage::createMethodCall(
                    QString::fromLatin1(DBUS_SERVICE), QString::fromLatin1(DBUS_PATH),
                    QString::fromLatin1(DBUS_IFACE), QStringLiteral("CloseNotification")) << reply.value());
            }
            return;
        }
        it->pending = false;
        if (!reply.isValid()) return;
        it->dbusId = reply.value();
        if (it->closeWhenShown) close(key);
    });
#else
    Q_UNUSED(key) Q_UNUSED(title) Q_UNUSED(body) Q_UNUSED(image) Q_UNUSED(persistent)
#endif
}

void NotificationManager::close(const QString &tag) {
    auto it = m_entries.find(tag);
    if (it == m_entries.end()) return;
#if defined(SERIKA_HAVE_DBUS)
    if (m_dbus) {
        if (it->pending) {
            // Notify() hasn't returned an id yet; the reply handler sees the
            // entry is gone and closes it.
        } else if (it->dbusId) {
            QDBusConnection::sessionBus().asyncCall(QDBusMessage::createMethodCall(
                QString::fromLatin1(DBUS_SERVICE), QString::fromLatin1(DBUS_PATH),
                QString::fromLatin1(DBUS_IFACE), QStringLiteral("CloseNotification")) << it->dbusId);
        }
    }
#endif
    if (m_lastTrayKey == tag) m_lastTrayKey.clear();
    m_entries.erase(it);
    dropWebNotification(tag);
}

void NotificationManager::dropWebNotification(const QString &key) {
    auto w = m_webNotifications.find(key);
    if (w == m_webNotifications.end()) return;
    // May run inside the notification's own closed() signal: delete later.
    QWebEngineNotification *n = w->second.release();
    m_webNotifications.erase(w);
    if (n) {
        n->disconnect(this);
        n->deleteLater();
    }
}

void NotificationManager::presentWebNotification(std::unique_ptr<QWebEngineNotification> n) {
    if (!n) return;
    const QString key = QStringLiteral("web:") + (n->tag().isEmpty() ? QString::number(reinterpret_cast<quintptr>(n.get())) : n->tag());
    QWebEngineNotification *raw = n.get();
    connect(raw, &QWebEngineNotification::closed, this, [this, key, raw]() {
        auto it = m_webNotifications.find(key);
        if (it != m_webNotifications.end() && it->second.get() == raw) close(key);
    });
    Entry &e = m_entries[key];
    e.id = key;
    e.url.clear();
    e.fromWeb = true;
    const QImage icon = roundAvatar(n->icon());
    const QString title = n->title();
    const QString body = n->message();
    raw->show();
    dropWebNotification(key);
    m_webNotifications[key] = std::move(n);
    display(key, title, body, icon, false);
}

void NotificationManager::activate(const QString &key) {
    auto it = m_entries.find(key);
    if (it == m_entries.end()) return;
    const Entry e = *it;
    if (e.fromWeb) {
        auto w = m_webNotifications.find(key);
        if (w != m_webNotifications.end() && w->second) w->second->click();
        emit activated(e.id, QString());
    } else {
        emit activated(e.id, e.url);
    }
}

QString NotificationManager::keyForDbusId(uint id) const {
    for (auto it = m_entries.constBegin(); it != m_entries.constEnd(); ++it) {
        if (it->dbusId == id) return it.key();
    }
    return {};
}

void NotificationManager::onDbusActionInvoked(uint id, const QString &action) {
    Q_UNUSED(action)
    const QString key = keyForDbusId(id);
    if (key.isEmpty()) return;
    activate(key);
}

void NotificationManager::onDbusClosed(uint id, uint reason) {
    Q_UNUSED(reason)
    const QString key = keyForDbusId(id);
    if (key.isEmpty()) return;
    // Keep the entry so a replacement reuses nothing stale; just forget the id.
    m_entries.remove(key);
    auto w = m_webNotifications.find(key);
    if (w != m_webNotifications.end() && w->second) w->second->close();
    dropWebNotification(key);
}

void NotificationManager::onTrayMessageClicked() {
    if (m_lastTrayKey.isEmpty()) {
        emit activated(QString(), QString());
        return;
    }
    activate(m_lastTrayKey);
}
