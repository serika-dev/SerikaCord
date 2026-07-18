// Rich-presence detection: enumerate running processes, match them against a
// curated table of games/apps (plus Steam's local library metadata), and push
// the current candidate into the web app (which is authenticated) so it can
// resolve names via the IGDB proxy and report to /api/users/me/rich-presence.
//
// The web app owns all HTTP: secrets never touch the client, and the HttpOnly
// `auth_token` cookie is sent automatically by the webview on same-origin fetch.
//
// Linux notes: process `name()` comes from /proc/<pid>/comm which the kernel
// truncates to 15 bytes, so long executables ("HollowKnight.x8..") are unusable
// on their own. We therefore prefer the executable path basename and the full
// argv. Steam launches games through a chain of wrappers (`reaper SteamLaunch
// AppId=<id> -- ...`) and Proton runs the Windows `.exe` under wine, so the
// most reliable signal is the `SteamAppId`/`SteamGameId` environment variable
// (set on the game and all its children) cross-referenced with Steam's local
// `appmanifest_*.acf` files, which give the real, human title regardless of how
// mangled the process name is.

use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, System};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DetectedActivity {
    /// "game" | "vscode" | "music" | "other"
    pub kind: String,
    /// A human search term (games are resolved to canonical names via IGDB).
    pub name: String,
    /// The matched executable basename (for debugging / de-duplication).
    pub exe: String,
    /// Steam AppId when this is a Steam game — lets the web app resolve the
    /// canonical English title/cover (the local manifest name is often
    /// localized, e.g. Chinese). Omitted (null) for non-Steam activities.
    #[serde(rename = "steamAppId", skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<String>,
}

/// Common non-game apps we recognise directly (no IGDB lookup).
///
/// Matching is on the EXACT executable basename (lowercased, `.exe` stripped),
/// not a substring, to avoid false positives from background helpers/language
/// servers that merely contain the word (e.g. the old `"code"` needle).
fn match_known_app(exe_lower: &str) -> Option<DetectedActivity> {
    // (exact executable names, display name, kind)
    let table: &[(&[&str], &str, &str)] = &[
        (&["code", "code-oss", "vscodium"], "Visual Studio Code", "vscode"),
        (&["code-insiders"], "VS Code Insiders", "vscode"),
        (&["rider64", "rider"], "JetBrains Rider", "vscode"),
        (&["idea64", "idea"], "IntelliJ IDEA", "vscode"),
        (&["pycharm64", "pycharm"], "PyCharm", "vscode"),
        (&["webstorm64", "webstorm"], "WebStorm", "vscode"),
        (&["clion64", "clion"], "CLion", "vscode"),
        // Windsurf was rebranded to "Devin Desktop" (Cognition). Detect both the
        // legacy and current executable names; keep the distinct labels/kinds.
        (&["windsurf"], "Windsurf", "windsurf"),
        (&["devin", "devin-desktop", "devindesktop"], "Devin Desktop", "devin"),
        (&["cursor"], "Cursor", "cursor"),
        (&["zed"], "Zed", "zed"),
        (&["claude"], "Claude Code", "claude"),
        (&["sublime_text"], "Sublime Text", "other"),
        (&["blender"], "Blender", "other"),
        (&["obs", "obs64"], "OBS Studio", "other"),
        (&["photoshop"], "Adobe Photoshop", "other"),
        (&["figma", "figma_agent"], "Figma", "other"),
        (&["unity", "unityhub"], "Unity", "other"),
        (&["unrealeditor"], "Unreal Engine", "other"),
        (&["godot"], "Godot Engine", "other"),
    ];
    for (names, display, kind) in table {
        if names.iter().any(|n| exe_lower == *n) {
            return Some(DetectedActivity {
                kind: (*kind).to_string(),
                name: (*display).to_string(),
                exe: exe_lower.to_string(),
                steam_app_id: None,
            });
        }
    }
    None
}

