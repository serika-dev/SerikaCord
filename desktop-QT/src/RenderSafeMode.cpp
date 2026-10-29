#include "RenderSafeMode.h"

#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QFileInfo>
#include <QGuiApplication>
#include <QHash>
#include <QLibraryInfo>
#include <QProcess>
#include <QProcessEnvironment>
#include <QSettings>
#include <QSysInfo>
#include <QThread>

#include <cstdio>
#include <cstring>
#include <memory>

#if defined(Q_OS_UNIX)
#include <cerrno>
#include <csignal>
#include <sys/types.h>
#include <sys/wait.h>
#endif

#ifndef SERIKA_APP_VERSION
#define SERIKA_APP_VERSION "0.0.0"
#endif

namespace RenderSafeMode {
namespace {

const char *const LEVEL_KEY = "linux/renderLevel";
const char *const LEVEL_VERSION_KEY = "linux/renderLevelVersion";
// 2.2.0 – 2.4.0 stored a single on/off step here.
const char *const LEGACY_SECCOMP_KEY = "linux/seccompFallback";
const char *const RUNNING_OVERRIDES_KEY = "runtime/overrides";
const char *const RELAUNCH_PID_ENV = "SERIKA_RELAUNCH_AFTER_PID";

// Variables the report shows, captured before this process changes any.
const char *const WATCHED_ENV[] = {
    "QTWEBENGINE_CHROMIUM_FLAGS", "QTWEBENGINE_DISABLE_SANDBOX", "QTWEBENGINE_PROCESS_PATH",
    "QTWEBENGINE_RESOURCES_PATH", "QTWEBENGINE_LOCALES_PATH", "QT_QPA_PLATFORM",
    "QT_QPA_PLATFORMTHEME", "QT_PLUGIN_PATH", "QT_QPA_PLATFORM_PLUGIN_PATH", "QT_QUICK_BACKEND",
    "QSG_RHI_BACKEND", "QT_XCB_GL_INTEGRATION", "QT_LOGGING_RULES", "LIBGL_ALWAYS_SOFTWARE",
    "LD_LIBRARY_PATH", "LD_PRELOAD", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "WAYLAND_DISPLAY",
    "DISPLAY", "APPIMAGE", "APPDIR", "SERIKA_RENDER_MODE", "SERIKA_DISABLE_SECCOMP",
    "SERIKA_APP_URL", "SERIKACORD_DEBUG",
};
// Set by configure(); a relaunch restores what the user had instead.
const char *const MANAGED_ENV[] = {
    "QTWEBENGINE_CHROMIUM_FLAGS", "QTWEBENGINE_DISABLE_SANDBOX", "QT_QUICK_BACKEND",
    "LIBGL_ALWAYS_SOFTWARE", "QT_LOGGING_RULES",
};
// A launch that sets any of these wants a fresh process, not the running one.
const char *const OVERRIDE_ENV[] = {
    "QTWEBENGINE_CHROMIUM_FLAGS", "QTWEBENGINE_DISABLE_SANDBOX", "QT_QUICK_BACKEND",
    "LIBGL_ALWAYS_SOFTWARE", "QT_XCB_GL_INTEGRATION", "QSG_RHI_BACKEND",
    "SERIKA_RENDER_MODE", "SERIKA_DISABLE_SECCOMP", "SERIKACORD_DEBUG",
};

struct EnvValue {
    bool set = false;
    QByteArray value;
};

bool g_diagnostics = false;
bool g_diagnosticsArg = false;
bool g_forced = false;
int g_level = Normal;
int g_crashes = 0;
QString g_reason;
QString g_failure;
QByteArray g_flags;
QHash<QByteArray, EnvValue> g_original;

std::unique_ptr<QSettings> prefs() {
    return std::make_unique<QSettings>(QSettings::NativeFormat, QSettings::UserScope,
                                       QStringLiteral("SerikaCord"), QStringLiteral("SerikaCord"));
}

EnvValue original(const char *name) {
    return g_original.value(QByteArray(name));
}

void appendLoggingRule(const QByteArray &rule) {
    QByteArray rules = qgetenv("QT_LOGGING_RULES");
    if (!rules.isEmpty()) rules += ';';
    qputenv("QT_LOGGING_RULES", rules + rule);
}

void writeErr(const QString &line) {
    const QByteArray bytes = QStringLiteral("SerikaCord: %1\n").arg(line).toLocal8Bit();
    std::fwrite(bytes.constData(), 1, size_t(bytes.size()), stderr);
    std::fflush(stderr);
}

QString statusName(int status) {
    // QWebEnginePage::RenderProcessTerminationStatus
    switch (status) {
    case 0: return QStringLiteral("normal");
    case 1: return QStringLiteral("abnormal exit");
    case 2: return QStringLiteral("crashed");
    case 3: return QStringLiteral("killed");
    default: return QStringLiteral("status %1").arg(status);
    }
}

QString fileState(const QString &path, bool executable = false) {
    const QFileInfo fi(path);
    if (!fi.exists()) return QStringLiteral("missing");
    if (executable && !fi.isExecutable()) return QStringLiteral("not executable");
    return QStringLiteral("ok, %1 bytes").arg(fi.size());
}

#if defined(Q_OS_UNIX)
QString signalName(int sig) {
    switch (sig) {
    case SIGSYS: return QStringLiteral("SIGSYS, a system call the seccomp filter blocks");
    case SIGSEGV: return QStringLiteral("SIGSEGV");
    case SIGABRT: return QStringLiteral("SIGABRT");
    case SIGTRAP: return QStringLiteral("SIGTRAP");
    case SIGILL: return QStringLiteral("SIGILL");
    case SIGBUS: return QStringLiteral("SIGBUS");
    case SIGFPE: return QStringLiteral("SIGFPE");
    case SIGKILL: return QStringLiteral("SIGKILL");
    case SIGTERM: return QStringLiteral("SIGTERM");
    case SIGINT: return QStringLiteral("SIGINT");
    default: return QStringLiteral("SIG?");
    }
}

bool processAlive(qint64 pid) {
    if (::kill(pid_t(pid), 0) != 0 && errno == ESRCH) return false;
#if defined(Q_OS_LINUX)
    // An exited process its parent hasn't reaped yet is a zombie: gone for us.
    QFile stat(QStringLiteral("/proc/%1/stat").arg(pid));
    if (stat.open(QIODevice::ReadOnly)) {
        const QByteArray s = stat.readAll();
        const int end = s.lastIndexOf(')');
        if (end >= 0 && end + 2 < s.size() && (s.at(end + 2) == 'Z' || s.at(end + 2) == 'X')) return false;
    }
#endif
    return true;
}
#endif

} // namespace

void configure(int argc, char **argv) {
    for (const char *name : WATCHED_ENV) {
        EnvValue v;
        v.set = qEnvironmentVariableIsSet(name);
        v.value = qgetenv(name);
        g_original.insert(QByteArray(name), v);
    }
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--diagnostics") == 0 || std::strcmp(argv[i], "-diagnostics") == 0) {
            g_diagnosticsArg = true;
        }
    }
    const QByteArray debugEnv = qgetenv("SERIKACORD_DEBUG");
    g_diagnostics = g_diagnosticsArg || (!debugEnv.isEmpty() && debugEnv != "0");

    auto settings = prefs();
    const bool gpuPref = settings->value(QStringLiteral("prefs/hardwareAcceleration"), true).toBool();

