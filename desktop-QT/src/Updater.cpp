#include "Updater.h"

#include <QNetworkRequest>
#include <QNetworkReply>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonValue>
#include <QUrl>
#include <QFile>
#include <QDir>
#include <QStandardPaths>
#include <QSysInfo>
#include <QDesktopServices>
#include <QDebug>

#include <openssl/evp.h>

// The GitHub "latest" release manifest — same URL the Tauri updater used.
static const char *MANIFEST_URL =
    "https://github.com/serika-dev/SerikaCord/releases/latest/download/latest.json";

// The Tauri minisign public key (base64 of the minisign public-key file),
// copied verbatim from desktop-tauri/src-tauri/tauri.conf.json. Updates must be
// signed by the matching private key or they are refused.
static const char *MINISIGN_PUBKEY_B64 =
    "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IENDOUI5NTNCMEMzRkJDQQpSV1RLKzhPd1U3bkpERUZiRzQwQk9QV1VENnN6SkgyOUxPVTFSWExra3VGUmlFcWtKZGVHc0oxUgo=";

Updater::Updater(QString currentVersion, QObject *parent)
    : QObject(parent)
    , m_currentVersion(std::move(currentVersion))
{
}

QString Updater::platformKey() {
    // Mirrors Tauri's updater target naming: <os>-<arch>.
    const QString arch = QSysInfo::currentCpuArchitecture(); // "x86_64", "arm64", …
    QString normArch = arch;
    if (arch == "arm64") normArch = "aarch64";

#if defined(Q_OS_WIN)
    return QStringLiteral("windows-%1").arg(normArch);
#elif defined(Q_OS_MACOS)
    return QStringLiteral("darwin-%1").arg(normArch);
#else
    return QStringLiteral("linux-%1").arg(normArch);
#endif
}

bool Updater::isNewer(const QString &remote, const QString &local) {
    // Compare dotted numeric versions component-by-component, ignoring any
    // leading 'v' and pre-release suffixes.
    auto normalize = [](QString v) {
        v = v.trimmed();
        if (v.startsWith('v') || v.startsWith('V')) v.remove(0, 1);
        // Drop build/pre-release metadata (e.g. "1.2.3-beta.1" → "1.2.3").
        const int dash = v.indexOf('-');
        if (dash >= 0) v = v.left(dash);
        return v;
    };
    const QStringList r = normalize(remote).split('.');
    const QStringList l = normalize(local).split('.');
    const int n = qMax(r.size(), l.size());
    for (int i = 0; i < n; ++i) {
        const int rv = i < r.size() ? r[i].toInt() : 0;
        const int lv = i < l.size() ? l[i].toInt() : 0;
        if (rv != lv) return rv > lv;
    }
    return false;
}

void Updater::checkForUpdates() {
    emit indeterminate(QStringLiteral("Checking for updates…"));

    QNetworkRequest req((QUrl(QString::fromLatin1(MANIFEST_URL))));
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setHeader(QNetworkRequest::UserAgentHeader, "SerikaCord-Updater");
    m_reply = m_net.get(req);
    connect(m_reply, &QNetworkReply::finished, this, &Updater::onManifestFinished);
}

void Updater::onManifestFinished() {
    QNetworkReply *reply = m_reply;
    m_reply = nullptr;
    if (!reply) { emit noUpdate(); return; }
    reply->deleteLater();

    if (reply->error() != QNetworkReply::NoError) {
        // Offline or no release published — just launch.
        emit noUpdate();
        return;
    }

    const QByteArray body = reply->readAll();
    const QJsonDocument doc = QJsonDocument::fromJson(body);
    if (!doc.isObject()) { emit noUpdate(); return; }
    const QJsonObject root = doc.object();

    const QString remoteVersion = root.value("version").toString();
    if (remoteVersion.isEmpty() || !isNewer(remoteVersion, m_currentVersion)) {
        emit noUpdate();
        return;
    }

    // Find the artifact for this platform.
    const QJsonObject platforms = root.value("platforms").toObject();
    const QString key = platformKey();
    QJsonObject target = platforms.value(key).toObject();
    if (target.isEmpty()) {
        // No build for this platform — nothing we can do automatically.
        emit noUpdate();
        return;
    }

    const QString url = target.value("url").toString();
    if (url.isEmpty()) { emit noUpdate(); return; }

    // A signature is mandatory — refuse unsigned updates.
    m_pendingSignature = target.value("signature").toString();
    if (m_pendingSignature.isEmpty()) {
        qWarning() << "[Updater] Release has no signature — refusing update.";
        emit noUpdate();
        return;
    }

    m_newVersion = remoteVersion;

    // Download the artifact to a temp file, preserving its extension so the OS
    // knows how to open/install it (.AppImage/.deb/.msi/.exe/.dmg).
    QString ext;
    const int dot = QUrl(url).fileName().lastIndexOf('.');
    if (dot >= 0) ext = QUrl(url).fileName().mid(dot);
    QString tmpDir = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    if (tmpDir.isEmpty()) tmpDir = QDir::tempPath();
    m_downloadPath = QDir(tmpDir).filePath(
        QStringLiteral("SerikaCord-%1%2").arg(remoteVersion, ext));

    emit progressChanged(QStringLiteral("Downloading update %1…").arg(remoteVersion), 0);

    QNetworkRequest req((QUrl(url)));
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,
                     QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setHeader(QNetworkRequest::UserAgentHeader, "SerikaCord-Updater");
    m_reply = m_net.get(req);
    connect(m_reply, &QNetworkReply::downloadProgress, this,
            [this](qint64 received, qint64 total) {
        if (total > 0) {
            const int pct = static_cast<int>((received * 100) / total);
            emit progressChanged(
                QStringLiteral("Downloading update %1…").arg(m_newVersion), pct);
        }
    });
    connect(m_reply, &QNetworkReply::finished, this, &Updater::onDownloadFinished);
}

