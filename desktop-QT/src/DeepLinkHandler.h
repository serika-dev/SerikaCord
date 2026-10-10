#pragma once

#include <QObject>
#include <QString>

// serika:// (and the older serikacord://) links: invites, channels, DMs.
//   serika://invite/abc123          -> /invite/abc123
//   serika://channels/<server>/<ch> -> /channels/<server>/<ch>
//   serika://dm/<userId>            -> /dm/<userId>
//   https://serika.chat/...         -> same path (links passed on the command line)
class DeepLinkHandler : public QObject {
    Q_OBJECT

public:
    explicit DeepLinkHandler(QObject *parent = nullptr);
    ~DeepLinkHandler() override = default;

    // Register the URL schemes with the OS for this user (Windows registry,
    // a user .desktop entry on Linux; macOS uses Info.plist).
    void registerScheme();
    // Returns true if the link was recognised (and emitted).
    bool handleLink(const QString &link);

    static bool isDeepLink(const QString &arg);
    // In-app path for a link, or an empty string if it isn't one we route.
    static QString normalizeLink(const QString &link);

signals:
    void deepLinkReceived(const QString &path);
};
