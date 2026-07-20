#include "PresenceDetector.h"

#include <QDir>
#include <QFile>
#include <QTextStream>
#include <QFileInfo>
#include <QProcess>
#include <QProcessEnvironment>
#include <QDateTime>
#include <QElapsedTimer>
#include <QDebug>
#include <QJsonArray>
#include <QJsonDocument>
#include <optional>

// ── Platform-specific includes ───────────────────────────────────────────────

#ifdef Q_OS_LINUX
#include <QDir>
#include <QFile>
#include <QTextStream>
#endif

#ifdef Q_OS_WIN
#include <windows.h>
#include <psapi.h>
#include <tlhelp32.h>
#pragma comment(lib, "psapi.lib")
#endif

#ifdef Q_OS_MACOS
#include <libproc.h>
#include <sys/sysctl.h>
#include <unistd.h>
#endif

// ── Known app table ──────────────────────────────────────────────────────────

struct KnownApp {
    QStringList exeNames;
    QString displayName;
    QString kind;
};

static const QVector<KnownApp> KNOWN_APPS = {
    {{"code", "code-oss", "vscodium"}, "Visual Studio Code", "vscode"},
    {{"code-insiders"}, "VS Code Insiders", "vscode"},
    {{"rider64", "rider"}, "JetBrains Rider", "vscode"},
    {{"idea64", "idea"}, "IntelliJ IDEA", "vscode"},
    {{"pycharm64", "pycharm"}, "PyCharm", "vscode"},
    {{"webstorm64", "webstorm"}, "WebStorm", "vscode"},
    {{"clion64", "clion"}, "CLion", "vscode"},
    {{"windsurf"}, "Windsurf", "windsurf"},
    {{"devin", "devin-desktop", "devindesktop"}, "Devin Desktop", "devin"},
    {{"cursor"}, "Cursor", "cursor"},
    {{"zed"}, "Zed", "zed"},
    {{"claude"}, "Claude Code", "claude"},
    {{"sublime_text"}, "Sublime Text", "other"},
    {{"blender"}, "Blender", "other"},
    {{"obs", "obs64"}, "OBS Studio", "other"},
    {{"photoshop"}, "Adobe Photoshop", "other"},
    {{"figma", "figma_agent"}, "Figma", "other"},
    {{"unity", "unityhub"}, "Unity", "other"},
    {{"unrealeditor"}, "Unreal Engine", "other"},
    {{"godot"}, "Godot Engine", "other"},
};

// ── Known game table ─────────────────────────────────────────────────────────

struct KnownGame {
    QString needle;
    QString displayName;
    bool substring;
};

static const QVector<KnownGame> KNOWN_GAMES = {
    {"hades", "Hades", false},
    {"hades2", "Hades II", false},
    {"hollow_knight", "Hollow Knight", true},
    {"hollowknight", "Hollow Knight", true},
    {"hk_x64", "Hollow Knight", false},
    {"stardew", "Stardew Valley", true},
    {"stardewvalley", "Stardew Valley", true},
    {"factorio", "Factorio", true},
    {"terraria", "Terraria", true},
    {"re8", "Resident Evil Village", false},
    {"eldenring", "Elden Ring", true},
    {"cyberpunk2077", "Cyberpunk 2077", true},
    {"witcher3", "The Witcher 3: Wild Hunt", true},
    {"cs2", "Counter-Strike 2", false},
    {"valorant", "VALORANT", true},
    {"leagueclient", "League of Legends", true},
    {"league of legends", "League of Legends", true},
    {"dota2", "Dota 2", true},
    {"gta5", "Grand Theft Auto V", false},
    {"gtav", "Grand Theft Auto V", false},
    {"minecraft", "Minecraft", true},
    {"javaw", "Minecraft", false},
    {"celeste", "Celeste", true},
    {"balatro", "Balatro", true},
    {"deadcells", "Dead Cells", true},
    {"hoyoverse", "Genshin Impact", true},
    {"genshinimpact", "Genshin Impact", true},
    {"starrail", "Honkai: Star Rail", true},
    {"bluearchive", "Blue Archive", true},
    {"blue archive", "Blue Archive", true},
};

// ── Wine/Steam system processes to ignore ────────────────────────────────────

