#pragma once

#include <QElapsedTimer>
#include <QObject>
#include <QTimer>

// System-wide idle detection for automatic Idle status (like Discord: no
// keyboard/mouse input anywhere for N minutes).
//   Windows : GetLastInputInfo
//   macOS   : CGEventSourceSecondsSinceLastEventType
//   Linux   : GNOME Mutter IdleMonitor or org.freedesktop.ScreenSaver over
//             D-Bus, falling back to sampling X11 input state.
class IdleMonitor : public QObject {
    Q_OBJECT

public:
    explicit IdleMonitor(QObject *parent = nullptr);

    // 0 disables auto-idle.
    void setTimeoutMinutes(int minutes);
    int idleSeconds();
    bool isIdle() const { return m_idle; }

signals:
    void idleChanged(bool idle);

private slots:
    void check();

private:
    int linuxIdleSeconds();

    QTimer m_timer;
    int m_timeoutMinutes{10};
    bool m_idle{false};
    // Fallback sampling state.
    unsigned long long m_lastFingerprint{0};
    QElapsedTimer m_sinceInput;
    int m_dbusBackend{-1}; // -1 unknown, 0 none, 1 Mutter, 2 ScreenSaver
};
