#pragma once

#include <QString>

// "Open SerikaCord when you log in": a Run registry value on Windows, a
// LaunchAgent on macOS and an XDG autostart entry on Linux. The app is started
// with --autostart so it can honour "Start minimized".
namespace AutoStart {
    inline constexpr const char *ARG = "--autostart";

    bool isEnabled();
    // Returns false if the OS entry could not be written.
    bool setEnabled(bool enabled);
    // Path of the binary the OS should launch (the AppImage when packaged as one).
    QString launchPath();
}