#if defined(Q_OS_LINUX)
    settings->remove(QLatin1String(LEGACY_SECCOMP_KEY));
    bool okMode = false;
    const int forcedMode = qEnvironmentVariableIntValue("SERIKA_RENDER_MODE", &okMode);
    if (okMode && forcedMode >= Normal && forcedMode <= MaxLevel) {
        g_level = forcedMode;
        g_forced = true;
        g_reason = QStringLiteral("pinned by SERIKA_RENDER_MODE");
    } else {
        int stored = settings->value(QLatin1String(LEVEL_KEY), 0).toInt();
        const QString storedVersion = settings->value(QLatin1String(LEVEL_VERSION_KEY)).toString();
        if (stored > Normal && storedVersion != QLatin1String(SERIKA_APP_VERSION)) {
            // A new version may ship a QtWebEngine that works here: probe again.
            settings->remove(QLatin1String(LEVEL_KEY));
            settings->remove(QLatin1String(LEVEL_VERSION_KEY));
            stored = Normal;
        }
        g_level = qBound(int(Normal), stored, int(MaxLevel));
        g_reason = g_level > Normal ? QStringLiteral("chosen after the page renderer crashed on this machine")
                                    : QStringLiteral("default");
    }
    if (qEnvironmentVariableIntValue("SERIKA_DISABLE_SECCOMP") == 1 && g_level < NoSeccomp) {
        g_level = NoSeccomp;
        g_reason = QStringLiteral("SERIKA_DISABLE_SECCOMP=1");
    }