static const QSet<QString> WINE_SYSTEM_PROCESSES = {
    "services", "winedevice", "plugplay", "explorer", "rpcss", "svchost",
    "conhost", "wineboot", "start", "cmd", "rundll32", "tabtip",
    "steamwebhelper", "gameoverlayui", "steamerrorreporter", "steam",
    "steamservice", "crashhandler", "reaper", "pv", "srt-bwrap",
    "proton", "python3", "python", "wine", "wine64", "wineserver",
    "wineconsole", "regedit", "msiexec", "iexplore", "dllhost",
    "vulkaninfo", "nvidia-smi", "gldriverquery", "vrcompositor",
    "steamtours", "originwebhelperservice", "easyanticheat", "battleye",
    "beservice", "ubisoftgamelauncher", "upc", "eabackgroundservice",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

static QString basenameStem(const QString &s) {
    QString base = s;
    int lastSlash = base.lastIndexOf('/');
    int lastBackslash = base.lastIndexOf('\\');
    int idx = qMax(lastSlash, lastBackslash);
    if (idx >= 0) base = base.mid(idx + 1);
    base = base.toLower();
    if (base.endsWith(".exe")) base.chop(4);
    return base;
}

static std::optional<DetectedActivity> matchKnownApp(const QString &exeLower) {
    for (const auto &app : KNOWN_APPS) {
        for (const auto &name : app.exeNames) {
            if (exeLower == name.toLower()) {
                return DetectedActivity{
                    app.kind, app.displayName, exeLower, ""
                };
            }
        }
    }
    return std::nullopt;
}

static std::optional<DetectedActivity> matchKnownGame(const QString &exeLower) {
    for (const auto &game : KNOWN_GAMES) {
        bool hit = game.substring
            ? exeLower.contains(game.needle)
            : exeLower == game.needle;
        if (hit) {
            return DetectedActivity{
                "game", game.displayName, exeLower, ""
            };
        }
    }
    return std::nullopt;
}

static bool isWineSystemProcess(const QString &exeLower) {
    return WINE_SYSTEM_PROCESSES.contains(exeLower);
}

static QString steamAppIdFromEnv(const QStringList &env, const QStringList &cmd) {
    static const QVector<QString> prefixes = {
        "SteamAppId=", "SteamGameId=", "STEAM_COMPAT_APP_ID="
    };
    for (const auto &var : env) {
        for (const auto &prefix : prefixes) {
            if (var.startsWith(prefix)) {
                QString id = var.mid(prefix.length());
                if (!id.isEmpty() && id != "0")
                    return id;
            }
        }
    }
    for (const auto &arg : cmd) {
        if (arg.startsWith("AppId=")) {
            QString id = arg.mid(6);
            if (!id.isEmpty() && id != "0")
                return id;
        }
    }
    return {};
}

// ── Steam library metadata ───────────────────────────────────────────────────

static QStringList vdfValues(const QString &text, const QString &key) {
    QStringList out;
    for (const auto &line : text.split('\n')) {
        // Parse: \t\t"key"\t\t"value"
        auto parts = line.split('"');
        if (parts.size() >= 4 && parts[1] == key) {
            out << parts[3];
        }
    }
    return out;
}

QStringList PresenceDetector::steamRoots() {
    QStringList roots;
    QString home = QDir::homePath();

    // Linux paths
    roots << home + "/.steam/steam"
          << home + "/.steam/root"
          << home + "/.local/share/Steam"
          << home + "/.var/app/com.valvesoftware.Steam/data/Steam"
          << home + "/snap/steam/common/.local/share/Steam";

    // Windows / other
    for (const auto &var : {"STEAM_PATH", "ProgramFiles(x86)", "ProgramFiles"}) {
        QString val = QProcessEnvironment::systemEnvironment().value(var);
        if (!val.isEmpty()) {
            roots << val << (val + "/Steam");
        }
    }

    return roots;
}

QStringList PresenceDetector::steamLibraryDirs() {
    QSet<QString> dirs;
    for (const auto &root : steamRoots()) {
        QString steamapps = root + "/steamapps";
        if (QDir(steamapps).exists())
            dirs.insert(steamapps);

        for (const auto &vdf : {steamapps + "/libraryfolders.vdf",
                                  root + "/config/libraryfolders.vdf"}) {
            QFile f(vdf);
            if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
                QString text = QTextStream(&f).readAll();
                for (const auto &path : vdfValues(text, "path")) {
                    QString apps = path + "/steamapps";
                    if (QDir(apps).exists())
                        dirs.insert(apps);
                }
            }
        }
    }
    return dirs.values();
}

