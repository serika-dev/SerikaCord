#include "AppConfig.h"

#include <QtGlobal>

namespace {
QString normalized(QString u) {
    u = u.trimmed();
    while (u.endsWith('/')) u.chop(1);
    return u;
}

bool isHttpUrl(const QUrl &u) {
    return u.isValid() && !u.host().isEmpty()
        && (u.scheme() == QLatin1String("https") || u.scheme() == QLatin1String("http"));
}

QString &appUrlStorage() {
    static QString url = [] {
        const QString env = normalized(qEnvironmentVariable("SERIKA_APP_URL"));
        return isHttpUrl(QUrl(env)) ? env : QStringLiteral("https://serika.chat");
    }();
    return url;
}

bool isLocalHost(const QString &host) {
    return host == QLatin1String("localhost") || host == QLatin1String("127.0.0.1")
        || host == QLatin1String("::1") || host.endsWith(QLatin1String(".localhost"));
}
} // namespace

namespace SerikaConfig {

QString appUrl() {
    return appUrlStorage();
}

void setAppUrl(const QString &url) {
    const QString u = normalized(url);
    if (isHttpUrl(QUrl(u))) appUrlStorage() = u;
}

bool isAppUrl(const QUrl &url) {
    if (!isHttpUrl(url)) return false;
    const QString host = url.host().toLower();
    const QUrl app(appUrl());
    if (host == app.host().toLower() && url.port(-1) == app.port(-1)
        && url.scheme() == app.scheme()) {
        return true;
    }
    if (url.scheme() == QLatin1String("https")
        && (host == QLatin1String("serika.chat") || host.endsWith(QLatin1String(".serika.chat")))) {
        return true;
    }
    return isLocalHost(host);
}

bool isInAppNavigation(const QUrl &url) {
    if (isAppUrl(url)) return true;
    if (url.scheme() != QLatin1String("https")) return false;
    const QString host = url.host().toLower();
    // Serika account sign-in, and the legacy host the app used to live on.
    return host == QLatin1String("accounts.serika.dev") || host == QLatin1String("waifu.ws");
}

} // namespace SerikaConfig
