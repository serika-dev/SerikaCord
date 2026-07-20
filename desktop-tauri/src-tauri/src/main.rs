// SerikaCord native desktop shell (Tauri v2).
// Loads the hosted web app and provides the desktop niceties the old
// Electron wrapper had: tray icon, close-to-tray, single instance,
// serikacord:// deep links, and external links opening in the browser.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod presence;
mod updater_window;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const APP_URL: &str = "https://serika.chat";
const START_PATH: &str = "/channels/me";

static MUTED: AtomicBool = AtomicBool::new(false);

// Injected into the web app. Receives detected activities from Rust via
// `window.__serikaSetActivities`, resolves games through the IGDB proxy, and
// reports to the rich-presence API using the page's (authenticated) session.
const PRESENCE_REPORTER_JS: &str = r#"
(function () {
  if (window.__serikaPresenceInit) return;
  window.__serikaPresenceInit = true;

  var current = [];      // last DetectedActivity[] from Rust
  var reported = {};     // name+kind -> last payload we POSTed (to avoid spam)
  var startedAt = {};    // name+kind -> ISO timestamp

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'include' }, opts || {}));
  }

  async function resolveAndReport(activities) {
    if (!activities || activities.length === 0) {
      if (Object.keys(reported).length > 0) {
        reported = {}; startedAt = {};
        try { await api('/api/users/me/rich-presence', { method: 'DELETE' }); } catch (e) {}
      }
      return;
    }

    var payloads = [];
    for (var i = 0; i < activities.length; i++) {
      var activity = activities[i];
      var name = activity.name;
      var largeImageUrl = null;

      if (activity.kind === 'game') {
        try {
          // Prefer resolving by Steam AppId so the server can return the
          // canonical English title (local Steam manifests are often localized).
          var q = 'name=' + encodeURIComponent(activity.name);
          if (activity.steamAppId) q += '&appId=' + encodeURIComponent(activity.steamAppId);
          var res = await api('/api/igdb/game?' + q);
          if (res.ok) {
            var data = await res.json();
            if (data && data.game) {
              name = data.game.name || name;
              largeImageUrl = data.game.coverUrl || null;
            }
          }
        } catch (e) {}
      }

      var key = activity.kind + '|' + name;
      if (!startedAt[key] || !reported[key] || reported[key].name !== name) {
        startedAt[key] = new Date().toISOString();
      }

      var payload = {
        type: activity.kind === 'game' ? 'game' : activity.kind,
        name: name,
        largeImageUrl: largeImageUrl || undefined,
        largeImageText: name,
        startedAt: startedAt[key],
      };
      payloads.push(payload);
      reported[key] = payload;
    }

    try {
      await api('/api/users/me/rich-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities: payloads })
      });
    } catch (e) {}
  }

  window.__serikaSetActivities = function (activities) {
    current = activities || [];
    resolveAndReport(current);
  };

  // Heartbeat so presence doesn't expire (server TTL ~60s) while unchanged.
  setInterval(function () { if (current && current.length) resolveAndReport(current); }, 45000);
})();
"#;

// ── Tauri IPC commands (invoked from the webview init script) ──────────────

