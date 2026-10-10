#pragma once

#include <string>

// Polls the OS keyboard/mouse state so shortcuts work while SerikaCord is not
// focused (push-to-talk needs press *and* release, which plain "register a
// hotkey" APIs don't report).
//
//   Windows : GetAsyncKeyState
//   macOS   : CGEventSourceKeyState (needs the Input Monitoring permission)
//   Linux   : XQueryKeymap on the X server (XWayland on Wayland sessions: keys
//             only register while an X11 window has focus there)
//
// Kept free of Qt types so the X11 headers (which #define None, Bool, Status…)
// never meet Qt headers in the same translation unit.
namespace KeyState {
    enum Modifier : unsigned { Ctrl = 1, Shift = 2, Alt = 4, Meta = 8 };

    // Whether a backend is available on this platform/session.
    bool available();

    // Accelerator key token ("M", "F13", "Space", "Mouse4", "`", "Num5"...) to
    // the native code used by isDown(); -1 when unsupported here.
    int nativeKey(const std::string &token);

    // Refresh the cached state. Call once per poll tick before isDown/modifiers.
    void snapshot();
    bool isDown(int nativeKey);
    unsigned modifiers();

    // Changes whenever there's keyboard/pointer activity (X11 idle fallback
    // when no idle D-Bus service exists). 0 = unsupported.
    unsigned long long inputFingerprint();

    // Seconds since the last user input, or -1 when the platform can't say
    // (Linux uses D-Bus in IdleMonitor instead).
    long long systemIdleSeconds();

    void shutdown();
}
