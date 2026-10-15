"use client";

import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { useGT } from "gt-next";
import {
  ArrowRight,
  Bell,
  Download,
  ExternalLink,
  Globe,
  Hash,
  MessagesSquare,
  Mic,
  Search,
  Smartphone,
  Volume2,
} from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { formatSize, type DownloadFile, type PlatformDownloads, type ReleaseInfo } from "@/lib/downloads";

type Platform = keyof PlatformDownloads;
type Detected = Platform | "ios" | "unknown";

function detectPlatform(): Detected {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/windows/.test(ua)) return "windows";
  if (/mac os|macintosh/.test(ua)) return "mac";
  if (/linux|x11|cros/.test(ua)) return "linux";
  return "unknown";
}

const noopSubscribe = () => () => {};

// ─── Platform marks (simple, single-colour) ──────────────────────────────────
function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 5.1 10.4 4v7.2H3zM11.4 3.9 21 2.5v8.7h-9.6zM3 12.2h7.4v7.2L3 18.3zM11.4 12.2H21v8.8l-9.6-1.4z" />
    </svg>
  );
}
function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.8C6.1 7 4.5 8 3.7 9.6c-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.9-1.1-2.9-4.2zM14 5.3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}
function LinuxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2c-2.2 0-3.6 1.9-3.6 4.5 0 1.2.2 2-.4 3.1-.8 1.4-2.6 3.6-2.9 6.2-.1 1 .2 1.6.7 2.1-.6.4-1.5.7-1.4 1.6.1.9 1.3 1 2.6 1.5 1.1.4 1.9 1 2.8 1 .8 0 1.3-.5 1.6-1h1.2c.3.5.8 1 1.6 1 .9 0 1.7-.6 2.8-1 1.3-.5 2.5-.6 2.6-1.5.1-.9-.8-1.2-1.4-1.6.5-.5.8-1.1.7-2.1-.3-2.6-2.1-4.8-2.9-6.2-.6-1.1-.4-1.9-.4-3.1C15.6 3.9 14.2 2 12 2zm-1.5 3.6c.5 0 .8.6.8 1.2s-.3 1-.6 1.1l-.3-.1c-.3-.1-.6-.5-.6-1 0-.7.3-1.2.7-1.2zm3 0c.4 0 .7.5.7 1.2 0 .5-.3.9-.6 1l-.3.1c-.3-.1-.6-.5-.6-1.1s.3-1.2.8-1.2zM12 8.3c.8 0 2 .5 2 .9 0 .3-1.2 1.2-2 1.2s-2-.9-2-1.2c0-.4 1.2-.9 2-.9zm-2.2 3.3c.6.4 1.4.7 2.2.7s1.6-.3 2.2-.7c.8 1.2 1.6 2.6 1.6 4.2 0 1.9-1.6 3-3.8 3s-3.8-1.1-3.8-3c0-1.6.8-3 1.6-4.2z" />
    </svg>
  );
}
function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.5 9.6 19.3 6.5a.4.4 0 0 0-.7-.4l-1.8 3.1A10.8 10.8 0 0 0 12 8.2c-1.7 0-3.3.4-4.8 1L5.4 6.1a.4.4 0 0 0-.7.4l1.8 3.1C3.5 11.2 1.5 14.2 1.2 17.8h21.6c-.3-3.6-2.3-6.6-5.3-8.2zM7 15.1a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  );
}

const MARKS: Record<Platform, (p: { className?: string }) => ReactNode> = {
  windows: WindowsMark,
  mac: AppleMark,
  linux: LinuxMark,
  android: AndroidMark,
};