QHash<QString, QString> PresenceDetector::buildSteamAppMap() {
    QHash<QString, QString> map;
    for (const auto &dir : steamLibraryDirs()) {
        QDir d(dir);
        auto entries = d.entryList({"appmanifest_*.acf"}, QDir::Files);
        for (const auto &name : entries) {
            QFile f(d.filePath(name));
            if (f.open(QIODevice::ReadOnly | QIODevice::Text)) {
                QString text = QTextStream(&f).readAll();
                auto appids = vdfValues(text, "appid");
                auto displays = vdfValues(text, "name");
                if (!appids.isEmpty() && !displays.isEmpty()) {
                    map[appids.first()] = displays.first();
                }
            }
        }
    }
    return map;
}

// ── Platform-specific process enumeration ────────────────────────────────────

#ifdef Q_OS_LINUX
QVector<PresenceDetector::ProcessInfo> PresenceDetector::enumerateProcesses() {
    QVector<ProcessInfo> result;
    QDir procDir("/proc");
    auto entries = procDir.entryList(QDir::Dirs | QDir::NoDotAndDotDot);
    for (const auto &entry : entries) {
        bool ok;
        int pid = entry.toInt(&ok);
        if (!ok) continue;

        ProcessInfo info;

        // /proc/<pid>/comm — process name (truncated to 15 chars)
        QFile commFile(QString("/proc/%1/comm").arg(pid));
        if (commFile.open(QIODevice::ReadOnly | QIODevice::Text)) {
            info.name = QTextStream(&commFile).readAll().trimmed();
        }

        // /proc/<pid>/exe — symlink to executable
        QFileInfo exeInfo(QString("/proc/%1/exe").arg(pid));
        if (exeInfo.isSymLink()) {
            info.exePath = QFile::symLinkTarget(QString("/proc/%1/exe").arg(pid));
        }

        // /proc/<pid>/cmdline — null-separated args
        QFile cmdFile(QString("/proc/%1/cmdline").arg(pid));
        if (cmdFile.open(QIODevice::ReadOnly)) {
            QByteArray data = cmdFile.readAll();
            auto parts = data.split('\0');
            for (const auto &part : parts) {
                if (!part.isEmpty())
                    info.cmdline << QString::fromUtf8(part);
            }
        }

        // /proc/<pid>/environ — null-separated env vars
        QFile envFile(QString("/proc/%1/environ").arg(pid));
        if (envFile.open(QIODevice::ReadOnly)) {
            QByteArray data = envFile.readAll();
            auto parts = data.split('\0');
            for (const auto &part : parts) {
                if (!part.isEmpty())
                    info.environ << QString::fromUtf8(part);
            }
        }

        if (!info.name.isEmpty() || !info.exePath.isEmpty())
            result.append(info);
    }
    return result;
}
#endif

#ifdef Q_OS_WIN
QVector<PresenceDetector::ProcessInfo> PresenceDetector::enumerateProcesses() {
    QVector<ProcessInfo> result;

    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snapshot == INVALID_HANDLE_VALUE) return result;

    PROCESSENTRY32W pe;
    pe.dwSize = sizeof(pe);

    if (Process32FirstW(snapshot, &pe)) {
        do {
            ProcessInfo info;
            info.name = QString::fromWCharArray(pe.szExeFile);

            // Get full exe path
            HANDLE hProcess = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ,
                                           FALSE, pe.th32ProcessID);
            if (hProcess) {
                wchar_t exePath[MAX_PATH];
                DWORD len = GetModuleFileNameExW(hProcess, nullptr, exePath, MAX_PATH);
                if (len > 0)
                    info.exePath = QString::fromWCharArray(exePath, len);

                // Get command line (requires reading process memory — complex on Windows)
                // For now, use the exe name as cmdline[0]
                info.cmdline << info.name;

                CloseHandle(hProcess);
            }

            result.append(info);
        } while (Process32NextW(snapshot, &pe));
    }

    CloseHandle(snapshot);
    return result;
}
#endif

