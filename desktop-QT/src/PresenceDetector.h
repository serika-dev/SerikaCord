#pragma once

#include <QObject>
#include <QTimer>
#include <QHash>
#include <QSet>
#include <QString>
#include <QStringList>
#include <QVector>
#include <QJsonObject>
#include <QJsonArray>
#include <QProcessEnvironment>
#include <optional>

struct DetectedActivity {
    QString kind;       // "game" | "vscode" | "music" | "other"
    QString name;       // human-readable name
    QString exe;        // matched executable basename
    QString steamAppId; // Steam AppId if applicable

    QJsonObject toJson() const {
        QJsonObject obj;
        obj["kind"] = kind;
        obj["name"] = name;
        obj["exe"] = exe;
        if (!steamAppId.isEmpty())
            obj["steamAppId"] = steamAppId;
        return obj;
    }

    bool operator==(const DetectedActivity &o) const {
        return kind == o.kind && name == o.name && exe == o.exe && steamAppId == o.steamAppId;
    }
};

class PresenceDetector : public QObject {
    Q_OBJECT

public:
    explicit PresenceDetector(QObject *parent = nullptr);
    ~PresenceDetector() override = default;

    void start();
    void stop();

signals:
    void activitiesDetected(const QJsonArray &activities);

private slots:
    void onTimeout();

private:
    QVector<DetectedActivity> detect();
    QHash<QString, QString> buildSteamAppMap();
    QStringList steamLibraryDirs();
    QStringList steamRoots();
    QStringList getProcessNames();
    QStringList getProcessCmdlines();
    QHash<QString, QStringList> getProcessEnvironments();

    QTimer *m_timer;
    QHash<QString, QString> m_steamCache;
    qint64 m_steamCacheTime{0};
    QVector<DetectedActivity> m_lastActivities;

    // Platform-specific process info
    struct ProcessInfo {
        QString name;
        QString exePath;
        QStringList cmdline;
        QStringList environ;
    };
    QVector<ProcessInfo> enumerateProcesses();
};
