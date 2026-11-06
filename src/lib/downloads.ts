// Picks the download files for each platform out of a GitHub release, so the
// download page links straight to the newest build of each app. The Qt desktop
// app's files win over the older Tauri ones when both are in the release.

export const RELEASES_URL = "https://github.com/serika-dev/SerikaCord/releases";
export const LATEST_RELEASE_URL = `${RELEASES_URL}/latest`;
/** The iPhone and iPad app (no country in the path, so the store picks the visitor's). */
export const APP_STORE_URL = "https://apps.apple.com/app/serikacord/id6828383613";

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

export interface DownloadFile {
  /** Short format label, e.g. "AppImage" or ".deb". */
  label: string;
  name: string;
  url: string;
  size: number;
}

export interface PlatformDownloads {
  windows: DownloadFile[];
  mac: DownloadFile[];
  linux: DownloadFile[];
  android: DownloadFile[];
}

export interface ReleaseInfo {
  version: string | null;
  publishedAt: string | null;
  pageUrl: string;
  downloads: PlatformDownloads;
}

// In order of preference; the first rule that matches a file wins for that label.
const RULES: Array<{ platform: keyof PlatformDownloads; label: string; patterns: RegExp[] }> = [
  { platform: "windows", label: "Installer", patterns: [/-qt-windows-setup\.exe$/i, /x64-setup\.exe$/i, /setup.*\.exe$/i] },
  { platform: "windows", label: ".zip", patterns: [/-qt-windows\.zip$/i] },
  { platform: "windows", label: ".msi", patterns: [/\.msi$/i] },
  { platform: "mac", label: ".dmg", patterns: [/-qt\.dmg$/i, /\.dmg$/i] },
  { platform: "linux", label: "AppImage", patterns: [/-qt\.AppImage$/i, /\.AppImage$/i] },
  { platform: "linux", label: ".deb", patterns: [/^serikacord-qt_.*\.deb$/i, /\.deb$/i] },
  { platform: "linux", label: ".rpm", patterns: [/\.rpm$/i] },
  { platform: "android", label: "APK", patterns: [/\.apk$/i] },
];

/** Map a release's files to per-platform downloads (signatures and update manifests are skipped). */
export function pickDownloads(assets: ReleaseAsset[]): PlatformDownloads {
  const files = assets.filter((a) => !/\.(sig|asc|json|tar\.gz)$/i.test(a.name));
  const out: PlatformDownloads = { windows: [], mac: [], linux: [], android: [] };
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      const hit = files.find((f) => pattern.test(f.name));
      if (hit) {
        out[rule.platform].push({ label: rule.label, name: hit.name, url: hit.url, size: hit.size });
        break;
      }
    }
  }
  return out;
}

/** "86.4 MB" */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Latest SerikaCord release from GitHub (cached by Next for 10 minutes). Never throws. */
export async function getLatestRelease(): Promise<ReleaseInfo> {
  const empty: ReleaseInfo = {
    version: null,
    publishedAt: null,
    pageUrl: LATEST_RELEASE_URL,
    downloads: { windows: [], mac: [], linux: [], android: [] },
  };
  try {
    const res = await fetch("https://api.github.com/repos/serika-dev/SerikaCord/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "SerikaCord-download-page" },
      next: { revalidate: 600 },
    });
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      tag_name?: string;
      published_at?: string;
      html_url?: string;
      assets?: Array<{ name: string; browser_download_url: string; size: number }>;
    };
    return {
      version: data.tag_name?.replace(/^v/, "") ?? null,
      publishedAt: data.published_at ?? null,
      pageUrl: data.html_url || LATEST_RELEASE_URL,
      downloads: pickDownloads(
        (data.assets ?? []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })),
      ),
    };
  } catch {
    return empty;
  }
}