#endif

    QByteArray flags =
        "--enable-smooth-scrolling "
        "--enable-features=OverlayScrollbar "
        // Keep timers/rendering alive while hidden in the tray, so calls,
        // notifications and presence keep working like Discord's client.
        "--disable-background-timer-throttling "
        "--disable-renderer-backgrounding "
        "--disable-backgrounding-occluded-windows "
        "--disable-features=BackForwardCache ";
    const bool gpu = gpuPref && g_level < Software;
    flags += gpu ? "--enable-gpu-rasterization" : "--disable-gpu --disable-gpu-compositing";
    if (g_level == NoSeccomp) flags += " --disable-seccomp-filter-sandbox";
    if (g_level >= NoSandbox) {
        flags += " --no-sandbox";
        qputenv("QTWEBENGINE_DISABLE_SANDBOX", "1");
    }
    if (g_level >= Software) {
        flags += " --no-zygote";
        qputenv("QT_QUICK_BACKEND", "software");
        qputenv("LIBGL_ALWAYS_SOFTWARE", "1");
    }
    if (g_diagnostics) {
        flags += " --enable-logging=stderr --v=0";
        appendLoggingRule("qt.webenginecontext.debug=true");
    }
    // The user's own flags go last so they win over ours (Chromium keeps the
    // last value of a repeated switch); they are never dropped.
    const EnvValue userFlags = original("QTWEBENGINE_CHROMIUM_FLAGS");
    if (!userFlags.value.trimmed().isEmpty()) flags += ' ' + userFlags.value.trimmed();
    g_flags = flags;
    qputenv("QTWEBENGINE_CHROMIUM_FLAGS", flags);

    if (g_level > Normal) {
        writeErr(QStringLiteral("render mode %1 (%2): %3")
                     .arg(g_level).arg(levelName(g_level), g_reason));
    }
}

bool diagnostics() { return g_diagnostics; }
int level() { return g_level; }

QString levelName(int level) {
    switch (level) {
    case Normal: return QStringLiteral("full sandbox");
    case NoSeccomp: return QStringLiteral("seccomp filter off");
    case NoSandbox: return QStringLiteral("sandbox off");
    case Software: return QStringLiteral("sandbox off, software rendering");
    default: return QStringLiteral("unknown");
    }
}

QString overridesFingerprint(const QStringList &unknownOptions) {
    QStringList parts;
    for (const char *name : OVERRIDE_ENV) {
        const EnvValue v = original(name);
        if (v.set) parts << QStringLiteral("%1=%2").arg(QLatin1String(name), QString::fromLocal8Bit(v.value));
    }
    QStringList opts = unknownOptions;
    opts.sort();
    for (const QString &o : opts) parts << QStringLiteral("--") + o;
    if (g_diagnosticsArg) parts << QStringLiteral("--diagnostics");
    return parts.join(QLatin1Char('\n'));
}

void rememberRunningFingerprint(const QString &fingerprint) {
    auto settings = prefs();
    settings->setValue(QLatin1String(RUNNING_OVERRIDES_KEY), fingerprint);
}

QString runningFingerprint() {
    return prefs()->value(QLatin1String(RUNNING_OVERRIDES_KEY)).toString();
}

void log(const QString &line) { writeErr(line); }

void debug(const QString &line) {
    if (g_diagnostics) writeErr(line);
}

