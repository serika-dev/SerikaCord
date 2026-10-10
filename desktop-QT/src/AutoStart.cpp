#include "AutoStart.h"

#include <QCoreApplication>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QSettings>
#include <QStandardPaths>
#include <QTextStream>

namespace AutoStart {

QString launchPath() {
    // AppImages run from a temporary mount; the stable path is $APPIMAGE.
    const QString appImage = qEnvironmentVariable("APPIMAGE");
    if (!appImage.isEmpty()) return appImage;
    return QCoreApplication::applicationFilePath();
}

#if defined(Q_OS_WIN)

static const char *RUN_KEY = "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

bool isEnabled() {
    QSettings run(QString::fromLatin1(RUN_KEY), QSettings::NativeFormat);
    return run.contains(QStringLiteral("SerikaCord"));
}

bool setEnabled(bool enabled) {
    QSettings run(QString::fromLatin1(RUN_KEY), QSettings::NativeFormat);
    if (enabled) {
        const QString cmd = QStringLiteral("\"%1\" %2")
            .arg(QDir::toNativeSeparators(launchPath()), QLatin1String(ARG));
        run.setValue(QStringLiteral("SerikaCord"), cmd);
    } else {
        run.remove(QStringLiteral("SerikaCord"));
    }
    run.sync();
    return run.status() == QSettings::NoError;
}

#elif defined(Q_OS_MACOS)

static QString agentPath() {
    return QDir::homePath() + QStringLiteral("/Library/LaunchAgents/dev.serika.serikacord.plist");
}

static QString xmlEscape(QString s) {
    s.replace('&', QLatin1String("&amp;"));
    s.replace('<', QLatin1String("&lt;"));
    s.replace('>', QLatin1String("&gt;"));
    return s;
}

bool isEnabled() {
    return QFile::exists(agentPath());
}

bool setEnabled(bool enabled) {
    const QString path = agentPath();
    if (!enabled) return !QFile::exists(path) || QFile::remove(path);
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Text)) return false;
    QTextStream out(&f);
    out << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"
        << "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" "
           "\"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n"
        << "<plist version=\"1.0\"><dict>\n"
        << "  <key>Label</key><string>dev.serika.serikacord</string>\n"
        << "  <key>ProgramArguments</key><array>\n"
        << "    <string>" << xmlEscape(launchPath()) << "</string>\n"
        << "    <string>" << ARG << "</string>\n"
        << "  </array>\n"
        << "  <key>RunAtLoad</key><true/>\n"
        << "</dict></plist>\n";
    out.flush();
    return f.commit();
}

#else // Linux / BSD: XDG autostart

static QString autostartPath() {
    QString base = qEnvironmentVariable("XDG_CONFIG_HOME");
    if (base.isEmpty()) base = QDir::homePath() + QStringLiteral("/.config");
    return base + QStringLiteral("/autostart/serikacord.desktop");
}

bool isEnabled() {
    return QFile::exists(autostartPath());
}

bool setEnabled(bool enabled) {
    const QString path = autostartPath();
    if (!enabled) return !QFile::exists(path) || QFile::remove(path);
    QDir().mkpath(QFileInfo(path).absolutePath());
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly | QIODevice::Text)) return false;
    QString exec = launchPath();
    exec.replace('"', QLatin1String("\\\""));
    QTextStream out(&f);
    out << "[Desktop Entry]\n"
        << "Type=Application\n"
        << "Name=SerikaCord\n"
        << "Comment=Chat with friends and communities\n"
        << "Exec=\"" << exec << "\" " << ARG << "\n"
        << "Icon=serikacord\n"
        << "Terminal=false\n"
        << "X-GNOME-Autostart-enabled=true\n";
    out.flush();
    return f.commit();
}

#endif

} // namespace AutoStart
