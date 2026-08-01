# SerikaCord Desktop (Tauri) — DEPRECATED

> **⚠️ DEPRECATED:** This Tauri build is no longer maintained. The Qt-based
> desktop client in [`../desktop-QT`](../desktop-QT) is now the default and
> actively developed. Use that for all desktop builds going forward.

Native desktop app for SerikaCord, replacing the previous Electron wrapper in
`../desktop`. Built with [Tauri v2](https://v2.tauri.app) — it uses the OS
webview instead of bundling Chromium, so binaries are ~10 MB instead of
~100 MB and use far less memory.

## Features (parity with the Electron app)

- Loads the hosted app (`https://waifu.ws/channels/me`)
- System tray icon: left-click toggles the window, menu has Open/Quit
- Close-to-tray (closing the window hides it; quit from the tray)
- Single instance — launching again focuses the existing window
- `serikacord://` deep links (via `tauri-plugin-deep-link`)
- External links open in the default browser
- Native notifications (via `tauri-plugin-notification`)

## Development

Prereqs: Rust (stable) and the Tauri system dependencies
(<https://v2.tauri.app/start/prerequisites/>). On Debian/Ubuntu:

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

Then:

```sh
bun install       # or npm install
bun run dev       # runs against the production URL
bun run build     # produces installers under src-tauri/target/release/bundle
```

To point the dev build at a local SerikaCord instance, change `APP_URL` in
`src-tauri/src/main.rs`.

## Updates

Auto-update can be added with `tauri-plugin-updater` + signed GitHub release
artifacts (`tauri signer generate`); it is not wired up yet.