#[tauri::command]
fn set_zoom(window: tauri::WebviewWindow, delta: f64) -> Result<(), String> {
    let current = window.zoom().unwrap_or(1.0);
    let new_zoom = if delta == 0.0 {
        1.0
    } else {
        (current + delta).clamp(0.25, 5.0)
    };
    window.set_zoom(new_zoom).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_fullscreen().unwrap_or(false) {
        window.unfullscreen().map_err(|e| e.to_string())
    } else {
        window.fullscreen().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn toggle_devtools(window: tauri::WebviewWindow) {
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
}

#[tauri::command]
fn set_window_title(window: tauri::WebviewWindow, title: String) {
    let _ = window.set_title(if title.is_empty() { "SerikaCord" } else { &title });
}

#[tauri::command]
fn set_badge_count(app: tauri::AppHandle, count: i64) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_badge_count(count).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn is_muted() -> bool {
    MUTED.load(Ordering::SeqCst)
}

#[tauri::command]
fn toggle_mute(app: tauri::AppHandle) -> bool {
    let new = !MUTED.load(Ordering::SeqCst);
    MUTED.store(new, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window("main") {
        let js = if new {
            "document.querySelectorAll('audio,video').forEach(function(e){e.muted=true;e.volume=0;});"
        } else {
            "document.querySelectorAll('audio,video').forEach(function(e){e.muted=false;e.volume=1;});"
        };
        let _ = window.eval(js);
    }
    new
}

// Injected into the web app alongside the presence reporter. Provides:
//   • Spellcheck enable
//   • Keyboard shortcuts (zoom, fullscreen, devtools, reload)
//   • Window title tracking (SPA-aware via MutationObserver)
//   • `window.__serikaSetBadge(count)` for the web app to set the dock/taskbar badge
const DESKTOP_ENHANCEMENTS_JS: &str = r#"
(function () {
  if (window.__serikaDesktopInit) return;
  window.__serikaDesktopInit = true;

  // Enable spellcheck in the webview.
  try { document.body.spellcheck = true; } catch (e) {}

  // Keyboard shortcuts that integrate with the native window.
  document.addEventListener('keydown', function (e) {
    var t = window.__TAURI__;
    if (!t || !t.core || !t.core.invoke) return;
    var mod = e.ctrlKey || e.metaKey;

    // Ctrl/Cmd + = or +  →  Zoom in
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault(); t.core.invoke('set_zoom', { delta: 0.1 }); return;
    }
    // Ctrl/Cmd + -      →  Zoom out
    if (mod && e.key === '-') {
      e.preventDefault(); t.core.invoke('set_zoom', { delta: -0.1 }); return;
    }
    // Ctrl/Cmd + 0      →  Reset zoom
    if (mod && e.key === '0') {
      e.preventDefault(); t.core.invoke('set_zoom', { delta: 0 }); return;
    }
    // F11               →  Toggle fullscreen
    if (e.key === 'F11') {
      e.preventDefault(); t.core.invoke('toggle_fullscreen'); return;
    }
    // F12 / Ctrl+Shift+I →  Toggle DevTools
    if (e.key === 'F12' || (mod && e.shiftKey && (e.key === 'I' || e.key === 'i'))) {
      e.preventDefault(); t.core.invoke('toggle_devtools'); return;
    }
  });

  // Track SPA title changes and sync them to the native window title.
  function updateTitle() {
    try { window.__TAURI__.core.invoke('set_window_title', { title: document.title }); } catch (e) {}
  }
  updateTitle();
  if (document.head) {
    new MutationObserver(updateTitle).observe(document.head, {
      childList: true, subtree: true, characterData: true,
    });
  }

  // Expose badge setter for the web app.
  window.__serikaSetBadge = function (count) {
    try { window.__TAURI__.core.invoke('set_badge_count', { count: count }); } catch (e) {}
  };
})();
"#;

/// Check for updates, showing progress in the updater splash window.
/// Returns `true` if an update was installed and the app should relaunch
/// (caller should not proceed to show the main window in that case).
#[cfg(desktop)]
async fn run_update_check(app: tauri::AppHandle) -> bool {
    use tauri_plugin_updater::UpdaterExt;

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[updater] init failed: {e}");
            updater_window::emit_error(&app, &e.to_string());
            return false;
        }
    };

    let current_version = app.package_info().version.to_string();

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            eprintln!("[updater] update available: {version} — downloading");
            updater_window::emit_version(&app, &current_version, Some(&version));
            updater_window::emit_progress(&app, &format!("Downloading v{version}…"), Some(0.0));

            let app_for_progress = app.clone();
            let mut downloaded: u64 = 0;
            let result = update
                .download_and_install(
                    |chunk, total| {
                        downloaded += chunk as u64;
                        if let Some(total) = total {
                            let percent = (downloaded as f64 / total as f64) * 100.0;
                            let mb_done = downloaded / 1024 / 1024;
                            let mb_total = total / 1024 / 1024;
                            eprintln!("[updater] {mb_done}/{mb_total} MB ({percent:.0}%)");
                            updater_window::emit_progress(
                                &app_for_progress,
                                &format!("Downloading… {mb_done}/{mb_total} MB"),
                                Some(percent),
                            );
                        }
                    },
                    || {
                        eprintln!("[updater] download finished, installing");
                        updater_window::emit_progress(&app_for_progress, "Installing…", None);
                    },
                )
                .await;

            match result {
                Ok(_) => {
                    eprintln!("[updater] installed {version} — relaunching");
                    updater_window::emit_done(&app);
                    // Small delay so the user sees the completed state.
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    app.restart();
                    #[allow(unreachable_code)]
                    return true;
                }
                Err(e) => {
                    eprintln!("[updater] install failed: {e}");
                    updater_window::emit_error(&app, &e.to_string());
                }
            }
        }
        Ok(None) => {
            eprintln!("[updater] already up to date");
            updater_window::emit_version(&app, &current_version, None);
            updater_window::emit_no_update(&app);
        }
        Err(e) => {
            eprintln!("[updater] check failed: {e}");
            updater_window::emit_error(&app, &e.to_string());
        }
    }
    false
}

