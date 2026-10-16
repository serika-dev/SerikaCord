import Link from "next/link";
import type { ReactNode } from "react";
import { getGT } from "gt-next/server";
import { ArrowRight, Globe, Smartphone } from "lucide-react";
import { AndroidMark, AppleMark, LinuxMark, WindowsMark } from "@/components/ui/PlatformMarks";
import { SectionHeading } from "./SectionHeading";
import { cn } from "@/lib/utils";

function PlatformTile({ href, icon, name, note, muted }: { href: string; icon: ReactNode; name: string; note: string; muted?: boolean }) {
  return (
    <li>
      {/* Phones: a 2-column grid of mini tiles; wider: the roomy cards. */}
      <Link href={href} className={cn("hm-card group grid h-full grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5 !rounded-[16px] p-3 sm:flex sm:flex-col sm:items-stretch sm:gap-4 sm:!rounded-[24px] sm:p-5", muted && "border-dashed")}>
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-[10px] sm:h-11 sm:w-11 sm:rounded-[12px]",
            muted
              ? "bg-[var(--hm-surface-2)] text-[var(--hm-body)]"
              : "bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)]",
          )}
          aria-hidden
        >
          {icon}
        </span>
        {/* Phones: the name sits beside the icon and the note spans the tile. */}
        <span className="contents sm:block">
          <span className="block text-[0.95rem] font-semibold leading-tight text-[var(--hm-ink)] sm:text-base">{name}</span>
          <span className="col-span-2 block text-[13px] leading-snug sm:mt-0.5 sm:text-sm">{note}</span>
        </span>
      </Link>
    </li>
  );
}

export async function AppsSection() {
  const gt = await getGT();

  return (
    <section id="apps" aria-labelledby="hm-apps-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-4 sm:gap-6 md:flex-row md:items-end">
          <SectionHeading
            id="hm-apps-title"
            label={gt("Apps")}
            title={gt("On your computer, your phone and the web.")}
            lede={gt("Desktop apps with native notifications, tray controls and global push to talk, an Android app with push notifications, and the full app in any modern browser.")}
          />
          <Link href="/download" className="hm-btn hm-btn-ghost hm-btn-compact shrink-0 self-start md:self-end" data-reveal>
            {gt("All downloads")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>

        {/* Product names are never translated. */}
        <ul className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-12 sm:gap-3 md:grid-cols-3 lg:grid-cols-6" data-reveal>
          <PlatformTile href="/download" icon={<WindowsMark className="h-5 w-5" />} name="Windows" note={gt("Windows 10 or newer")} />
          <PlatformTile href="/download" icon={<AppleMark className="h-5 w-5" />} name="macOS" note={gt("Apple silicon Macs")} />
          <PlatformTile href="/download" icon={<LinuxMark className="h-5 w-5" />} name="Linux" note={gt("Most 64-bit distributions")} />
          <PlatformTile href="/download" icon={<AndroidMark className="h-5 w-5" />} name="Android" note={gt("Android 6.0 or newer")} />
          <PlatformTile href="/channels/me" icon={<Globe className="h-5 w-5" />} name={gt("Web")} note={gt("Any modern browser, nothing to install")} />
          <PlatformTile
            href="/download"
            icon={<Smartphone className="h-5 w-5" />}
            name={gt("iPhone and iPad")}
            note={gt("Use the web app from your Home Screen. A native app is in development.")}
            muted
          />
        </ul>
      </div>
    </section>
  );
}
