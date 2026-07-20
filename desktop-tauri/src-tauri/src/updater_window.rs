// Updater splash window — shown on startup before the main window.
//
// Displays a small branded "Checking for updates…" window (like Discord's
// updater). If an update is found, the progress bar fills as it downloads;
// once installed the app relaunches. If no update (or error), the splash
// closes and the main window appears.
//
// The HTML is inlined as a data URL so it works offline and doesn't need a
// separate file shipped with the bundle.

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// HTML for the updater splash window. Communicates with Rust via Tauri
/// events (`updater://progress`, `updater://done`, `updater://error`).
const UPDATER_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SerikaCord</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #0c0c10; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    user-select: none; -webkit-user-select: none;
  }
  .container {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; gap: 16px; padding: 24px;
  }
  .logo {
    width: 56px; height: 56px; border-radius: 14px;
    background: linear-gradient(135deg, #8B5CF6, #6366f1);
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 800; color: #fff;
    box-shadow: 0 4px 24px rgba(139, 92, 246, 0.3);
  }
  .title { font-size: 15px; font-weight: 600; color: #e0e0e8; }
  .version { font-size: 11px; color: #6b6b80; }
  .status { font-size: 12px; color: #9a9aad; text-align: center; min-height: 16px; }
  .bar-bg {
    width: 220px; height: 4px; border-radius: 2px;
    background: rgba(255,255,255,0.08); overflow: hidden;
  }
  .bar-fill {
    height: 100%; width: 0%; border-radius: 2px;
    background: linear-gradient(90deg, #8B5CF6, #6366f1);
    transition: width 0.3s ease;
  }
  .bar-fill.indeterminate {
    width: 30%; animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    0% { margin-left: -30%; }
    100% { margin-left: 100%; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="logo">S</div>
  <div class="title" id="title">SerikaCord</div>
  <div class="version" id="version"></div>
  <div class="status" id="status">Checking for updates…</div>
  <div class="bar-bg"><div class="bar-fill indeterminate" id="bar"></div></div>
</div>
<script>
  const { invoke } = window.__TAURI__ || {};
  const statusEl = document.getElementById('status');
  const barEl = document.getElementById('bar');
  const titleEl = document.getElementById('title');
  const versionEl = document.getElementById('version');

  // Listen for progress events from Rust.
  // We use the Tauri event listener if available, otherwise poll a global.
  function setupListener() {
    if (window.__TAURI__ && window.__TAURI__.event && window.__TAURI__.event.listen) {
      window.__TAURI__.event.listen('updater://version', (e) => {
        const d = e.payload || {};
        if (d.current && d.newVersion) {
          versionEl.textContent = d.current + ' → ' + d.newVersion;
        } else if (d.current) {
          versionEl.textContent = 'v' + d.current;
        }
      });
      window.__TAURI__.event.listen('updater://progress', (e) => {
        const d = e.payload || {};
        if (d.message) statusEl.textContent = d.message;
        if (d.percent != null) {
          barEl.classList.remove('indeterminate');
          barEl.style.width = d.percent + '%';
        }
      });
      window.__TAURI__.event.listen('updater://done', (e) => {
        statusEl.textContent = 'Update installed — restarting…';
        barEl.classList.remove('indeterminate');
        barEl.style.width = '100%';
      });
      window.__TAURI__.event.listen('updater://error', (e) => {
        // Non-fatal: the main window will open anyway.
        statusEl.textContent = 'Starting SerikaCord…';
      });
      window.__TAURI__.event.listen('updater://no-update', (e) => {
        statusEl.textContent = 'Starting SerikaCord…';
      });
    } else {
      // Fallback: poll a global variable set via eval().
      setInterval(function() {
        var s = window.__serikaUpdaterState;
        if (!s) return;
        if (s.message) statusEl.textContent = s.message;
        if (s.percent != null) {
          barEl.classList.remove('indeterminate');
          barEl.style.width = s.percent + '%';
        }
        if (s.versionText) versionEl.textContent = s.versionText;
      }, 200);
    }
  }
  setupListener();
</script>
</body>
</html>"#;

/// Build the data: URL for the updater HTML.
fn updater_data_url() -> String {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(UPDATER_HTML.as_bytes());
    format!("data:text/html;base64,{encoded}")
}

/// Create and show the updater splash window.
pub fn create_updater_window(app: &AppHandle) -> tauri::Result<()> {
    // Don't recreate if it already exists (e.g. second instance).
    if app.get_webview_window("updater").is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        "updater",
        WebviewUrl::App(updater_data_url().into()),
    )
    .title("SerikaCord")
    .inner_size(360.0, 220.0)
    .resizable(false)
    .minimizable(false)
    .maximizable(false)
    .decorations(false)
    .center()
    .always_on_top(true)
    // Keep it in the taskbar/dock and give it focus so Linux window managers
    // (which frequently ignore `always_on_top` for a decorationless, unfocused
    // window) actually raise it above every other app instead of hiding it.
    .skip_taskbar(false)
    .focused(true)
    .visible(true)
    .build()?;

    // Belt-and-braces raise for Linux: `always_on_top` alone doesn't guarantee
    // the splash is brought to the front on X11/Wayland — explicitly show, raise
    // via a momentary always-on-top toggle, and grab focus.
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();

    Ok(())
}

/// Close the updater window (called when no update is needed or after install).
pub fn close_updater_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.close();
    }
}

/// Emit a progress event to the updater window.
pub fn emit_progress(app: &AppHandle, message: &str, percent: Option<f64>) {
    let _ = app.emit("updater://progress", serde_json::json!({
        "message": message,
        "percent": percent,
    }));
    // Also set a global as fallback for when the Tauri event API isn't available
    // in the data-URL webview.
    if let Some(window) = app.get_webview_window("updater") {
        let msg = message.replace('\'', "\\'");
        let pct = percent.map(|p| p.to_string()).unwrap_or("null".to_string());
        let _ = window.eval(&format!(
            "window.__serikaUpdaterState = {{ message: '{}', percent: {} }};",
            msg, pct
        ));
    }
}

/// Emit a "done" event.
pub fn emit_done(app: &AppHandle) {
    let _ = app.emit("updater://done", ());
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.eval("window.__serikaUpdaterState = { message: 'Update installed — restarting…', percent: 100 };");
    }
}

/// Emit a "no update" event.
pub fn emit_no_update(app: &AppHandle) {
    let _ = app.emit("updater://no-update", ());
    if let Some(window) = app.get_webview_window("updater") {
        let _ = window.eval("window.__serikaUpdaterState = { message: 'Starting SerikaCord…' };");
    }
}

/// Emit an error event (non-fatal — main window will still open).
pub fn emit_error(app: &AppHandle, msg: &str) {
    let _ = app.emit("updater://error", serde_json::json!({ "error": msg }));
    if let Some(window) = app.get_webview_window("updater") {
        let _msg = msg.replace('\'', "\\'");
        let _ = window.eval(&format!(
            "window.__serikaUpdaterState = {{ message: 'Starting SerikaCord…' }};"
        ));
    }
}

/// Emit version info to the updater splash window.
pub fn emit_version(app: &AppHandle, current: &str, new_version: Option<&str>) {
    let _ = app.emit("updater://version", serde_json::json!({
        "current": current,
        "newVersion": new_version,
    }));
    if let Some(window) = app.get_webview_window("updater") {
        let cur = current.replace('\'', "\\'");
        let text = if let Some(nv) = new_version {
            let nv_escaped = nv.replace('\'', "\\'");
            format!("{} → {}", cur, nv_escaped)
        } else {
            format!("v{}", cur)
        };
        let _ = window.eval(&format!(
            "window.__serikaUpdaterState = window.__serikaUpdaterState || {{}}; window.__serikaUpdaterState.versionText = '{}';",
            text
        ));
    }
}