QString report() {
    QStringList out;
    auto add = [&out](const QString &k, const QString &v) { out << QStringLiteral("  %1: %2").arg(k, v); };

    out << QStringLiteral("SerikaCord %1 diagnostics").arg(QStringLiteral(SERIKA_APP_VERSION));
    add(QStringLiteral("Qt"), QStringLiteral("%1 (built with %2), platform plugin \"%3\"")
            .arg(QString::fromLatin1(qVersion()), QStringLiteral(QT_VERSION_STR), QGuiApplication::platformName()));
    add(QStringLiteral("OS"), QStringLiteral("%1, %2 %3, %4").arg(QSysInfo::prettyProductName(),
            QSysInfo::kernelType(), QSysInfo::kernelVersion(), QSysInfo::currentCpuArchitecture()));
    add(QStringLiteral("Executable"), QCoreApplication::applicationFilePath());
    add(QStringLiteral("Arguments"), QCoreApplication::arguments().mid(1).join(QLatin1Char(' ')));

    const QString exe = QLibraryInfo::path(QLibraryInfo::LibraryExecutablesPath);
    const QString data = QLibraryInfo::path(QLibraryInfo::DataPath);
    const QString translations = QLibraryInfo::path(QLibraryInfo::TranslationsPath);
    add(QStringLiteral("Qt prefix"), QLibraryInfo::path(QLibraryInfo::PrefixPath));
    add(QStringLiteral("Qt libraries"), QLibraryInfo::path(QLibraryInfo::LibrariesPath));
    add(QStringLiteral("Qt plugins"), QLibraryInfo::path(QLibraryInfo::PluginsPath));
    add(QStringLiteral("Qt library executables"), exe);

    QString processPath = qEnvironmentVariable("QTWEBENGINE_PROCESS_PATH");
    if (processPath.isEmpty()) {
#if defined(Q_OS_WIN)
        processPath = exe + QStringLiteral("/QtWebEngineProcess.exe");
#elif defined(Q_OS_MACOS)
        processPath = exe + QStringLiteral("/QtWebEngineProcess");
#else
        processPath = exe + QStringLiteral("/QtWebEngineProcess");
        if (!QFileInfo::exists(processPath)) {
            processPath = QCoreApplication::applicationDirPath() + QStringLiteral("/QtWebEngineProcess");
        }
#endif
    }
    add(QStringLiteral("QtWebEngineProcess"), QStringLiteral("%1 [%2]").arg(processPath, fileState(processPath, true)));

    QString resources = qEnvironmentVariable("QTWEBENGINE_RESOURCES_PATH");
    if (resources.isEmpty()) resources = data + QStringLiteral("/resources");
    QStringList resourceStates;
    for (const char *f : {"icudtl.dat", "qtwebengine_resources.pak", "qtwebengine_resources_100p.pak",
                          "qtwebengine_resources_200p.pak", "v8_context_snapshot.bin"}) {
        resourceStates << QStringLiteral("%1 [%2]").arg(QLatin1String(f),
                                                       fileState(resources + QLatin1Char('/') + QLatin1String(f)));
    }
    add(QStringLiteral("Resources"), resources);
    for (const QString &s : resourceStates) out << QStringLiteral("    ") + s;
    out << QStringLiteral("    (icudtl.dat is only needed when Qt WebEngine bundles its own ICU, as the AppImage does)");

    QString locales = qEnvironmentVariable("QTWEBENGINE_LOCALES_PATH");
    if (locales.isEmpty()) locales = translations + QStringLiteral("/qtwebengine_locales");
    const int paks = QDir(locales).entryList({QStringLiteral("*.pak")}, QDir::Files).size();
    add(QStringLiteral("Locales"), QStringLiteral("%1 [%2 .pak files]").arg(locales).arg(paks));

    add(QStringLiteral("Render mode"), QStringLiteral("%1 (%2) - %3").arg(g_level).arg(levelName(g_level), g_reason));
    add(QStringLiteral("Effective QTWEBENGINE_CHROMIUM_FLAGS"), QString::fromLocal8Bit(g_flags));
    add(QStringLiteral("Effective QTWEBENGINE_DISABLE_SANDBOX"),
        qEnvironmentVariableIsSet("QTWEBENGINE_DISABLE_SANDBOX") ? qEnvironmentVariable("QTWEBENGINE_DISABLE_SANDBOX")
                                                                 : QStringLiteral("(unset)"));
    add(QStringLiteral("Effective QT_QUICK_BACKEND"),
        qEnvironmentVariableIsSet("QT_QUICK_BACKEND") ? qEnvironmentVariable("QT_QUICK_BACKEND") : QStringLiteral("(unset)"));
    out << QStringLiteral("  Environment at start:");
    for (const char *name : WATCHED_ENV) {
        const EnvValue v = original(name);
        out << QStringLiteral("    %1=%2").arg(QLatin1String(name),
                                              v.set ? QString::fromLocal8Bit(v.value) : QStringLiteral("(unset)"));
    }
    if (!g_failure.isEmpty()) add(QStringLiteral("Last renderer exit"), g_failure);
    return out.join(QLatin1Char('\n'));
}

void printReport() {
    const QByteArray bytes = (report() + QLatin1Char('\n')).toLocal8Bit();
    std::fwrite(bytes.constData(), 1, size_t(bytes.size()), stderr);
    std::fflush(stderr);
}

