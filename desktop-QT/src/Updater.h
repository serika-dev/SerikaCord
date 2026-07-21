#pragma once

#include <QObject>
#include <QString>
#include <QNetworkAccessManager>

class QNetworkReply;

// ── Auto-updater (Tauri parity) ──────────────────────────────────────────────
// Checks the GitHub releases `latest.json` (the same manifest the Tauri client
// consumed), compares versions, and — if a newer build exists for this
// platform — downloads the artifact with progress and hands it to the OS to
// install. If anything fails or no update is available, it emits noUpdate() so
// the app can start normally. Network failures never block launch.
class Updater : public QObject {
    Q_OBJECT

public:
    explicit Updater(QString currentVersion, QObject *parent = nullptr);

    // Kick off the check. Emits exactly one terminal signal:
    // noUpdate() OR readyToInstall() OR (on any error) noUpdate().
    void checkForUpdates();

signals:
    // Progress passthrough for the splash window.
    void statusChanged(const QString &message);
    void progressChanged(const QString &message, int percent);
    void indeterminate(const QString &message);

    // No update (up to date, or check/download failed) — start the app.
    void noUpdate();
    // Update downloaded to `installerPath`; caller should install + quit.
    void readyToInstall(const QString &installerPath, const QString &newVersion);

private slots:
    void onManifestFinished();
    void onDownloadFinished();

private:
    // Returns the platform key used in latest.json (e.g. "linux-x86_64").
    static QString platformKey();
    // Semantic-ish version compare: returns true if `remote` > `local`.
    static bool isNewer(const QString &remote, const QString &local);
    // Verify a downloaded file against a minisign signature (the base64 blob
    // Tauri stores in latest.json's per-platform `signature` field) using the
    // bundled Ed25519 public key. Returns true only on a valid signature.
    static bool verifySignature(const QString &filePath, const QString &signatureB64);

    QString m_currentVersion;
    QString m_newVersion;
    QString m_downloadPath;
    QString m_pendingSignature;
    QNetworkAccessManager m_net;
    QNetworkReply *m_reply{nullptr};
};
