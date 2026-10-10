#pragma once

#include <QWebEnginePage>
#include <QWebEngineProfile>
#include <QUrl>

// Main page: keeps the app (and the Serika sign-in flow) in the window and
// sends every other link to the default browser.
class SerikaWebPage : public QWebEnginePage {
    Q_OBJECT
public:
    explicit SerikaWebPage(QWebEngineProfile *profile, QObject *parent = nullptr);

signals:
    // An in-app link opened with target=_blank / window.open (route it in the
    // existing window instead of spawning another).
    void inAppLinkRequested(const QUrl &url);

protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override;
    QWebEnginePage *createWindow(WebWindowType type) override;
};

// Throwaway page handed to window.open()/target=_blank: it catches the first
// URL it is asked to load, forwards it, and deletes itself.
class PopupCatcherPage : public QWebEnginePage {
    Q_OBJECT
public:
    explicit PopupCatcherPage(QWebEngineProfile *profile, SerikaWebPage *owner);

protected:
    bool acceptNavigationRequest(const QUrl &url, NavigationType type, bool isMainFrame) override;

private:
    SerikaWebPage *m_owner;
    bool m_handled{false};
};

// Opens a URL in the OS default handler when it's a safe scheme.
bool openExternally(const QUrl &url);