QString describeExit(int exitCode) {
#if defined(Q_OS_UNIX)
    // Chromium reports the raw waitpid() status on POSIX: 159 is SIGSYS (31)
    // with a core dump, which is why comparing with SIGSYS alone missed it.
    if (WIFSIGNALED(exitCode)) {
        const int sig = WTERMSIG(exitCode);
        return QStringLiteral("signal %1 (%2)%3, raw status %4")
            .arg(sig)
            .arg(signalName(sig))
            .arg(WCOREDUMP(exitCode) ? QStringLiteral(", core dumped") : QString())
            .arg(exitCode);
    }
    if (WIFEXITED(exitCode)) return QStringLiteral("exit code %1, raw status %2").arg(WEXITSTATUS(exitCode)).arg(exitCode);
#endif
    return QStringLiteral("exit code %1").arg(exitCode);
}

Action onRendererTerminated(int status, int exitCode, bool earlyInSession) {
    if (status == 0) return Action::Ignore; // normal: e.g. a process swap on navigation
    ++g_crashes;
    g_failure = QStringLiteral("%1, %2").arg(statusName(status), describeExit(exitCode));
    log(QStringLiteral("page renderer ended: %1 (render mode %2, %3)")
            .arg(g_failure).arg(g_level).arg(earlyInSession ? QStringLiteral("before the app loaded")
                                                            : QStringLiteral("after the app loaded")));
#if defined(Q_OS_LINUX)
    const bool sigsys = WIFSIGNALED(exitCode) && WTERMSIG(exitCode) == SIGSYS;
    if (earlyInSession || sigsys) {
        if (g_forced || g_level >= MaxLevel) return Action::GiveUp;
        auto settings = prefs();
        settings->setValue(QLatin1String(LEVEL_KEY), g_level + 1);
        settings->setValue(QLatin1String(LEVEL_VERSION_KEY), QStringLiteral(SERIKA_APP_VERSION));
        settings->sync();
        log(QStringLiteral("restarting in render mode %1 (%2)").arg(g_level + 1).arg(levelName(g_level + 1)));
        return Action::Relaunch;
    }
#else
    if (earlyInSession && g_crashes > 2) return Action::GiveUp;
#endif
    // A crash after the app had been working: reload, a few times.
    return g_crashes > 3 ? Action::GiveUp : Action::Reload;
}

QString lastFailure() { return g_failure; }

bool relaunch(bool resetLevel) {
    if (resetLevel) {
        auto settings = prefs();
        settings->remove(QLatin1String(LEVEL_KEY));
        settings->remove(QLatin1String(LEVEL_VERSION_KEY));
        settings->sync();
    }
    QProcessEnvironment env = QProcessEnvironment::systemEnvironment();
    for (const char *name : MANAGED_ENV) {
        const EnvValue v = original(name);
        if (v.set) env.insert(QLatin1String(name), QString::fromLocal8Bit(v.value));
        else env.remove(QLatin1String(name));
    }
    env.insert(QLatin1String(RELAUNCH_PID_ENV), QString::number(QCoreApplication::applicationPid()));

    // An AppImage is started again from its file: this mount goes away with us.
    const QString appImage = qEnvironmentVariable("APPIMAGE");
    const QString program = !appImage.isEmpty() && QFileInfo::exists(appImage)
        ? appImage : QCoreApplication::applicationFilePath();
    QProcess proc;
    proc.setProgram(program);
    proc.setArguments(QCoreApplication::arguments().mid(1));
    proc.setProcessEnvironment(env);
    const bool ok = proc.startDetached();
    if (!ok) log(QStringLiteral("could not restart %1").arg(program));
    return ok;
}

void waitForPreviousInstance() {
    const QByteArray value = qgetenv(RELAUNCH_PID_ENV);
    if (value.isEmpty()) return;
    qunsetenv(RELAUNCH_PID_ENV);
#if defined(Q_OS_UNIX)
    const qint64 pid = value.toLongLong();
    if (pid <= 1) return;
    QElapsedTimer timer;
    timer.start();
    while (processAlive(pid)) {
        if (timer.elapsed() > 20000) {
            log(QStringLiteral("the previous SerikaCord process (%1) is still running").arg(pid));
            return;
        }
        QThread::msleep(100);
    }
#endif
}

} // namespace RenderSafeMode
