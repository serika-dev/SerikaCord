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
      <Link href={href} className={cn("hm-card group flex h-full flex-col gap-4 p-5", muted && "border-dashed")}>
        <span
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-[12px]",
            muted
              ? "bg-[var(--hm-surface-2)] text-[var(--hm-body)]"
              : "bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)]",
          )}
          aria-hidden
        >
          {icon}
        </span>
        <span>
          <span className="block font-semibold text-[var(--hm-ink)]">{name}</span>
          <span className="mt-0.5 block text-sm leading-snug">{note}</span>
        </span>
      </Link>
    </li>
  );
}

export async function AppsSection() {
  const gt = await getGT();

  return (
    <section id="apps" aria-labelledby="hm-apps-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading
            id="hm-apps-title"
            label={gt("Apps")}
            title={gt("On your computer, your phone and the web.")}
            lede={gt("Desktop apps with native notifications, tray controls and global push to talk, an Android app with push notifications, and the full app in any modern browser.")}
          />
          <Link href="/download" className="hm-btn hm-btn-ghost shrink-0 self-start md:self-end" data-reveal>
            {gt("All downloads")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
        </div>

        {/* Product names are never translated. */}
        <ul className="mt-12 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-6" data-reveal>
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