/// Known game executables → the search term to send to IGDB. This is only a
/// fallback for non-Steam launchers; anything installed through Steam is
/// resolved by its AppId against the local library metadata (much more robust).
/// Matched on the exact basename (with `.exe` stripped) OR as a substring for
/// the entries flagged below, to keep varied Proton exe names working.
fn match_known_game(exe_lower: &str) -> Option<DetectedActivity> {
    // (needle, display, substring?)
    let table: &[(&str, &str, bool)] = &[
        ("hades", "Hades", false),
        ("hades2", "Hades II", false),
        ("hollow_knight", "Hollow Knight", true),
        ("hollowknight", "Hollow Knight", true),
        ("hk_x64", "Hollow Knight", false),
        ("stardew", "Stardew Valley", true),
        ("stardewvalley", "Stardew Valley", true),
        ("factorio", "Factorio", true),
        ("terraria", "Terraria", true),
        ("re8", "Resident Evil Village", false),
        ("eldenring", "Elden Ring", true),
        ("cyberpunk2077", "Cyberpunk 2077", true),
        ("witcher3", "The Witcher 3: Wild Hunt", true),
        ("cs2", "Counter-Strike 2", false),
        ("valorant", "VALORANT", true),
        ("leagueclient", "League of Legends", true),
        ("league of legends", "League of Legends", true),
        ("dota2", "Dota 2", true),
        ("gta5", "Grand Theft Auto V", false),
        ("gtav", "Grand Theft Auto V", false),
        ("minecraft", "Minecraft", true),
        ("javaw", "Minecraft", false), // best-effort; often Minecraft on desktops
        ("celeste", "Celeste", true),
        ("balatro", "Balatro", true),
        ("deadcells", "Dead Cells", true),
        ("hoyoverse", "Genshin Impact", true),
        ("genshinimpact", "Genshin Impact", true),
        ("starrail", "Honkai: Star Rail", true),
        ("bluearchive", "Blue Archive", true),
        ("blue archive", "Blue Archive", true),
    ];
    for (needle, search, substring) in table {
        let hit = if *substring { exe_lower.contains(needle) } else { exe_lower == *needle };
        if hit {
            return Some(DetectedActivity {
                kind: "game".to_string(),
                name: (*search).to_string(),
                exe: exe_lower.to_string(),
                steam_app_id: None,
            });
        }
    }
    None
}

/// Wine/Proton and Steam runtime plumbing that should never be reported as the
/// game the user is playing. Matched against the `.exe`-stripped basename.
fn is_wine_system_process(exe_lower: &str) -> bool {
    const NOISE: &[&str] = &[
        "services", "winedevice", "plugplay", "explorer", "rpcss", "svchost",
        "conhost", "wineboot", "start", "cmd", "rundll32", "tabtip",
        "steamwebhelper", "gameoverlayui", "steamerrorreporter", "steam",
        "steamservice", "crashhandler", "reaper", "pv", "srt-bwrap",
        "proton", "python3", "python", "wine", "wine64", "wineserver",
        "wineconsole", "regedit", "msiexec", "iexplore", "dllhost",
        "vulkaninfo", "nvidia-smi", "gldriverquery", "vrcompositor",
        "steamtours", "originwebhelperservice", "easyanticheat", "battleye",
        "beservice", "ubisoftgamelauncher", "upc", "eabackgroundservice",
    ];
    NOISE.contains(&exe_lower)
}

/// Lowercased `.exe`-stripped basename of a path-like string.
fn basename_stem(s: &str) -> String {
    let base = s.rsplit(['/', '\\']).next().unwrap_or(s);
    let base = base.to_lowercase();
    base.strip_suffix(".exe").unwrap_or(&base).to_string()
}

// ── Steam library metadata ───────────────────────────────────────────────────
//
// Maps a Steam AppId → the game's real display name by reading the local
// `appmanifest_<id>.acf` files. This is what fixes "weird Proton titles": the
// running process may be `ShooterGame.exe`, but Steam knows it as "ARK".

/// Candidate Steam installation roots across the common layouts.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        for rel in [
            ".steam/steam",
            ".steam/root",
            ".local/share/Steam",
            ".var/app/com.valvesoftware.Steam/data/Steam", // Flatpak
            "snap/steam/common/.local/share/Steam",         // Snap
        ] {
            roots.push(home.join(rel));
        }
    }
    // Windows / other: Steam is usually reachable via env when installed.
    for var in ["STEAM_PATH", "ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(p) = std::env::var_os(var) {
            let base = PathBuf::from(p);
            roots.push(base.clone());
            roots.push(base.join("Steam"));
        }
    }
    roots
}