#ifdef Q_OS_MACOS
QVector<PresenceDetector::ProcessInfo> PresenceDetector::enumerateProcesses() {
    QVector<ProcessInfo> result;

    int mib[4] = {CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0};
    size_t size = 0;

    if (sysctl(mib, 4, nullptr, &size, nullptr, 0) < 0) return result;

    QByteArray buf(size, '\0');
    if (sysctl(mib, 4, buf.data(), &size, nullptr, 0) < 0) return result;

    int count = size / sizeof(kinfo_proc);
    struct kinfo_proc *procs = (struct kinfo_proc *)buf.data();

    for (int i = 0; i < count; i++) {
        ProcessInfo info;
        info.name = QString::fromUtf8(procs[i].kp_proc.p_comm);

        // Get exe path
        char pathbuf[PROC_PIDPATHINFO_MAXSIZE];
        if (proc_pidpath(procs[i].kp_proc.p_pid, pathbuf, sizeof(pathbuf)) > 0) {
            info.exePath = QString::fromUtf8(pathbuf);
        }

        info.cmdline << info.name;
        result.append(info);
    }

    return result;
}
#endif

// ── Detection logic ──────────────────────────────────────────────────────────

QVector<DetectedActivity> PresenceDetector::detect() {
    // Refresh Steam cache every 5 minutes
    qint64 now = QDateTime::currentSecsSinceEpoch();
    if (m_steamCache.isEmpty() || (now - m_steamCacheTime) > 300) {
        m_steamCache = buildSteamAppMap();
        m_steamCacheTime = now;
    }

    QVector<DetectedActivity> results;
    QSet<QString> seen;
    QSet<QString> seenAppIds;

    auto processes = enumerateProcesses();
    for (const auto &proc : processes) {
        // 1) Steam games via AppId
        QString appId = steamAppIdFromEnv(proc.environ, proc.cmdline);
        if (!appId.isEmpty()) {
            if (seenAppIds.contains(appId)) continue;
            if (m_steamCache.contains(appId)) {
                seenAppIds.insert(appId);
                QString key = "steam:" + appId;
                if (!seen.contains(key)) {
                    seen.insert(key);
                    results.append(DetectedActivity{
                        "game", m_steamCache[appId], key, appId
                    });
                }
                continue;
            }
        }

        // Get best exe stem
        QString stem;
        if (!proc.exePath.isEmpty())
            stem = basenameStem(proc.exePath);
        else if (!proc.cmdline.isEmpty())
            stem = basenameStem(proc.cmdline.first());
        else
            stem = basenameStem(proc.name);

        if (stem.isEmpty() || seen.contains(stem)) continue;

        // 2) Known non-game apps
        if (auto app = matchKnownApp(stem)) {
            seen.insert(stem);
            results.append(*app);
            continue;
        }

        // 3) Ignore wine/steam plumbing
        if (isWineSystemProcess(stem)) continue;

        // 4) Known game executables
        if (auto game = matchKnownGame(stem)) {
            seen.insert(stem);
            results.append(*game);
        }
    }

    // Collapse duplicates by kind|name
    QSet<QString> seenLabels;
    QVector<DetectedActivity> deduped;
    for (const auto &a : results) {
        QString label = a.kind + "|" + a.name;
        if (!seenLabels.contains(label)) {
            seenLabels.insert(label);
            deduped.append(a);
        }
    }

    // Games first (stable sort)
    std::stable_sort(deduped.begin(), deduped.end(),
        [](const DetectedActivity &a, const DetectedActivity &b) {
            int ai = (a.kind == "game") ? 0 : 1;
            int bi = (b.kind == "game") ? 0 : 1;
            return ai < bi;
        });

    return deduped;
}

// ── PresenceDetector class ───────────────────────────────────────────────────

PresenceDetector::PresenceDetector(QObject *parent)
    : QObject(parent)
    , m_timer(new QTimer(this))
{
    m_timer->setInterval(15000); // 15 seconds
    connect(m_timer, &QTimer::timeout, this, &PresenceDetector::onTimeout);
}

void PresenceDetector::start() {
    // Initial detection after 2 seconds
    QTimer::singleShot(2000, this, &PresenceDetector::onTimeout);
    m_timer->start();
}

void PresenceDetector::stop() {
    m_timer->stop();
}

void PresenceDetector::onTimeout() {
    auto current = detect();
    if (current != m_lastActivities) {
        m_lastActivities = current;
        QJsonArray arr;
        for (const auto &a : current) {
            arr.append(a.toJson());
        }
        emit activitiesDetected(arr);
    }
}
