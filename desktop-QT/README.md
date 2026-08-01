# SerikaCord Desktop (Qt6)

Fully native desktop app for SerikaCord, built with [Qt6](https://www.qt.io/)
and [Qt WebEngine](https://doc.qt.io/qt-6/qtwebengine-index.html). This is a
complete alternative to the Tauri app in `../desktop-tauri`, with **full feature
parity**. This is now the **default** desktop client — the Tauri app is deprecated.

## Why Qt?

Qt provides a truly native cross-platform framework with:
- Native widgets, menus, tray icons, and window decorations on every platform
- Qt WebEngine (Chromium-based) for rendering the hosted web app
- QWebChannel for type-safe JS ↔ C++ communication
- First-class support for Windows, macOS, and Linux (X11/Wayland)
- No Rust toolchain required — pure C++

## Features (parity with the Tauri app)

- ✅ Loads the hosted app (`https://serika.chat/channels/me`)
- ✅ System tray icon: left-click toggles the window, menu has Open/Quit
- ✅ Close-to-tray (closing the window hides it; quit via the tray)
- ✅ Single instance — launching again focuses the existing window
- ✅ `serikacord://` deep links (registered in the OS)
- ✅ External links open in the default browser
- ✅ Rich-presence detection (process enumeration, Steam library metadata,
  IGDB game resolution, heartbeat)
- ✅ Updater splash window (branded "Checking for updates…" with progress bar)
- ✅ Keyboard shortcuts (zoom, fullscreen, devtools)
- ✅ Window title tracking (SPA-aware)
- ✅ Badge count on taskbar/dock
- ✅ Mute/unmute audio from tray menu
- ✅ Spellcheck enabled in the webview
- ✅ Persistent cookies (stays logged in between launches)

## Architecture

```
desktop-QT/
├── CMakeLists.txt              # Build system
├── src/
│   ├── main.cpp                # Entry point, single-instance, updater splash
│   ├── MainWindow.h/cpp        # QWebEngineView, web channel, keyboard shortcuts
│   ├── TrayIcon.h/cpp          # System tray with menu
│   ├── SingleInstance.h/cpp    # QLocalServer-based single instance guard
│   ├── UpdaterWindow.h/cpp     # Splash window with progress bar
│   ├── PresenceDetector.h/cpp  # Process enumeration + Steam + game matching
│   ├── WebBridge.h/cpp         # QWebChannel bridge (replaces Tauri invoke)
│   ├── DeepLinkHandler.h/cpp   # serikacord:// URL scheme registration
│   └── resources/
│       └── serikacord.qrc      # Qt resource file (icons)
└── .github/workflows/
    └── build-qt.yml            # CI build for Windows, macOS, Linux
```

## Development

### Prerequisites

- **Qt 6.5+** with modules: Widgets, WebEngineWidgets, WebEngineCore, Network, WebChannel
- **CMake 3.21+**
- **C++20 compiler** (GCC 10+, Clang 12+, MSVC 2019+)

#### Installing Qt

**Linux (Debian/Ubuntu):**
```sh
sudo apt install qt6-webengine-dev qt6-webchannel-dev qt6-base-dev \
  cmake build-essential
```

**macOS (Homebrew):**
```sh
brew install qt cmake
```

**Windows:** Download the Qt Online Installer from https://www.qt.io/download
and select Qt 6.5+ with WebEngine.

### Build

```sh
mkdir build && cd build
cmake .. -DCMAKE_PREFIX_PATH=/path/to/qt6
cmake --build . --config Release
```

### Run

```sh
./SerikaCord        # Linux
./SerikaCord.exe    # Windows
open SerikaCord.app # macOS
```

To point the dev build at a local SerikaCord instance, change `APP_URL` in
`src/main.cpp`.

## Updates

The updater splash window checks for updates on startup. Currently it shows the
splash and proceeds to the main window. To wire up real auto-updates, implement
a network check against the GitHub releases API in `UpdaterWindow.cpp` and
download/install the new binary.

## Deep Links

The `serikacord://` scheme is registered automatically:
- **Windows**: via `HKEY_CURRENT_USER\Software\Classes\serikacord`
- **macOS**: via `Info.plist` `CFBundleURLTypes` (in the app bundle)
- **Linux**: via `.desktop` file `MimeType=x-scheme-handler/serikacord`

## Rich Presence

The `PresenceDetector` runs in a background timer (every 15s) and:
1. Enumerates running processes (via `/proc` on Linux, `Toolhelp32` on Windows,
   `sysctl` on macOS)
2. Matches against a curated table of known apps and games
3. Resolves Steam games via local `appmanifest_*.acf` files
4. Pushes detected activities to the web page via `runJavaScript()`
5. The web page resolves game names via IGDB and reports to the rich-presence API

## License

MIT — same as the main SerikaCord project.
