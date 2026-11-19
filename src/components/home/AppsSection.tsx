import Link from "next/link";
import type { ReactNode } from "react";
import { getGT, getLocale } from "gt-next/server";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BatteryFull,
  ChevronUp,
  Download,
  EllipsisVertical,
  Folder,
  Globe,
  Mic,
  Minus,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  SlidersHorizontal,
  Smartphone,
  Square,
  Star,
  Volume2,
  Wifi,
  X,
} from "lucide-react";
import { AndroidMark, AppleMark, LinuxMark, WindowsMark } from "@/components/ui/PlatformMarks";
import { APP_STORE_URL } from "@/lib/downloads";
import { SectionHeading } from "./SectionHeading";
import { Laptop, PhoneFrame } from "./Devices";
import { WebAppScreen } from "./AppPreview";
import { SHOTS } from "./live/model";
import { Av } from "./preview/parts";
import { DEVICE_TIME } from "./IosStatus";

type Gt = Awaited<ReturnType<typeof getGT>>;

/**
 * Apps: one card per way to use SerikaCord (computer, phone, browser). Each
 * shows the thing it runs on doing what the card says (a desktop
 * notification and the tray icon, push notifications on a lock screen, the
 * app in a browser tab), with the downloads for it underneath.
 */

type Platform = { href: string; icon: ReactNode; name: string; note: string; external?: boolean; action: "download" | "open" };

function PlatformLink({ p, gt }: { p: Platform; gt: Awaited<ReturnType<typeof getGT>> }) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)]" aria-hidden>
        {p.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.95rem] font-semibold leading-tight text-[var(--hm-ink)]">{p.name}</span>
        <span className="block text-[13px] leading-snug">{p.note}</span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--hm-body)] transition-colors group-hover/p:bg-[var(--brand-violet)] group-hover/p:text-white" aria-hidden>
        {p.action === "download" ? <Download className="h-4 w-4" /> : p.external ? <ArrowUpRight className="h-4 w-4" /> : <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
      </span>
    </>
  );
  const cls = "group/p flex items-center gap-3 rounded-[14px] border border-[var(--hm-line)] bg-[var(--hm-surface)] px-3 py-2.5 transition-colors hover:border-[color-mix(in_srgb,var(--brand-violet)_55%,var(--hm-line))]";
  const label = p.action === "download" ? gt("Download for {platform}", { platform: p.name }) : undefined;
  return p.external ? (
    <a href={p.href} target="_blank" rel="noopener noreferrer" className={cls} aria-label={label}>
      {body}
    </a>
  ) : (
    <Link href={p.href} className={cls} aria-label={label}>
      {body}
    </Link>
  );
}

function AppCard({ stage, title, text, platforms, gt }: { stage: ReactNode; title: string; text: string; platforms: Platform[]; gt: Awaited<ReturnType<typeof getGT>> }) {
  return (
    <li className="hm-card flex flex-col !rounded-[20px] sm:!rounded-[24px]">
      <div className="hm-apps-stage" aria-hidden>
        {stage}
      </div>
      <div className="flex flex-1 flex-col p-4 sm:p-6">
        <h3 className="hm-h3 !text-[1.1rem] sm:!text-[1.25rem]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed sm:text-[0.95rem]">{text}</p>
        <ul className="mt-4 flex flex-col gap-2 sm:mt-5">
          {platforms.map((p) => (
            <li key={p.name}>
              <PlatformLink p={p} gt={gt} />
            </li>
          ))}
        </ul>
      </div>
    </li>
  );
}