/// Build the main application window (called after the updater check completes).
fn build_main_window(app: &tauri::AppHandle) {
    if app.get_webview_window("main").is_some() {
        show_main_window(app);
        return;
    }

    let start_url: tauri::Url = format!("{APP_URL}{START_PATH}")
        .parse()
        .expect("valid start URL");

    let opener_handle = app.clone();
    let _ = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start_url))
        .title("SerikaCord")
        .inner_size(1280.0, 800.0)
        .min_inner_size(940.0, 500.0)
        .initialization_script(PRESENCE_REPORTER_JS)
        .initialization_script(DESKTOP_ENHANCEMENTS_JS)
        .on_download(|webview, event| {
            // Redirect downloads to the system Downloads directory.
            let app = webview.app_handle();
            if let Some(download_dir) = app.path().download_dir() {
                let filename = event
                    .url()
                    .split('?')
                    .next()
                    .and_then(|u| u.split('/').last())
                    .filter(|n| !n.is_empty())
                    .unwrap_or("download");
                let dest = download_dir.join(filename);
                event.set_destination(dest);
            }
            true
        })
        .on_navigation(move |url| {
            let target = url.as_str();
            let allowed =
                target.starts_with(APP_URL) || target.starts_with("http://localhost");
            if !allowed {
                let _ = opener_handle.opener().open_url(target, None::<&str>);
            }
            allowed
        })
        .build();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    // Work around `EGL_BAD_PARAMETER` / blank-window crashes on Linux caused by
    // newer webkit2gtk's DMABUF renderer (common on Arch, Nvidia, and some
    // Wayland setups). Must be set before the webview initialises.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            set_zoom,
            toggle_fullscreen,
            toggle_devtools,
            set_window_title,
            set_badge_count,
            is_muted,
            toggle_mute
        ])
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;

            // Show the updater splash window FIRST — before anything else.
            // This mirrors Discord's desktop updater: a small window appears,
            // checks for updates, and either installs them (with progress) or
            // proceeds to the main app.
            #[cfg(desktop)]
            {
                let _ = updater_window::create_updater_window(app.handle());
            }

            // Tray icon with enhanced menu; left-click toggles the window.
            let show_item = MenuItem::with_id(app, "show", "Open SerikaCord", true, None::<&str>)?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let update_item = MenuItem::with_id(app, "update", "Check for Updates…", true, None::<&str>)?;
            let mute_item = CheckMenuItem::with_id(app, "mute", "Mute Notifications", true, false)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(
                app,
                &[&show_item, &sep1, &update_item, &mute_item, &sep2, &quit_item],
            )?;

            // Store mute_item so we can toggle its checkmark from the handler.
            app.manage(std::sync::Mutex::new(mute_item));

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("SerikaCord")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    "update" => {
                        let _ = app
                            .opener()
                            .open_url("https://github.com/serika-dev/SerikaCord/releases", None::<&str>);
                    }
                    "mute" => {
                        let new = !MUTED.load(Ordering::SeqCst);
                        MUTED.store(new, Ordering::SeqCst);
                        // Update the checkmark.
                        let state = app.state::<std::sync::Mutex<CheckMenuItem>>();
                        if let Ok(item) = state.lock() {
                            let _ = item.set_checked(new);
                        }
                        // Mute/unmute all audio in the webview.
                        if let Some(window) = app.get_webview_window("main") {
                            let js = if new {
                                "document.querySelectorAll('audio,video').forEach(function(e){e.muted=true;e.volume=0;});"
                            } else {
                                "document.querySelectorAll('audio,video').forEach(function(e){e.muted=false;e.volume=1;});"
                            };
                            let _ = window.eval(js);
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                show_main_window(app);
                            }
                        }
                    }
                })
                .build(app)?;

            // Run the update check, then build the main window.
            // On non-desktop targets (mobile), skip straight to the main window.
            let handle = app.handle().clone();

            #[cfg(desktop)]
            {
                let presence_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let should_relaunch = run_update_check(handle.clone()).await;

                    if !should_relaunch {
                        // Small delay so the splash isn't visually jarring.
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        updater_window::close_updater_window(&handle);
                        build_main_window(&handle);
                        // Start presence detection only after the main window exists,
                        // so eval() calls reach __serikaSetActivities instead of
                        // being silently dropped.
                        presence::spawn_detection_loop(presence_handle);
                    }
                    // If should_relaunch is true, run_update_check already called
                    // app.restart() — we won't reach here.
                });
            }

            #[cfg(not(desktop))]
            {
                build_main_window(&handle);
                presence::spawn_detection_loop(app.handle().clone());
            }

            Ok(())
        })
        // Close-to-tray: closing the main window hides it, quit via the tray.
        // The updater window closes normally (no prevent).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SerikaCord");
}