// ─── Small CSS mock of the app, so the hero shows what you're downloading ────
function AppMock() {
  const rows = [
    { w: "w-3/4", accent: false },
    { w: "w-1/2", accent: true },
    { w: "w-2/3", accent: false },
    { w: "w-5/12", accent: false },
  ];
  return (
    <div className="relative mx-auto w-full max-w-[560px]" aria-hidden>
      <div className="absolute -inset-6 rounded-[32px] bg-[#8B5CF6]/20 blur-3xl" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b10] shadow-2xl shadow-black/60">
        <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-3 text-[11px] font-medium text-white/40">SerikaCord</span>
        </div>
        <div className="flex h-[300px] sm:h-[320px]">
          <div className="flex w-12 flex-col items-center gap-2 bg-[#07070a] py-3">
            <div className="h-8 w-8 rounded-xl bg-[#8B5CF6]" />
            <div className="h-px w-6 bg-white/10" />
            {["bg-[#f472b6]", "bg-[#38bdf8]", "bg-[#facc15]", "bg-[#34d399]"].map((c) => (
              <div key={c} className={cn("h-8 w-8 rounded-full opacity-80", c)} />
            ))}
          </div>
          <div className="hidden w-40 flex-col gap-1 bg-[#0e0e14] p-3 sm:flex">
            <div className="mb-2 h-3 w-24 rounded bg-white/20" />
            {["general", "memes", "music", "gaming"].map((n, i) => (
              <div
                key={n}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]",
                  i === 0 ? "bg-white/[0.08] text-white" : "text-white/40",
                )}
              >
                <Hash className="h-3 w-3" />
                {n}
              </div>
            ))}
            <div className="mt-2 flex items-center gap-1.5 px-2 py-1 text-[11px] text-white/40">
              <Volume2 className="h-3 w-3" /> Lounge
            </div>
            <div className="ml-5 flex items-center gap-1.5 text-[10px] text-white/50">
              <span className="h-4 w-4 rounded-full bg-[#f472b6] ring-2 ring-[#23a55a]" /> Serika
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-end gap-3 p-4">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2.5">
                <div className={cn("h-8 w-8 shrink-0 rounded-full", r.accent ? "bg-[#8B5CF6]" : "bg-white/15")} />
                <div className="flex flex-1 flex-col gap-1.5 pt-0.5">
                  <div className={cn("h-2.5 w-16 rounded", r.accent ? "bg-[#a78bfa]" : "bg-white/30")} />
                  <div className={cn("h-2.5 rounded bg-white/10", r.w)} />
                </div>
              </div>
            ))}
            <div className="mt-1 h-9 rounded-lg bg-white/[0.06]" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default function DownloadClient({ release }: { release: ReleaseInfo }) {
  const gt = useGT();
  const detected = useSyncExternalStore<Detected>(noopSubscribe, detectPlatform, () => "unknown");

  // Product names are never translated (gt() turned "Windows" into "Ramen" in Dutch).
  const names: Record<Platform, string> = {
    windows: "Windows",
    mac: "macOS",
    linux: "Linux",
    android: "Android",
  };
  const requirements: Record<Platform, string> = {
    windows: gt("Windows 10 or newer, 64-bit"),
    mac: gt("macOS 12 or newer, Apple silicon"),
    linux: gt("64-bit, most distributions"),
    android: gt("Android 6.0 or newer"),
  };

  const primaryPlatform: Platform | null =
    detected === "windows" || detected === "mac" || detected === "linux" || detected === "android" ? detected : null;
  const primaryFile: DownloadFile | undefined = primaryPlatform ? release.downloads[primaryPlatform][0] : undefined;
  const version = release.version;

  const heroTitle =
    primaryPlatform === "windows"
      ? gt("SerikaCord for Windows")
      : primaryPlatform === "mac"
        ? gt("SerikaCord for macOS")
        : primaryPlatform === "linux"
          ? gt("SerikaCord for Linux")
          : primaryPlatform === "android"
            ? gt("SerikaCord for Android")
            : gt("Get SerikaCord");

  const highlights = [
    { icon: Bell, title: gt("Native notifications"), text: gt("System notifications with avatars, unread badges on the taskbar, dock and tray.") },
    { icon: Mic, title: gt("Push to talk anywhere"), text: gt("Mute, deafen and push to talk work while the app is in the background.") },
    { icon: MessagesSquare, title: gt("Threads and polls"), text: gt("Side conversations, live polls and forwarding, right in the chat.") },
    { icon: Search, title: gt("Search everything"), text: gt("Every message in a server or DM, with filters, back to the very first one.") },
  ];

  const platforms: Platform[] = ["windows", "mac", "linux", "android"];

  return (
    <div className="min-h-screen overflow-x-hidden bg-black text-white">
      {/* Navigation */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.05] bg-black/70 backdrop-blur-2xl">
        <div className="mx-auto flex h-[60px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-10">
          <Link href="/" className="shrink-0" aria-label={gt("SerikaCord home")}>
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/changelog"
              className="hidden rounded-lg px-3 py-1.5 text-sm text-[#999] transition-colors hover:bg-white/5 hover:text-white sm:block"
            >
              {gt("What's new")}
            </Link>
            <Link
              href="/channels/me"
              className="rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-black transition-transform hover:scale-[1.03]"
            >
              {gt("Open SerikaCord")}
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative px-4 pb-20 pt-28 sm:px-6 sm:pt-36 lg:px-10">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-60 -top-40 h-[700px] w-[700px] rounded-full bg-[#4c1d95]/30 blur-[140px]" />
          <div className="absolute -right-60 top-40 h-[600px] w-[700px] rounded-full bg-[#312e81]/25 blur-[140px]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
          <div className="text-center lg:text-left">
            {version && (
              <Link
                href="/changelog"
                className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/10 px-3 py-1 text-xs font-semibold text-[#c4b5fd] transition-colors hover:bg-[#8B5CF6]/20"
              >
                {gt("Version {version} is here", { version })}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
            <h1 className="mb-5 text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">
              {heroTitle}
            </h1>
            <p className="mx-auto mb-9 max-w-md text-lg font-medium leading-relaxed text-[#9a9aa6] lg:mx-0">
              {gt("Chat, call and hang out with your friends and communities, with native notifications and everything working in the background.")}
            </p>

            <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start">
              {primaryFile && primaryPlatform ? (
                <a
                  href={primaryFile.url}
                  className="group inline-flex items-center gap-3 rounded-full bg-[#8B5CF6] px-7 py-4 text-base font-bold text-white shadow-lg shadow-[#8B5CF6]/30 transition-all hover:scale-[1.03] hover:bg-[#7c4dff]"
                >
                  <Download className="h-5 w-5" />
                  {gt("Download for {platform}", { platform: names[primaryPlatform] })}
                </a>
              ) : detected === "ios" ? (
                <Link
                  href="/channels/me"
                  className="inline-flex items-center gap-3 rounded-full bg-[#8B5CF6] px-7 py-4 text-base font-bold text-white shadow-lg shadow-[#8B5CF6]/30 transition-all hover:scale-[1.03] hover:bg-[#7c4dff]"
                >
                  <Globe className="h-5 w-5" />
                  {gt("Open in Safari")}
                </Link>
              ) : (
                <a
                  href="#platforms"
                  className="inline-flex items-center gap-3 rounded-full bg-[#8B5CF6] px-7 py-4 text-base font-bold text-white shadow-lg shadow-[#8B5CF6]/30 transition-all hover:scale-[1.03] hover:bg-[#7c4dff]"
                >
                  <Download className="h-5 w-5" />
                  {gt("Choose your platform")}
                </a>
              )}
              <Link
                href="/channels/me"
                className="inline-flex items-center gap-2 rounded-full border border-white/15 px-6 py-4 text-base font-semibold text-white/90 transition-colors hover:bg-white/5"
              >
                {gt("Open in your browser")}
              </Link>
            </div>

            <p className="mt-4 text-sm text-[#6e6e7a]">
              {primaryFile && primaryPlatform
                ? [
                    version ? gt("Version {version}", { version }) : null,
                    primaryFile.label,
                    formatSize(primaryFile.size),
                    requirements[primaryPlatform],
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : detected === "ios"
                  ? gt("No iPhone app yet: open SerikaCord in Safari and choose Add to Home Screen.")
                  : gt("Free for Windows, macOS, Linux and Android.")}
            </p>
          </div>

          <AppMock />
        </div>
      </section>

      {/* All platforms */}
      <section id="platforms" className="scroll-mt-20 px-4 pb-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-2 text-center text-3xl font-bold sm:text-4xl">{gt("Available everywhere")}</h2>
          <p className="mb-10 text-center text-[#8a8a96]">
            {gt("Your messages, calls and settings follow you to every device.")}
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((p) => {
              const Mark = MARKS[p];
              const files = release.downloads[p];
              const [main, ...alts] = files;
              const isYours = p === primaryPlatform;
              return (
                <div
                  key={p}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-[#0a0a0f] p-6 transition-colors",
                    isYours ? "border-[#8B5CF6]/50 bg-[#110d1c]" : "border-white/[0.07] hover:border-white/15",
                  )}
                >
                  {isYours && (
                    <span className="absolute right-4 top-4 rounded-full bg-[#8B5CF6]/20 px-2 py-0.5 text-[11px] font-semibold text-[#c4b5fd]">
                      {gt("Your device")}
                    </span>
                  )}
                  <Mark className="mb-5 h-9 w-9 text-white" />
                  <h3 className="text-lg font-bold">{names[p]}</h3>
                  <p className="mb-6 mt-1 text-sm text-[#7a7a86]">{requirements[p]}</p>

                  <div className="mt-auto">
                    {main ? (
                      <>
                        <a
                          href={main.url}
                          className={cn(
                            "flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors",
                            isYours ? "bg-[#8B5CF6] text-white hover:bg-[#7c4dff]" : "bg-white/[0.08] text-white hover:bg-white/[0.14]",
                          )}
                        >
                          <Download className="h-4 w-4" />
                          {gt("Download {format}", { format: main.label })}
                        </a>
                        <p className="mt-2 text-center text-xs text-[#5f5f6b]">{formatSize(main.size)}</p>
                        {/* Always reserve this row so the buttons line up across cards. */}
                        <div className="mt-3 flex min-h-[2.25rem] flex-wrap justify-center gap-x-3 gap-y-1 border-t border-white/[0.06] pt-3">
                          {alts.length === 0 ? (
                            <span className="text-xs text-[#4f4f5a]">{main.label}</span>
                          ) : (
                            alts.map((f) => (
                              <a
                                key={f.name}
                                href={f.url}
                                className="text-xs font-medium text-[#a78bfa] hover:text-[#c4b5fd] hover:underline"
                                title={f.name}
                              >
                                {f.label}
                              </a>
                            ))
                          )}
                        </div>
                      </>
                    ) : (
                      <a
                        href={release.pageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.05] px-4 py-2.5 text-sm font-semibold text-white/70 transition-colors hover:bg-white/[0.1]"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {gt("See releases")}
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Releases before 2.0 were each signed with a throwaway key, so Android
              refuses to install over them once ("conflicts with an existing package"). */}
          <p className="mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-[#7a7a86]">
            {gt("Android: if installing says the app conflicts with an existing package, uninstall the old SerikaCord app once and install again. Versions before 2.0 were signed differently; updates install normally after that.")}
          </p>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#0a0a0f] px-6 py-5 sm:flex-row">
            <div className="flex items-center gap-3">
              <Smartphone className="h-6 w-6 shrink-0 text-white/70" />
              <div>
                <p className="font-semibold">{gt("iPhone and iPad")}</p>
                <p className="text-sm text-[#7a7a86]">
                  {gt("Open SerikaCord in Safari, tap Share and choose Add to Home Screen.")}
                </p>
              </div>
            </div>
            <Link
              href="/channels/me"
              className="shrink-0 rounded-xl bg-white/[0.08] px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/[0.14]"
            >
              {gt("Open in browser")}
            </Link>
          </div>
        </div>
      </section>

      {/* Highlights */}
      <section className="border-t border-white/[0.05] bg-[#050507] px-4 py-20 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-10 text-center text-3xl font-bold sm:text-4xl">{gt("Better in the app")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {highlights.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-2xl border border-white/[0.06] bg-[#0a0a0f] p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[#8B5CF6]/20 bg-[#8B5CF6]/10">
                  <Icon className="h-5 w-5 text-[#a78bfa]" />
                </div>
                <h3 className="mb-1.5 font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-[#7a7a86]">{text}</p>
              </div>
            ))}
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <Link href="/changelog" className="inline-flex items-center gap-1.5 font-semibold text-[#a78bfa] hover:text-[#c4b5fd]">
              {gt("See everything new")} <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href={release.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[#8a8a96] hover:text-white"
            >
              <ExternalLink className="h-4 w-4" /> {gt("All downloads on GitHub")}
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.05] px-4 py-8 text-center text-sm text-[#5f5f6b]">
        {gt("© {year} SerikaCord", { year: String(new Date().getFullYear()) })}
      </footer>
    </div>
  );
}
