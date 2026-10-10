# SerikaCord Desktop (Qt6)

The native desktop client for SerikaCord, built with [Qt6](https://www.qt.io/)
and [Qt WebEngine](https://doc.qt.io/qt-6/qtwebengine-index.html). It loads the
hosted web app (`https://serika.chat`) and adds what a Discord-class desktop
client needs. This is the **default** desktop client; `../desktop-tauri` is
deprecated.

## Features

| Area | What it does | How |
|------|--------------|-----|
| Notifications | Native OS notifications with the sender's round avatar; one per conversation (replaced, not stacked); click focuses the window and jumps to the message; closed when the conversation is read anywhere | Linux: `org.freedesktop.Notifications` over D-Bus. Windows/macOS: tray notification (`QSystemTrayIcon::showMessage`). Page `new Notification()` is routed through the same path via `QWebEngineProfile::setNotificationPresenter` |
| Unread badge | Taskbar/dock count + red dot on the tray and window icon | `QGuiApplication::setBadgeNumber` (Qt ≥ 6.5: dock badge, Windows overlay, Unity LauncherEntry on Linux) |
| Tray | Unread dot; menu: Open, Mute, Deafen (mirror the live call state), Status (Online/Idle/DND/Invisible), Restart to Update, Check for Updates, Quit | `TrayIcon` |
| Window | Close to tray (default on), minimize to tray, window size/position/maximized and zoom remembered, off-screen guard | `AppSettings`, `MainWindow` |
| Start on login | Optional, with "start minimized" | Windows `HKCU\…\Run`, macOS `~/Library/LaunchAgents/dev.serika.serikacord.plist`, Linux `~/.config/autostart/serikacord.desktop`; launched with `--autostart` |
| Global shortcuts | Push to talk (hold), toggle mute, toggle deafen while unfocused; keys configurable in the app (Keybinds → Global), incl. F13–F24 and mouse side buttons | Key-state polling every 15 ms: `GetAsyncKeyState` (Windows), `CGEventSourceKeyState` (macOS, needs Input Monitoring permission), `XQueryKeymap` (Linux/X11) |
| Screen share | "Share your screen" picker (Screens / Applications tabs, screen thumbnails) for `getDisplayMedia()` | `QWebEnginePage::desktopMediaRequested` (Qt ≥ 6.7) |
| Permissions | Mic, camera, screen capture, notifications and clipboard granted to the app itself without prompts; third-party frames get a native Allow/Block dialog, remembered per origin | `permissionRequested` + `PersistentPermissionsPolicy::StoreOnDisk` (Qt ≥ 6.8); `featurePermissionRequested` + QSettings on older Qt |
| Single instance | A second launch focuses the running window and hands it its link | `QLocalServer` |
| Deep links | `serika://invite/<code>`, `serika://channels/<server>/<channel>`, `serika://dm/<user>` (and legacy `serikacord://`, and `https://serika.chat/...` on the command line) open in the running app without a reload | Windows registry, macOS `Info.plist` (`QFileOpenEvent`), Linux `.desktop` `MimeType` (an AppImage registers a per-user entry itself) |
| Links | External links open in the default browser; `target=_blank` / `window.open` to app URLs stay in the window | `SerikaWebPage`, `PopupCatcherPage` |
| Spellcheck | Misspellings underlined; suggestions, cut/copy/paste and "Check Spelling" in the right-click menu of text fields | `SerikaWebView` context menu; Hunspell `.bdic` dictionaries (see below) or the macOS system checker |
| Downloads | Native "Save File" dialog, tray message when done | `QWebEngineProfile::downloadRequested` |
| Auto-idle | Idle after N minutes without keyboard/mouse input anywhere (default 10), back to Online on return | `GetLastInputInfo`, `CGEventSourceSecondsSinceLastEventType`, GNOME Mutter IdleMonitor / `org.freedesktop.ScreenSaver` over D-Bus, X11 sampling fallback |
| Updates | Splash check at launch; background check every 4 h; signed (minisign) download; in-app "Update ready" card + tray item; AppImage replaces itself | `Updater` against `releases/latest/download/latest.json` |
| Zoom / keys | Ctrl+= / Ctrl+- / Ctrl+0 (persisted), F11 fullscreen, Ctrl+R reload, F12 / Ctrl+Shift+I native DevTools window | injected script + `QWebEnginePage::setDevToolsPage` |
| Rich presence | Detects games/apps and reports them as your activity | `PresenceDetector` |

## Web ↔ native bridge

The page talks to the shell through `window.qt.webBridge` (QWebChannel). The
web wrapper is `src/lib/desktop/bridge.ts` (feature-detected; a no-op in
browsers) with pure helpers in `src/lib/desktop/protocol.ts` (unit tested in
`tests/desktop.test.ts`). `src/components/desktop/DesktopIntegration.tsx` is
mounted once in the root layout (only inside the shell) and wires it to the
app: notification clicks, deep links, tray actions, global shortcuts, idle,
voice state and the update card. The Desktop settings section is
`src/components/settings/DesktopSettingsPanel.tsx`; the global keys are in
`src/components/settings/GlobalShortcutSettings.tsx` (Keybinds tab).

Before any page script runs, the shell defines:

```js
window.__serikaDesktop = { shell: "qt", protocol: 2, version: "2.0.0", platform: "linux" };
window.__serikaSetBadge(count); // used by notificationUX.setUnreadBadge
```

and fires `serika-desktop-bridge` on `window` once `window.qt.webBridge` is
usable. Bump `WebBridge::PROTOCOL_VERSION` (and the web constant) on an
incompatible change.

Methods (JS → native; results arrive in a trailing callback):

| Method | |
|--------|---|
| `getInfo()` | `{ version, protocol, platform, arch, qt, windowSystem, capabilities }` |
| `pageCreated()` | Sent by the injected channel script for every new document (resets shortcuts and readiness) |
| `webReady()` | The page is listening; deep links are now routed as `navigateRequested` instead of a reload |
| `showNotification({ id, title, body, icon, url, tag, requireInteraction })` / `closeNotification(tag)` | |
| `setBadgeCount(n)` | |
| `setVoiceState({ connected, muted, deafened })` / `setUserStatus(status)` | Mirrored in the tray |
| `setGlobalShortcuts([{ action, accelerator, hold, whileFocused }])` | Returns the actions that could be bound. Accelerators: `Ctrl+Shift+M`, `F13`, `Alt+Mouse4`, `Num5`, `` ` `` … |
| `getSettings()` / `setSetting(key, value)` | `closeToTray`, `minimizeToTray`, `startOnLogin`, `startMinimized`, `spellcheck`, `nativeNotifications`, `globalShortcuts`, `hardwareAcceleration` (restart), `idleTimeoutMinutes` |
| `getIdleSeconds()` | |
| `checkForUpdates()` / `installUpdate()` / `getUpdateState()` | `{ state: idle|checking|downloading|ready|uptodate|error, version, percent }` |
| `setZoom(delta)`, `toggleFullscreen()`, `toggleDevTools()`, `openExternal(url)`, `focusWindow()`, `readClipboardImage()` | |

Signals (native → JS): `notificationClicked(id, url)`, `navigateRequested(path)`,
`trayAction(action, value)` (`toggle-mute`, `toggle-deafen`, `set-status`,
`open-settings`), `globalShortcut(action, pressed)` (`push-to-talk`,
`toggle-mute`, `toggle-deafen`), `idleChanged(idle)`, `updateStateChanged(state)`,
`settingsChanged(settings)`.

Global shortcut defaults follow the in-app bindings (Ctrl+Shift+M / Ctrl+Shift+D
and the Voice & Video push-to-talk key). While the window is focused the page's
own key handlers act, so a default binding never fires twice; a custom global
key (`whileFocused: true`) works focused or not.

## Layout

```
desktop-QT/
├── CMakeLists.txt
├── Info.plist / serikacord.desktop
└── src/
    ├── main.cpp                 # flags, single instance, splash + update, deep links, start hidden
    ├── AppConfig.*              # app URL (--app-url / SERIKA_APP_URL) and URL policy
    ├── AppSettings.*            # desktop preferences + window state (QSettings)
    ├── AutoStart.*              # start on login per OS
    ├── MainWindow.*             # web view, profile, permissions, tray, downloads, updates
    ├── InjectedScripts.h        # page scripts (marker, channel init, shortcuts, polyfills)
    ├── WebBridge.*              # QWebChannel object
    ├── NotificationManager.*    # native notifications
    ├── TrayIcon.*               # tray icon + menu
    ├── GlobalShortcuts.* / KeyState.*  # system-wide keys (+ idle on Windows/macOS)
    ├── IdleMonitor.*            # auto-idle
    ├── ScreenPicker.*           # getDisplayMedia picker
    ├── SerikaWebPage.* / SerikaWebView.*  # navigation policy, context menu
    ├── DeepLinkHandler.*        # serika:// parsing + registration
    ├── SingleInstance.*         # QLocalServer guard
    ├── Updater.* / UpdaterWindow.*      # update check, verification, splash
    └── PresenceDetector.*       # rich presence
```

## Development

### Prerequisites

- **Qt 6.7+ recommended** (Widgets, WebEngineWidgets, WebEngineCore, Network,
  WebChannel; DBus on Linux). Builds down to Qt 6.2; older Qt loses the screen
  picker (Qt 6.7), per-origin permission storage (6.8) and the taskbar/dock
  badge (6.5).
- **Linux:** `libx11-dev` for global shortcuts / idle fallback (optional).
- **CMake 3.21+**, a **C++20** compiler, **OpenSSL** (update signatures).

```sh
# Debian/Ubuntu
sudo apt install qt6-webengine-dev qt6-webchannel-dev qt6-base-dev libx11-dev libssl-dev cmake build-essential
# macOS
brew install qt cmake openssl
```

Windows: Qt Online Installer, Qt 6.7+ with WebEngine.

### Build & run

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --parallel
./build/SerikaCord                                   # Linux
./build/SerikaCord --app-url http://localhost:3000   # against a local `bun run dev`
```

Flags: `--app-url <url>`, `--start-minimized`, `--autostart` (set by the login
entry), and an optional link (`serika://invite/abc`).

### Spellcheck dictionaries

Qt WebEngine uses Hunspell dictionaries converted to `.bdic` (macOS uses the
system checker). It looks in `$QTWEBENGINE_DICTIONARIES_PATH`, then
`qtwebengine_dictionaries/` next to the binary, then Qt's data dir. Convert with
Qt's `qwebengine_convert_dict en_US.dic en-US.bdic` and ship them in
`qtwebengine_dictionaries/`; without any, the spellcheck switch has no effect.

## Platform notes

- **Wayland:** global shortcuts and the X11 idle fallback only see input that
  goes to XWayland windows, so push-to-talk while a native Wayland app is
  focused doesn't register (Discord has the same limitation). Idle uses D-Bus
  (GNOME/KDE) and works. Screen sharing goes through the desktop portal's own
  picker.
- **macOS:** global shortcuts need *System Settings → Privacy & Security →
  Input Monitoring*. Mic/camera prompts use the `NS*UsageDescription` strings
  in `Info.plist`.
- **Windows:** notifications use the tray balloon/toast (no per-notification
  close; clicking the latest one routes correctly).

## License

MIT — same as the main SerikaCord project.
