// SerikaCord native desktop shell (Tauri v2).
// Loads the hosted web app and provides the desktop niceties the old
// Electron wrapper had: tray icon, close-to-tray, single instance,
// serikacord:// deep links, and external links opening in the browser.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod presence;
mod updater_window;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const APP_URL: &str = "https://serika.chat";
const START_PATH: &str = "/channels/me";

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

    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            eprintln!("[updater] update available: {version} — downloading");
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

            // Tray icon with Open/Quit; left-click toggles the window.
            let show_item = MenuItem::with_id(app, "show", "Open SerikaCord", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("SerikaCord")
                .menu(&tray_menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
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
