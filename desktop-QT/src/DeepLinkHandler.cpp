#include "DeepLinkHandler.h"
#include "AppConfig.h"
#include "AutoStart.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QProcess>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QUrl>

namespace {
const char *const SCHEMES[] = {"serika", "serikacord"};
// First path segments we route into the app.
const char *const ALLOWED_ROOTS[] = {"invite", "channels", "dm", "qr"};

QString stripScheme(const QString &link, QString *schemeOut) {
    for (const char *scheme : SCHEMES) {
        const QString prefix = QString::fromLatin1(scheme) + QStringLiteral("://");
        if (link.startsWith(prefix, Qt::CaseInsensitive)) {
            if (schemeOut) *schemeOut = QString::fromLatin1(scheme);
            return link.mid(prefix.size());
        }
        const QString shortPrefix = QString::fromLatin1(scheme) + QStringLiteral(":");
        if (link.startsWith(shortPrefix, Qt::CaseInsensitive)) {
            if (schemeOut) *schemeOut = QString::fromLatin1(scheme);
            return link.mid(shortPrefix.size());
        }
    }
    return {};
}

bool safePath(const QString &path) {
    static const QRegularExpression allowed(QStringLiteral("^/[A-Za-z0-9_\\-@.~/%]*(\\?[A-Za-z0-9_\\-@.~%=&+]*)?$"));
    if (!allowed.match(path).hasMatch()) return false;
    if (path.contains(QLatin1String("..")) || path.contains(QLatin1String("//"))) return false;
    const QString root = path.mid(1).section('/', 0, 0).section('?', 0, 0);
    for (const char *r : ALLOWED_ROOTS) {
        if (root == QLatin1String(r)) return true;
    }
    return false;
}
} // namespace

DeepLinkHandler::DeepLinkHandler(QObject *parent)
    : QObject(parent)
{
}

bool DeepLinkHandler::isDeepLink(const QString &arg) {
    if (!stripScheme(arg, nullptr).isNull()) return true;
    const QUrl url(arg);
    return url.scheme().startsWith(QLatin1String("http")) && SerikaConfig::isAppUrl(url);
}

QString DeepLinkHandler::normalizeLink(const QString &link) {
    const QString trimmed = link.trimmed();
    QString path;
    const QString rest = stripScheme(trimmed, nullptr);
    if (!rest.isNull()) {
        // serika://invite/abc  or  serika:///invite/abc
        QString r = rest;
        while (r.startsWith('/')) r.remove(0, 1);
        r = r.section('#', 0, 0);
        while (r.endsWith('/')) r.chop(1);
        path = QStringLiteral("/") + r;
    } else {
        const QUrl url(trimmed);
        if (!url.isValid() || !SerikaConfig::isAppUrl(url)) return {};
        path = url.path(QUrl::FullyEncoded);
        if (url.hasQuery()) path += '?' + url.query(QUrl::FullyEncoded);
    }
    return safePath(path) ? path : QString();
}

bool DeepLinkHandler::handleLink(const QString &link) {
    const QString path = normalizeLink(link);
    if (path.isEmpty()) return false;
    emit deepLinkReceived(path);
    return true;
}

void DeepLinkHandler::registerScheme() {
#if defined(Q_OS_WIN)
    const QString exe = QDir::toNativeSeparators(QCoreApplication::applicationFilePath());
    for (const char *scheme : SCHEMES) {
        QSettings reg(QStringLiteral("HKEY_CURRENT_USER\\Software\\Classes\\%1").arg(QLatin1String(scheme)),
                      QSettings::NativeFormat);
        reg.setValue(QStringLiteral("Default"), QStringLiteral("URL:SerikaCord"));
        reg.setValue(QStringLiteral("URL Protocol"), QString());
        reg.setValue(QStringLiteral("DefaultIcon/Default"), QStringLiteral("\"%1\",0").arg(exe));
        reg.setValue(QStringLiteral("shell/open/command/Default"), QStringLiteral("\"%1\" \"%2\"").arg(exe, QStringLiteral("%1")));
    }
#elif defined(Q_OS_LINUX)
    // Packages (.deb) install /usr/share/applications/serikacord.desktop with
    // the MimeType entries. An AppImage has no installer, so it writes a
    // per-user entry pointing at itself (dev builds leave the system alone).
    if (qEnvironmentVariable("APPIMAGE").isEmpty()) return;
    QString dataHome = qEnvironmentVariable("XDG_DATA_HOME");
    if (dataHome.isEmpty()) dataHome = QDir::homePath() + QStringLiteral("/.local/share");
    const QString path = dataHome + QStringLiteral("/applications/serikacord.desktop");
    QString exec = AutoStart::launchPath();
    exec.replace('"', QLatin1String("\\\""));
    const QString content = QStringLiteral(
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=SerikaCord\n"
        "Comment=Chat with friends and communities\n"
        "Exec=\"%1\" %u\n"
        "Icon=serikacord\n"
        "Terminal=false\n"
        "Categories=Network;InstantMessaging;\n"
        "MimeType=x-scheme-handler/serika;x-scheme-handler/serikacord;\n"
        "StartupWMClass=SerikaCord\n").arg(exec);
    QFile existing(path);
    if (existing.open(QIODevice::ReadOnly) && QString::fromUtf8(existing.readAll()) == content) return;
    existing.close();
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Text)) return;
    f.write(content.toUtf8());
    if (!f.commit()) return;
    for (const char *scheme : SCHEMES) {
        QProcess::startDetached(QStringLiteral("xdg-mime"),
            {QStringLiteral("default"), QStringLiteral("serikacord.desktop"),
             QStringLiteral("x-scheme-handler/%1").arg(QLatin1String(scheme))});
    }
#endif
    // macOS: CFBundleURLTypes in Info.plist; links arrive as QFileOpenEvent.
}
