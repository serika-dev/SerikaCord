#include "SerikaWebPage.h"
#include "AppConfig.h"

#include <QDesktopServices>
#include <QTimer>

bool openExternally(const QUrl &url) {
    const QString scheme = url.scheme().toLower();
    // Never hand file:, javascript:, data: or custom schemes from web content to the OS.
    if (scheme != QLatin1String("https") && scheme != QLatin1String("http")
        && scheme != QLatin1String("mailto")) {
        return false;
    }
    return QDesktopServices::openUrl(url);
}

SerikaWebPage::SerikaWebPage(QWebEngineProfile *profile, QObject *parent)
    : QWebEnginePage(profile, parent)
{
}

bool SerikaWebPage::acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) {
    if (!isMainFrame) return true;
    if (url.scheme() == QLatin1String("about") || url.scheme() == QLatin1String("data")
        || url.scheme() == QLatin1String("blob")) {
        return true;
    }
    if (SerikaConfig::isInAppNavigation(url)) return true;

    // A user clicked/typed a link that leaves the app: open it in the browser.
    if (type == NavigationTypeLinkClicked || type == NavigationTypeTyped
        || type == NavigationTypeFormSubmitted) {
        openExternally(url);
        return false;
    }
    // Redirects and script navigations (e.g. OAuth hops) stay in the window.
    return true;
}

QWebEnginePage *SerikaWebPage::createWindow(WebWindowType type) {
    Q_UNUSED(type)
    return new PopupCatcherPage(profile(), this);
}

PopupCatcherPage::PopupCatcherPage(QWebEngineProfile *profile, SerikaWebPage *owner)
    : QWebEnginePage(profile, owner)
    , m_owner(owner)
{
    // A popup that never navigates (window.open() with no URL) is dropped.
    QTimer::singleShot(10000, this, &QObject::deleteLater);
}

bool PopupCatcherPage::acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) {
    Q_UNUSED(type)
    if (!isMainFrame) return false;
    if (url.isEmpty() || url.scheme() == QLatin1String("about")) return true;
    if (!m_handled) {
        m_handled = true;
        if (SerikaConfig::isAppUrl(url)) emit m_owner->inAppLinkRequested(url);
        else openExternally(url);
        deleteLater();
    }
    return false;
}
