#pragma once

#include <QString>
#include <QUrl>

// App-wide constants and URL policy for the shell.
namespace SerikaConfig {
    // Hosted app the shell loads. Overridable for development with
    // `--app-url http://localhost:3000` or the SERIKA_APP_URL env var.
    QString appUrl();
    void setAppUrl(const QString &url);

    inline constexpr const char *START_PATH = "/channels/me";
    inline constexpr const char *GITHUB_RELEASES = "https://github.com/serika-dev/SerikaCord/releases";

    // Same origin as the hosted app, a *.serika.chat host, or a local dev
    // server: these load inside the window and get the app's permissions.
    bool isAppUrl(const QUrl &url);

    // Pages the main frame may navigate to without being bounced to the
    // browser (the app itself plus the Serika account sign-in flow).
    bool isInAppNavigation(const QUrl &url);
}