/** Windows 11 on the laptop: a SerikaCord notification over the taskbar, with the tray icon and an unread badge. */
function DesktopStage({ gt, date }: { gt: Gt; date: string }) {
  const tile = "flex h-[70%] aspect-square items-center justify-center rounded-[3px]";
  return (
    <Laptop className="hm-laptop-sm w-[94%]">
      <div className="relative aspect-[16/10] overflow-hidden text-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- static sample wallpaper */}
        <img src={SHOTS.castle} alt="" width={1280} height={720} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />

        {/* Windows 11 notification, bottom right above the taskbar. */}
        <div className="absolute bottom-[14%] right-[2.5%] w-[60%] rounded-[6px] border border-white/10 bg-[#2b2b2b]/95 p-[3%] shadow-2xl">
          <div className="flex items-center gap-1 text-[8px] text-white/70">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
            <img src="/logo-icon.svg" alt="" width={10} height={10} className="h-2.5 w-2.5 rounded-[2px]" />
            <span className="flex-1">SerikaCord</span>
            <MoreHorizontal className="h-2.5 w-2.5" />
            <X className="h-2.5 w-2.5" />
          </div>
          <div className="mt-1.5 flex gap-1.5">
            <Av name="Theo" className="h-6 w-6" fallbackClassName="text-[9px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[9.5px] font-semibold leading-tight">Theo (#{gt("general")})</p>
              <p className="line-clamp-2 text-[9.5px] leading-snug text-white/85">{gt("who's hopping in Lounge tonight?")}</p>
            </div>
          </div>
          <div className="mt-1.5 rounded-[3px] border border-white/10 bg-white/[0.06] px-1.5 py-[3px] text-[8px] text-white/50">{gt("Type a reply")}</div>
        </div>

        {/* Taskbar: Start, search, apps (SerikaCord open, 3 unread), tray. */}
        <div className="absolute inset-x-0 bottom-0 flex h-[10.5%] items-center justify-center gap-[1.6%] border-t border-white/5 bg-[#1c1c1c]/90 backdrop-blur-md">
          <span className={tile}>
            <WindowsMark className="h-[75%] w-[75%] text-[#4cc2ff]" />
          </span>
          <span className="flex h-[62%] w-[16%] items-center gap-[6%] rounded-full bg-white/10 px-[2%] text-[6px] text-white/60">
            <Search className="h-[70%] w-auto shrink-0" />
            <span className="truncate">{gt("Search")}</span>
          </span>
          <span className={tile}>
            <Folder className="h-[80%] w-[80%] fill-[#f8c74a] text-[#e5a92e]" />
          </span>
          <span className={tile}>
            <Globe className="h-[80%] w-[80%] text-[#8ab4f8]" />
          </span>
          <span className={`relative ${tile} bg-white/10`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
            <img src="/logo-icon.svg" alt="" width={16} height={16} className="h-[80%] w-[80%] rounded-[2px]" />
            <span className="absolute -right-[3px] -top-[3px] flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-[#ef4444] px-[2px] text-[6px] font-bold leading-none">3</span>
            <span className="absolute -bottom-[2px] left-1/2 h-[2px] w-[40%] -translate-x-1/2 rounded-full bg-[#4cc2ff]" />
          </span>
          <span className="absolute right-[2%] flex h-full items-center gap-[4px] text-[6.5px] leading-tight text-white/90">
            <ChevronUp className="h-2 w-2" />
            <Mic className="h-2 w-2 text-[#23a55a]" />
            <Wifi className="h-2 w-2" />
            <Volume2 className="h-2 w-2" />
            <BatteryFull className="h-2.5 w-2.5" />
            <span className="text-end tabular-nums">
              {DEVICE_TIME}
              <br />
              {date}
            </span>
          </span>
        </div>
      </div>
    </Laptop>
  );
}

/** An iPhone lock screen with two SerikaCord notifications. */
function PhoneStage({ gt, date }: { gt: Gt; date: string }) {
  const note = (name: string, where: string, text: string) => (
    <div className="flex gap-2 rounded-[18px] bg-[#1c1c1e]/55 p-2.5 text-white shadow-lg backdrop-blur-xl">
      {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
      <img src="/logo-icon.svg" alt="" width={28} height={28} className="mt-0.5 h-7 w-7 shrink-0 rounded-[7px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-tight">
            {name} <span className="font-normal text-white/70">{where}</span>
          </p>
          <span className="shrink-0 text-[10px] text-white/60">{gt("now")}</span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-white/95">{text}</p>
      </div>
    </div>
  );
  return (
    <PhoneFrame className="hm-phone-sm w-[66%] max-w-[230px]" time={DEVICE_TIME} overlay>
      <div className="relative h-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- static sample wallpaper */}
        <img src={SHOTS.snowyCliff} alt="" width={1280} height={720} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/5 to-black/40" />
        <div className="relative flex flex-col items-center pt-11 text-white">
          <p className="text-[13px] font-semibold opacity-90">{date}</p>
          <p className="hm-ios-clock">{DEVICE_TIME}</p>
        </div>
        <div className="relative mt-5 flex flex-col gap-1.5 px-2.5">
          {note("Theo", `#${gt("general")}`, gt("we start at 9, I'll stream Final Fantasy XVI first"))}
          {note("Rin", "", gt("did you listen to it yet? the 3rd song is my favorite"))}
        </div>
      </div>
    </PhoneFrame>
  );
}

/** Chrome on Windows with the web app open. */
function WebStage() {
  return (
    <div className="hm-browser w-[94%]">
      {/* Tab strip with window controls. */}
      <div className="hm-chrome-strip flex h-7 items-end gap-1 ps-2">
        <span className="hm-chrome-tab flex h-[23px] w-[44%] items-center gap-1.5 rounded-t-[8px] px-2 text-[10px] text-[var(--app-text)]">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
          <img src="/logo-icon.svg" alt="" width={12} height={12} className="h-3 w-3 shrink-0 rounded-[3px]" />
          <span className="min-w-0 flex-1 truncate">SerikaCord</span>
          <X className="h-2.5 w-2.5 shrink-0 text-[var(--app-muted)]" />
        </span>
        <Plus className="mb-1.5 h-3 w-3 text-[var(--app-muted)]" />
        <span className="ms-auto flex h-full items-start text-[var(--app-muted)]">
          <span className="flex h-6 w-7 items-center justify-center"><Minus className="h-3 w-3" /></span>
          <span className="flex h-6 w-7 items-center justify-center"><Square className="h-2.5 w-2.5" /></span>
          <span className="flex h-6 w-7 items-center justify-center"><X className="h-3 w-3" /></span>
        </span>
      </div>
      {/* Toolbar: back, forward, reload, the address bar, profile, menu. */}
      <div className="hm-chrome-tab flex h-8 items-center gap-1.5 border-b border-[var(--app-border)] px-2 text-[var(--app-muted)]">
        <ArrowLeft className="h-3 w-3 shrink-0" />
        <ArrowRight className="h-3 w-3 shrink-0 opacity-40" />
        <RotateCw className="h-3 w-3 shrink-0" />
        <span className="flex h-[22px] min-w-0 flex-1 items-center gap-1.5 rounded-full bg-[var(--app-bg)] px-2 text-[10.5px]">
          <SlidersHorizontal className="h-2.5 w-2.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            <span className="text-[var(--app-text)]">serika.chat</span>/channels/me
          </span>
          <Star className="h-2.5 w-2.5 shrink-0" />
        </span>
        <Av name="Sora" className="h-4 w-4" fallbackClassName="text-[8px]" />
        <EllipsisVertical className="h-3 w-3 shrink-0" />
      </div>
      <WebAppScreen />
    </div>
  );
}

export async function AppsSection() {
  const [gt, locale] = await Promise.all([getGT(), getLocale()]);
  let date: string;
  let shortDate: string;
  try {
    shortDate = new Date(Date.UTC(2026, 10, 19, 12)).toLocaleDateString(locale, { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
    date = new Date(Date.UTC(2026, 10, 19, 12)).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  } catch {
    shortDate = "19/11/2026";
    date = new Date(Date.UTC(2026, 10, 19, 12)).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  }

  // Product names are never translated.
  const desktop: Platform[] = [
    { href: "/download", icon: <WindowsMark className="h-[18px] w-[18px]" />, name: "Windows", note: gt("Windows 10 or newer"), action: "download" },
    { href: "/download", icon: <AppleMark className="h-[18px] w-[18px]" />, name: "macOS", note: gt("Apple silicon Macs"), action: "download" },
    { href: "/download", icon: <LinuxMark className="h-[18px] w-[18px]" />, name: "Linux", note: gt("Most 64-bit distributions"), action: "download" },
  ];
  const mobile: Platform[] = [
    { href: APP_STORE_URL, icon: <Smartphone className="h-[18px] w-[18px]" />, name: gt("iPhone and iPad"), note: gt("iOS 15 or newer, on the App Store"), external: true, action: "open" },
    { href: "/download", icon: <AndroidMark className="h-[18px] w-[18px]" />, name: "Android", note: gt("Android 7.0 or newer"), action: "download" },
  ];
  const web: Platform[] = [
    { href: "/channels/me", icon: <Globe className="h-[18px] w-[18px]" />, name: gt("Open in browser"), note: gt("Any modern browser, nothing to install"), action: "open" },
  ];

  return (
    <section id="apps" aria-labelledby="hm-apps-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-apps-title"
          align="center"
          label={gt("Apps")}
          title={gt("On your computer, your phone and the web.")}
          lede={gt("Desktop apps with native notifications, tray controls and global push to talk, iPhone and Android apps with push notifications, and the full app in any modern browser.")}
        />

        <ul className="mt-6 grid gap-3 sm:mt-12 sm:gap-4 lg:grid-cols-3" data-reveal data-reveal-stagger>
          <AppCard
            gt={gt}
            stage={<DesktopStage gt={gt} date={shortDate} />}
            title={gt("Desktop")}
            text={gt("Notifications from your system, SerikaCord in the tray, and push to talk that works while you're in a game.")}
            platforms={desktop}
          />
          <AppCard
            gt={gt}
            stage={<PhoneStage gt={gt} date={date} />}
            title={gt("Phone and tablet")}
            text={gt("Push notifications for mentions and DMs, voice calls on the go, and your encrypted DMs on every device.")}
            platforms={mobile}
          />
          <AppCard
            gt={gt}
            stage={<WebStage />}
            title={gt("Web")}
            text={gt("The whole app in your browser tab, the same servers, DMs and calls, nothing to install.")}
            platforms={web}
          />
        </ul>

        <div className="mt-6 flex justify-center sm:mt-10" data-reveal>
          <Link href="/download" className="hm-btn hm-btn-ghost hm-btn-compact">
            {gt("All downloads")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
