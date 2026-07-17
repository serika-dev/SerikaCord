// SerikaCord native desktop shell (Tauri v2).
// Loads the hosted web app and provides the desktop niceties the old
// Electron wrapper had: tray icon, close-to-tray, single instance,
// serikacord:// deep links, and external links opening in the browser.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod presence;

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
          var res = await api('/api/igdb/game?name=' + encodeURIComponent(activity.name));
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

            let start_url: tauri::Url = format!("{APP_URL}{START_PATH}")
                .parse()
                .expect("valid start URL");

            // Links outside the app (and localhost during development) open
            // in the system browser instead of navigating the app window.
            let opener_handle = app.handle().clone();
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(start_url))
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
                .build()?;

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

            // Start background game/app detection → reports via the web app.
            presence::spawn_detection_loop(app.handle().clone());

            Ok(())
        })
        // Close-to-tray: closing the window hides it, quit via the tray menu.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SerikaCord");
}
