#include "WebBridge.h"
#include "AppSettings.h"
#include "GlobalShortcuts.h"
#include "IdleMonitor.h"
#include "SerikaWebPage.h"

#include <QBuffer>
#include <QByteArray>
#include <QClipboard>
#include <QCoreApplication>
#include <QGuiApplication>
#include <QImage>
#include <QMimeData>
#include <QSysInfo>
#include <QUrl>

WebBridge::WebBridge(AppSettings *settings, IdleMonitor *idle, GlobalShortcuts *shortcuts, QObject *parent)
    : QObject(parent)
    , m_settings(settings)
    , m_idle(idle)
    , m_shortcuts(shortcuts)
{
    m_updateState.insert(QStringLiteral("state"), QStringLiteral("idle"));
    connect(m_settings, &AppSettings::changed, this, [this]() { emit settingsChanged(getSettings()); });
}

QVariantMap WebBridge::getInfo() {
    QVariantMap info;
    info.insert(QStringLiteral("version"), QCoreApplication::applicationVersion());
    info.insert(QStringLiteral("protocol"), PROTOCOL_VERSION);
#if defined(Q_OS_WIN)
    info.insert(QStringLiteral("platform"), QStringLiteral("windows"));
#elif defined(Q_OS_MACOS)
    info.insert(QStringLiteral("platform"), QStringLiteral("macos"));
#else
    info.insert(QStringLiteral("platform"), QStringLiteral("linux"));
#endif
    info.insert(QStringLiteral("arch"), QSysInfo::currentCpuArchitecture());
    info.insert(QStringLiteral("qt"), QString::fromLatin1(qVersion()));
    info.insert(QStringLiteral("windowSystem"), QGuiApplication::platformName());
    info.insert(QStringLiteral("capabilities"), m_caps);
    return info;
}

void WebBridge::pageCreated() {
    m_webReady = false;
    emit newDocument();
}

void WebBridge::webReady() {
    if (m_webReady) return;
    m_webReady = true;
    emit webReadyChanged();
}

void WebBridge::setZoom(double delta) { emit zoomRequested(delta); }
void WebBridge::toggleFullscreen() { emit fullscreenRequested(); }
void WebBridge::toggleDevTools() { emit devToolsRequested(); }
void WebBridge::setWindowTitle(const QString &title) { emit windowTitleChangeRequested(title); }
void WebBridge::setBadgeCount(int count) { emit badgeCountRequested(qMax(0, count)); }
void WebBridge::focusWindow() { emit focusRequested(); }
void WebBridge::reportPresence(const QString &jsonPayload) { emit presenceReported(jsonPayload); }

void WebBridge::openExternal(const QString &url) {
    openExternally(QUrl(url));
}

void WebBridge::showNotification(const QVariantMap &notification) {
    if (!m_settings->nativeNotifications()) return;
    emit notificationRequested(notification);
}

void WebBridge::closeNotification(const QString &tag) {
    emit notificationCloseRequested(tag);
}

void WebBridge::setVoiceState(const QVariantMap &state) {
    emit voiceStateReported(state.value("connected").toBool(), state.value("muted").toBool(),
                            state.value("deafened").toBool());
}

void WebBridge::setUserStatus(const QString &status) {
    emit userStatusReported(status);
}

QStringList WebBridge::setGlobalShortcuts(const QVariantList &shortcuts) {
    if (!m_shortcuts) return {};
    return m_shortcuts->setShortcuts(shortcuts);
}

QVariantMap WebBridge::getSettings() {
    QVariantMap map = m_settings->toMap();
    map.insert(QStringLiteral("globalShortcutsAvailable"), GlobalShortcuts::available());
    return map;
}

bool WebBridge::setSetting(const QString &key, const QVariant &value) {
    return m_settings->set(key, value);
}

int WebBridge::getIdleSeconds() {
    return m_idle ? m_idle->idleSeconds() : 0;
}

void WebBridge::checkForUpdates() { emit checkUpdatesRequested(); }
void WebBridge::installUpdate() { emit installUpdateRequested(); }
QVariantMap WebBridge::getUpdateState() { return m_updateState; }

void WebBridge::setUpdateState(const QVariantMap &state) {
    if (state == m_updateState) return;
    m_updateState = state;
    emit updateStateChanged(state);
}

void WebBridge::setPlatformCapabilities(const QVariantMap &caps) {
    m_caps = caps;
}

QVariantMap WebBridge::readClipboardImage() {
    QVariantMap result;
    auto *clipboard = QGuiApplication::clipboard();
    if (!clipboard) return result;

    const QMimeData *mime = clipboard->mimeData();
    if (!mime) return result;

    QImage img;
    if (mime->hasImage()) {
        img = qvariant_cast<QImage>(mime->imageData());
    } else if (mime->hasUrls()) {
        for (const auto &url : mime->urls()) {
            if (url.isLocalFile()) {
                img.load(url.toLocalFile());
                if (!img.isNull()) break;
            }
        }
    }

    if (img.isNull()) return result;

    img = img.convertToFormat(QImage::Format_RGBA8888);
    QByteArray byteArray(reinterpret_cast<const char *>(img.constBits()), img.sizeInBytes());
    result["rgba"] = QString::fromLatin1(byteArray.toBase64());
    result["width"] = img.width();
    result["height"] = img.height();
    return result;
}
