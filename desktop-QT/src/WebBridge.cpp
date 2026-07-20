#include "WebBridge.h"

#include <QClipboard>
#include <QGuiApplication>
#include <QImage>
#include <QBuffer>
#include <QByteArray>
#include <QMimeData>
#include <QUrl>

WebBridge::WebBridge(QObject *parent)
    : QObject(parent)
{
}

void WebBridge::setZoom(double delta) {
    emit zoomRequested(delta);
}

void WebBridge::toggleFullscreen() {
    emit fullscreenRequested();
}

void WebBridge::toggleDevTools() {
    emit devToolsRequested();
}

void WebBridge::setWindowTitle(const QString &title) {
    emit windowTitleChangeRequested(title);
}

void WebBridge::setBadgeCount(int count) {
    emit badgeCountRequested(count);
}

bool WebBridge::isMuted() {
    // This is queried from JS; the actual state is in MainWindow
    return false; // MainWindow overrides via signal
}

bool WebBridge::toggleMute() {
    // MainWindow handles the actual toggle
    emit muteToggled(true); // placeholder; MainWindow manages state
    return true;
}

void WebBridge::openExternal(const QString &url) {
    emit openExternalRequested(url);
}

void WebBridge::reportPresence(const QString &jsonPayload) {
    emit presenceReported(jsonPayload);
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

    // Convert to RGBA format
    img = img.convertToFormat(QImage::Format_RGBA8888);

    // Encode as base64
    QByteArray byteArray(reinterpret_cast<const char *>(img.bits()),
                         img.sizeInBytes());
    QByteArray base64 = byteArray.toBase64();

    result["rgba"] = QString::fromLatin1(base64);
    result["width"] = img.width();
    result["height"] = img.height();
    return result;
}
