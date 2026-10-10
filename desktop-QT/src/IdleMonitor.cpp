#include "IdleMonitor.h"
#include "KeyState.h"

#include <QtGlobal>
#include <climits>

#if defined(Q_OS_LINUX) && defined(SERIKA_HAVE_DBUS)
#include <QDBusConnection>
#include <QDBusInterface>
#include <QDBusReply>
#endif

namespace {
constexpr int CHECK_MS = 5000;
}

IdleMonitor::IdleMonitor(QObject *parent)
    : QObject(parent)
{
    m_sinceInput.start();
    m_timer.setInterval(CHECK_MS);
    connect(&m_timer, &QTimer::timeout, this, &IdleMonitor::check);
    m_timer.start();
}

void IdleMonitor::setTimeoutMinutes(int minutes) {
    m_timeoutMinutes = qMax(0, minutes);
    check();
}

int IdleMonitor::idleSeconds() {
    const long long native = KeyState::systemIdleSeconds();
    if (native >= 0) return static_cast<int>(qMin<long long>(native, INT_MAX));
    return linuxIdleSeconds();
}

int IdleMonitor::linuxIdleSeconds() {
#if defined(Q_OS_LINUX) && defined(SERIKA_HAVE_DBUS)
    QDBusConnection bus = QDBusConnection::sessionBus();
    if (bus.isConnected() && m_dbusBackend != 0) {
        if (m_dbusBackend == -1 || m_dbusBackend == 1) {
            QDBusInterface mutter("org.gnome.Mutter.IdleMonitor", "/org/gnome/Mutter/IdleMonitor/Core",
                                  "org.gnome.Mutter.IdleMonitor", bus);
            mutter.setTimeout(500);
            if (mutter.isValid()) {
                QDBusReply<quint64> r = mutter.call("GetIdletime");
                if (r.isValid()) { m_dbusBackend = 1; return static_cast<int>(r.value() / 1000); }
            }
        }
        if (m_dbusBackend == -1 || m_dbusBackend == 2) {
            QDBusInterface ss("org.freedesktop.ScreenSaver", "/org/freedesktop/ScreenSaver",
                              "org.freedesktop.ScreenSaver", bus);
            ss.setTimeout(500);
            if (ss.isValid()) {
                // KDE implements this (milliseconds); GNOME's stub returns an error.
                QDBusReply<uint> r = ss.call("GetSessionIdleTime");
                if (r.isValid()) { m_dbusBackend = 2; return static_cast<int>(r.value() / 1000); }
            }
        }
        if (m_dbusBackend == -1) m_dbusBackend = 0;
    }
#endif
    // Fallback: sample X11 key/pointer state; any change counts as input.
    const unsigned long long fp = KeyState::inputFingerprint();
    if (fp == 0) return 0; // no way to tell: never auto-idle
    if (fp != m_lastFingerprint) {
        m_lastFingerprint = fp;
        m_sinceInput.restart();
    }
    return static_cast<int>(m_sinceInput.elapsed() / 1000);
}

void IdleMonitor::check() {
    const int secs = idleSeconds();
    const bool idle = m_timeoutMinutes > 0 && secs >= m_timeoutMinutes * 60;
    if (idle != m_idle) {
        m_idle = idle;
        emit idleChanged(idle);
    }
}
