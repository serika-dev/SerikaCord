#pragma once

#include <QWebEnginePage>
#include <QWebEngineUrlRequestInterceptor>
#include <QWebEngineProfile>
#include <QDesktopServices>
#include <QUrl>
#include <QWebEngineUrlRequestInfo>

// Intercepts navigation requests: external URLs are opened in the browser
// instead of navigating the webview to them.
class NavigationInterceptor : public QWebEngineUrlRequestInterceptor {
    Q_OBJECT
public:
    explicit NavigationInterceptor(const QString &allowedPrefix, QObject *parent = nullptr)
        : QWebEngineUrlRequestInterceptor(parent), m_allowedPrefix(allowedPrefix) {}

    void interceptRequest(QWebEngineUrlRequestInfo &info) override {
        QUrl url = info.requestUrl();
        QString urlStr = url.toString();

        if (urlStr.startsWith(m_allowedPrefix, Qt::CaseInsensitive) ||
            urlStr.startsWith("http://localhost", Qt::CaseInsensitive)) {
            return;
        }

        if (info.navigationType() == QWebEngineUrlRequestInfo::NavigationTypeLink ||
            info.navigationType() == QWebEngineUrlRequestInfo::NavigationTypeTyped) {
            QDesktopServices::openUrl(url);
            info.block(true);
        }
    }

private:
    QString m_allowedPrefix;
};

// Custom web page that handles external navigation by opening links in browser.
class SerikaWebPage : public QWebEnginePage {
    Q_OBJECT
public:
    explicit SerikaWebPage(QWebEngineProfile *profile, QObject *parent = nullptr)
        : QWebEnginePage(profile, parent) {}

protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type,
                                  bool isMainFrame) override {
        if (!isMainFrame) return true;

        QString urlStr = url.toString();
        if (urlStr.startsWith("https://serika.chat", Qt::CaseInsensitive) ||
            urlStr.startsWith("http://localhost", Qt::CaseInsensitive) ||
            urlStr.startsWith("https://waifu.ws", Qt::CaseInsensitive)) {
            return true;
        }

        if (type == QWebEnginePage::NavigationTypeLinkClicked ||
            type == QWebEnginePage::NavigationTypeTyped) {
            QDesktopServices::openUrl(url);
            return false;
        }

        return true;
    }

    QWebEnginePage *createWindow(WebWindowType) override {
        // Let acceptNavigationRequest handle it
        return this;
    }
};
