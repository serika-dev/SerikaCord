#include "DeepLinkHandler.h"

#include <QUrl>
#include <QUrlQuery>
#include <QDebug>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

DeepLinkHandler::DeepLinkHandler(QObject *parent)
    : QObject(parent)
{
}

void DeepLinkHandler::registerScheme() {
    // On Windows, register the serikacord:// protocol in the registry
#ifdef Q_OS_WIN
    HKEY hKey;
    QString appPath = QCoreApplication::applicationFilePath().replace('/', '\\');
    QString command = QString("\"%1\" \"%2\"").arg(appPath, "%1");
    QString key = "HKEY_CURRENT_USER\\Software\\Classes\\serikacord";
    LONG result = RegCreateKeyExA(HKEY_CURRENT_USER,
        "Software\\Classes\\serikacord", 0, nullptr, 0,
        KEY_WRITE, nullptr, &hKey, nullptr);
    if (result == ERROR_SUCCESS) {
        RegSetValueExA(hKey, nullptr, 0, REG_SZ,
            (const BYTE *)"SerikaCord", 11);
        RegSetValueExA(hKey, "URL Protocol", 0, REG_SZ,
            (const BYTE *)"", 1);

        HKEY hCmdKey;
        RegCreateKeyExA(hKey, "shell\\open\\command", 0, nullptr, 0,
            KEY_WRITE, nullptr, &hCmdKey, nullptr);
        QByteArray cmd = command.toUtf8();
        RegSetValueExA(hCmdKey, nullptr, 0, REG_SZ,
            (const BYTE *)cmd.constData(), cmd.length() + 1);
        RegCloseKey(hCmdKey);
        RegCloseKey(hKey);
    }
#endif

    // On macOS, the scheme is registered via Info.plist (CFBundleURLTypes)
    // On Linux, via .desktop file MimeType=x-scheme-handler/serikacord
}

void DeepLinkHandler::handleLink(const QString &link) {
    QString path = normalizeLink(link);
    if (!path.isEmpty()) {
        emit deepLinkReceived(path);
    }
}

QString DeepLinkHandler::normalizeLink(const QString &link) {
    QUrl url(link);
    if (url.scheme() == "serikacord") {
        // serikacord://channels/123 → /channels/123
        QString path = url.path();
        if (url.host().isEmpty()) {
            // serikacord://channels/123
            return path;
        } else {
            // serikacord://server/abc → /server/abc
            return "/" + url.host() + path;
        }
    }
    return link;
}