/// Extract every `"key"  "value"` pair whose key matches `key` from a VDF/ACF
/// blob. VDF is quote-delimited so we can parse it without a real grammar.
fn vdf_values<'a>(text: &'a str, key: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    for line in text.lines() {
        // A data line looks like:  \t\t"key"\t\t"value"
        let mut parts = line.split('"');
        // parts: ["\t\t", key, "\t\t", value, ""]
        let _lead = parts.next();
        if let (Some(k), Some(_sep), Some(v)) = (parts.next(), parts.next(), parts.next()) {
            if k == key {
                out.push(v);
            }
        }
    }
    out
}

/// All `steamapps` directories: every root's own plus the extra library folders
/// declared in `libraryfolders.vdf`.
fn steam_library_dirs() -> Vec<PathBuf> {
    let mut dirs: HashSet<PathBuf> = HashSet::new();
    for root in steam_roots() {
        let steamapps = root.join("steamapps");
        if steamapps.is_dir() {
            dirs.insert(steamapps);
        }
        // libraryfolders.vdf lives under steamapps/ (older) or config/ (newer).
        for vdf in [root.join("steamapps/libraryfolders.vdf"), root.join("config/libraryfolders.vdf")] {
            if let Ok(text) = fs::read_to_string(&vdf) {
                for path in vdf_values(&text, "path") {
                    let apps = Path::new(path).join("steamapps");
                    if apps.is_dir() {
                        dirs.insert(apps);
                    }
                }
            }
        }
    }
    dirs.into_iter().collect()
}

/// Build the AppId → display-name map from all discovered libraries.
fn build_steam_app_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    for dir in steam_library_dirs() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !name.starts_with("appmanifest_") || !name.ends_with(".acf") {
                continue;
            }
            let Ok(text) = fs::read_to_string(entry.path()) else { continue };
            let appid = vdf_values(&text, "appid").into_iter().next();
            let display = vdf_values(&text, "name").into_iter().next();
            if let (Some(id), Some(display)) = (appid, display) {
                map.insert(id.to_string(), display.to_string());
            }
        }
    }
    map
}

/// Cached Steam library map, rebuilt periodically so newly-installed games are
/// picked up without restarting the app.
struct SteamCache {
    map: HashMap<String, String>,
    refreshed: Instant,
}

impl SteamCache {
    fn new() -> Self {
        SteamCache { map: build_steam_app_map(), refreshed: Instant::now() }
    }
    fn get(&mut self) -> &HashMap<String, String> {
        if self.refreshed.elapsed() > Duration::from_secs(300) {
            self.map = build_steam_app_map();
            self.refreshed = Instant::now();
        }
        &self.map
    }
}

/// Pull a Steam AppId out of a process's environment (`SteamAppId=` /
/// `SteamGameId=`) or, failing that, its argv (`AppId=<id>` from the reaper
/// wrapper). Returns `None` for the Steam client itself (AppId 0).
fn steam_app_id(environ: &[String], cmd: &[String]) -> Option<String> {
    for var in environ {
        for prefix in ["SteamAppId=", "SteamGameId=", "STEAM_COMPAT_APP_ID="] {
            if let Some(id) = var.strip_prefix(prefix) {
                if !id.is_empty() && id != "0" {
                    return Some(id.to_string());
                }
            }
        }
    }
    for arg in cmd {
        if let Some(id) = arg.strip_prefix("AppId=") {
            if !id.is_empty() && id != "0" {
                return Some(id.to_string());
            }
        }
    }
    None
}

/// Best-effort executable basename for a process, preferring the real exe path
/// or argv[0] over the kernel-truncated `comm` name.
fn best_exe_stem(process: &sysinfo::Process) -> String {
    if let Some(exe) = process.exe() {
        if let Some(file) = exe.file_name() {
            return basename_stem(&file.to_string_lossy());
        }
    }
    if let Some(arg0) = process.cmd().first() {
        if !arg0.is_empty() {
            return basename_stem(arg0);
        }
    }
    basename_stem(process.name())
}

