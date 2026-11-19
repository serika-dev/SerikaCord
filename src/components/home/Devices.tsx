import type { ReactNode } from "react";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEVICE_TIME, IosStatus } from "./IosStatus";

/**
 * Device frames for the homepage previews, so each one sits in the thing you
 * would use it on: a laptop (the playable app), the desktop app's window (the
 * call page) and a phone. Frames are decoration only; the previews inside stay
 * fully clickable. Styles: .hm-laptop / .hm-window / .hm-phone in home.css.
 */

export function Laptop({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("hm-laptop", className)} data-reveal>
      <div className="hm-laptop-lid">
        <span className="hm-laptop-cam" aria-hidden />
        <div className="hm-laptop-screen">{children}</div>
      </div>
      <div className="hm-laptop-base" aria-hidden />
    </div>
  );
}

/** The desktop app's window: title bar with the app name and window controls. */
export function AppWindow({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("hm-window", className)}>
      <div className="hm-window-bar" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
        <img src="/logo-icon.svg" alt="" width={16} height={16} className="h-4 w-4 rounded-[4px]" />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <span className="hm-window-ctl"><Minus className="h-3.5 w-3.5" /></span>
        <span className="hm-window-ctl"><Square className="h-3 w-3" /></span>
        <span className="hm-window-ctl hm-window-close"><X className="h-3.5 w-3.5" /></span>
      </div>
      <div className="hm-window-body">{children}</div>
    </div>
  );
}

/** A phone with a status bar and a home indicator around app UI. */
export function PhoneFrame({
  children,
  time = DEVICE_TIME,
  className,
  overlay = false,
}: {
  children: ReactNode;
  time?: string;
  className?: string;
  /** Status bar in white over the content (a lock screen with a wallpaper). */
  overlay?: boolean;
}) {
  return (
    <div className={cn("hm-phone hm-phone-device", className)}>
      <div className="hm-phone-device-screen relative">
        <IosStatus time={time} className={cn("hm-phone-status h-11 px-3 text-[13px]", overlay ? "absolute inset-x-0 top-0 z-10 text-white" : "text-[var(--app-text)]")} />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <div className={cn("flex h-6 shrink-0 items-center justify-center", overlay && "absolute inset-x-0 bottom-0 z-10")} aria-hidden>
          <span className={cn("h-1 w-28 rounded-full opacity-60", overlay ? "bg-white" : "bg-[var(--app-text)]")} />
        </div>
      </div>
    </div>
  );
}
