// Rich-presence detection: enumerate running processes, match them against a
// curated table of games/apps, and push the current candidate into the web app
// (which is authenticated) so it can resolve names via the IGDB proxy and report
// to /api/users/me/rich-presence.
//
// The web app owns all HTTP: secrets never touch the client, and the HttpOnly
// `auth_token` cookie is sent automatically by the webview on same-origin fetch.

use std::{collections::HashSet, thread, time::Duration};

use serde::Serialize;
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DetectedActivity {
    /// "game" | "vscode" | "music" | "other"
    pub kind: String,
    /// A human search term (games are resolved to canonical names via IGDB).
    pub name: String,
    /// The matched executable basename (for debugging / de-duplication).
    pub exe: String,
}

/// Common non-game apps we recognise directly (no IGDB lookup).
/// key = lowercased executable basename (without extension when helpful).
fn match_known_app(exe_lower: &str) -> Option<DetectedActivity> {
    let table: &[(&str, &str, &str)] = &[
        // exe contains, display name, kind
        ("code", "Visual Studio Code", "vscode"),
        ("code-insiders", "VS Code Insiders", "vscode"),
        ("rider64", "JetBrains Rider", "vscode"),
        ("idea64", "IntelliJ IDEA", "vscode"),
        ("pycharm64", "PyCharm", "vscode"),
        ("webstorm64", "WebStorm", "vscode"),
        ("clion64", "CLion", "vscode"),
        ("windsurf", "Windsurf", "windsurf"),
        ("cursor", "Cursor", "cursor"),
        ("zed", "Zed", "zed"),
        ("claude", "Claude Code", "claude"),
        ("sublime_text", "Sublime Text", "other"),
        ("blender", "Blender", "other"),
        ("obs", "OBS Studio", "other"),
        ("photoshop", "Adobe Photoshop", "other"),
        ("figma", "Figma", "other"),
        ("unity", "Unity", "other"),
        ("unrealeditor", "Unreal Engine", "other"),
        ("godot", "Godot Engine", "other"),
    ];
    for (needle, display, kind) in table {
        if exe_lower.contains(needle) {
            return Some(DetectedActivity {
                kind: (*kind).to_string(),
                name: (*display).to_string(),
                exe: exe_lower.to_string(),
            });
        }
    }
    None
}

/// Known game executables → the search term to send to IGDB. Extend freely.
fn match_known_game(exe_lower: &str) -> Option<DetectedActivity> {
    let table: &[(&str, &str)] = &[
        ("hades", "Hades"),
        ("hades2", "Hades II"),
        ("hollow_knight", "Hollow Knight"),
        ("hk_x64", "Hollow Knight"),
        ("stardew", "Stardew Valley"),
        ("factorio", "Factorio"),
        ("terraria", "Terraria"),
        ("re8", "Resident Evil Village"),
        ("eldenring", "Elden Ring"),
        ("cyberpunk2077", "Cyberpunk 2077"),
        ("witcher3", "The Witcher 3: Wild Hunt"),
        ("cs2", "Counter-Strike 2"),
        ("valorant", "VALORANT"),
        ("leagueclient", "League of Legends"),
        ("league of legends", "League of Legends"),
        ("dota2", "Dota 2"),
        ("gta5", "Grand Theft Auto V"),
        ("gtav", "Grand Theft Auto V"),
        ("minecraft", "Minecraft"),
        ("javaw", "Minecraft"), // best-effort; often Minecraft on desktops
        ("celeste", "Celeste"),
        ("balatro", "Balatro"),
        ("deadcells", "Dead Cells"),
        ("hoyoverse", "Genshin Impact"),
        ("genshinimpact", "Genshin Impact"),
        ("starrail", "Honkai: Star Rail"),
    ];
    for (needle, search) in table {
        if exe_lower.contains(needle) {
            return Some(DetectedActivity {
                kind: "game".to_string(),
                name: (*search).to_string(),
                exe: exe_lower.to_string(),
            });
        }
    }
    None
}

/// Scan all running processes and return every recognised activity.
fn detect(sys: &System) -> Vec<DetectedActivity> {
    let mut results: Vec<DetectedActivity> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for (_pid, process) in sys.processes() {
        let name = process.name().to_lowercase();
        let exe_lower = name.trim_end_matches(".exe").to_string();
        if seen.contains(&exe_lower) {
            continue;
        }
        if let Some(game) = match_known_game(&exe_lower) {
            seen.insert(exe_lower);
            results.push(game);
            continue;
        }
        if let Some(app) = match_known_app(&exe_lower) {
            seen.insert(exe_lower);
            results.push(app);
        }
    }
    results
}

/// Spawn the background detection loop. Emits `presence://detected` to the
/// webview whenever the detected activity changes (null when nothing matches).
pub fn spawn_detection_loop(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut last: Vec<DetectedActivity> = Vec::new();

        loop {
            sys.refresh_processes();
            let current = detect(&sys);

            if current != last {
                last = current.clone();
                // Push into the authenticated page. It handles IGDB resolution
                // (via /api/igdb/game) and posting to /api/users/me/rich-presence.
                let _ = app.emit("presence://detected", &current);
                if let Some(window) = app.get_webview_window("main") {
                    let payload = serde_json::to_string(&current).unwrap_or_else(|_| "[]".into());
                    let _ = window.eval(&format!("window.__serikaSetActivities && window.__serikaSetActivities({payload});"));
                }
            }

            thread::sleep(Duration::from_secs(15));
        }
    });
}