/// Scan all running processes and return every recognised activity.
fn detect(sys: &System, steam: &HashMap<String, String>) -> Vec<DetectedActivity> {
    let mut results: Vec<DetectedActivity> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    // Track Steam AppIds we've already reported so a game's many child processes
    // collapse into a single activity.
    let mut seen_appids: HashSet<String> = HashSet::new();

    for (_pid, process) in sys.processes() {
        // 1) Steam games: resolve the AppId to Steam's own title. This is the
        //    most reliable path and handles Proton/native alike.
        if let Some(appid) = steam_app_id(process.environ(), process.cmd()) {
            if seen_appids.contains(&appid) {
                continue;
            }
            if let Some(title) = steam.get(&appid) {
                seen_appids.insert(appid.clone());
                let key = format!("steam:{appid}");
                if seen.insert(key.clone()) {
                    results.push(DetectedActivity {
                        kind: "game".to_string(),
                        name: title.clone(),
                        exe: key,
                        steam_app_id: Some(appid.clone()),
                    });
                }
                continue;
            }
            // AppId present but no local manifest (e.g. running from a shortcut).
            // Fall through to name-based matching rather than dropping it.
        }

        let stem = best_exe_stem(process);
        if stem.is_empty() || seen.contains(&stem) {
            continue;
        }

        // 2) Known non-game apps (editors, creative tools, …).
        if let Some(app) = match_known_app(&stem) {
            seen.insert(stem);
            results.push(app);
            continue;
        }

        // 3) Ignore wine/steam plumbing before it can be mistaken for a game.
        if is_wine_system_process(&stem) {
            continue;
        }

        // 4) Known game executables (non-Steam launchers, Proton exe names).
        if let Some(game) = match_known_game(&stem) {
            seen.insert(stem);
            results.push(game);
        }
    }

    // Collapse duplicates that resolve to the same activity via different
    // executables (e.g. Devin's `devin` and `devin-desktop`).
    let mut seen_labels: HashSet<String> = HashSet::new();
    results.retain(|a| seen_labels.insert(format!("{}|{}", a.kind, a.name)));

    // Games take priority: they should lead the reported list so the web app
    // (which treats activities[0] as the primary status) surfaces what the user
    // is playing over an editor/IDE that happens to also be open. Stable sort
    // keeps discovery order within each group.
    results.sort_by_key(|a| if a.kind == "game" { 0 } else { 1 });
    results
}

/// Spawn the background detection loop. Emits `presence://detected` to the
/// webview whenever the detected activity changes (empty when nothing matches).
pub fn spawn_detection_loop(app: AppHandle) {
    thread::spawn(move || {
        let mut sys = System::new();
        let mut steam = SteamCache::new();
        let mut last: Vec<DetectedActivity> = Vec::new();

        loop {
            // IMPORTANT: the plain `refresh_processes()` does NOT load a
            // process's cmdline or environment on its own, so the Steam/Proton
            // AppId detection (which reads `SteamAppId`/`AppId=`) saw nothing.
            // `ProcessRefreshKind::everything()` forces cmd + environ to be read.
            sys.refresh_processes_specifics(ProcessRefreshKind::everything());
            let current = detect(&sys, steam.get());

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Live smoke test: runs the real detector against the current machine and
    /// prints what it finds. Not an assertion (CI has no games running); run
    /// locally with `cargo test -- --nocapture live_detection` to eyeball it.
    #[test]
    fn live_detection() {
        let map = build_steam_app_map();
        eprintln!("steam library entries: {}", map.len());
        let mut sys = System::new();
        sys.refresh_processes_specifics(ProcessRefreshKind::everything());
        let found = detect(&sys, &map);
        eprintln!("detected {} activities:", found.len());
        for a in &found {
            eprintln!("  [{}] {} ({})", a.kind, a.name, a.exe);
        }
        // Any game present must sort ahead of every non-game entry.
        let last_game = found.iter().rposition(|a| a.kind == "game");
        let first_non_game = found.iter().position(|a| a.kind != "game");
        if let (Some(lg), Some(fng)) = (last_game, first_non_game) {
            assert!(lg < fng, "games must be ordered before non-games");
        }
    }
}