void Updater::onDownloadFinished() {
    QNetworkReply *reply = m_reply;
    m_reply = nullptr;
    if (!reply) { emit noUpdate(); return; }
    reply->deleteLater();

    if (reply->error() != QNetworkReply::NoError) {
        emit noUpdate();
        return;
    }

    QFile file(m_downloadPath);
    if (!file.open(QIODevice::WriteOnly)) { emit noUpdate(); return; }
    file.write(reply->readAll());
    file.close();

    // Verify the minisign signature before we ever hand the file to the OS.
    // A tampered or corrupt download is discarded and we just start the app.
    if (!verifySignature(m_downloadPath, m_pendingSignature)) {
        qWarning() << "[Updater] Signature verification FAILED — discarding update.";
        QFile::remove(m_downloadPath);
        emit noUpdate();
        return;
    }

    // Make Linux AppImages executable so they can be launched directly.
#ifdef Q_OS_LINUX
    if (m_downloadPath.endsWith(".AppImage", Qt::CaseInsensitive)) {
        file.setPermissions(file.permissions() | QFileDevice::ExeOwner |
                            QFileDevice::ExeGroup | QFileDevice::ExeOther);
    }
#endif

    emit progressChanged(QStringLiteral("Update ready"), 100);
    emit readyToInstall(m_downloadPath, m_newVersion);
}

// ── Minisign verification ────────────────────────────────────────────────────
// Minisign key/signature wire format (all base64-decoded):
//   public key file : line 2 = base64( "Ed"      | keyId[8] | pubkey[32] )
//   signature file  : line 2 = base64( algo[2]   | keyId[8] | sig[64]    )
// algo == "Ed" → signature is over the raw file bytes.
// algo == "ED" → signature is over BLAKE2b-512(file) (Tauri's prehashed mode).
bool Updater::verifySignature(const QString &filePath, const QString &signatureB64) {
    // 1. Decode the bundled public key.
    const QByteArray pubFile =
        QByteArray::fromBase64(QByteArray(MINISIGN_PUBKEY_B64));
    const QList<QByteArray> pubLines = pubFile.split('\n');
    if (pubLines.size() < 2) return false;
    const QByteArray pubBlob = QByteArray::fromBase64(pubLines[1].trimmed());
    if (pubBlob.size() != 42) return false;                 // 2 + 8 + 32
    const QByteArray pubKeyId = pubBlob.mid(2, 8);
    const unsigned char *pubKey =
        reinterpret_cast<const unsigned char *>(pubBlob.constData() + 10);

    // 2. Decode the signature blob (Tauri stores the whole .sig file, base64'd).
    const QByteArray sigFile = QByteArray::fromBase64(signatureB64.toLatin1());
    const QList<QByteArray> sigLines = sigFile.split('\n');
    if (sigLines.size() < 2) return false;
    const QByteArray sigBlob = QByteArray::fromBase64(sigLines[1].trimmed());
    if (sigBlob.size() != 74) return false;                 // 2 + 8 + 64
    const QByteArray algo = sigBlob.mid(0, 2);
    const QByteArray sigKeyId = sigBlob.mid(2, 8);
    const unsigned char *sig =
        reinterpret_cast<const unsigned char *>(sigBlob.constData() + 10);

    // Key id must match the key that signed it.
    if (sigKeyId != pubKeyId) return false;

    // 3. Read the downloaded artifact.
    QFile f(filePath);
    if (!f.open(QIODevice::ReadOnly)) return false;
    const QByteArray fileData = f.readAll();
    f.close();

    // 4. Build the message that was signed.
    QByteArray message;
    if (algo == QByteArray("ED")) {
        unsigned char hash[64];
        unsigned int hlen = 0;
        if (EVP_Digest(fileData.constData(), fileData.size(), hash, &hlen,
                       EVP_blake2b512(), nullptr) != 1 || hlen != 64) {
            return false;
        }
        message = QByteArray(reinterpret_cast<char *>(hash), 64);
    } else if (algo == QByteArray("Ed")) {
        message = fileData;                                 // legacy: raw file
    } else {
        return false;                                       // unknown algorithm
    }

    // 5. Verify the Ed25519 signature (one-shot; Ed25519 uses no separate MD).
    EVP_PKEY *pkey = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr,
                                                 pubKey, 32);
    if (!pkey) return false;
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    bool ok = false;
    if (ctx && EVP_DigestVerifyInit(ctx, nullptr, nullptr, nullptr, pkey) == 1) {
        ok = EVP_DigestVerify(
                 ctx, sig, 64,
                 reinterpret_cast<const unsigned char *>(message.constData()),
                 message.size()) == 1;
    }
    if (ctx) EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return ok;
}
