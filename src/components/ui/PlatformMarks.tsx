import type { ReactNode } from "react";

// Simple, single-colour platform marks shared by the homepage and /download.
// Product names are never translated, so callers label these themselves.

export type MarkPlatform = "windows" | "mac" | "linux" | "android";

export function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 5.1 10.4 4v7.2H3zM11.4 3.9 21 2.5v8.7h-9.6zM3 12.2h7.4v7.2L3 18.3zM11.4 12.2H21v8.8l-9.6-1.4z" />
    </svg>
  );
}
export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.8C6.1 7 4.5 8 3.7 9.6c-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.9-1.1-2.9-4.2zM14 5.3c.7-.8 1.2-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z" />
    </svg>
  );
}
export function LinuxMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2c-2.2 0-3.6 1.9-3.6 4.5 0 1.2.2 2-.4 3.1-.8 1.4-2.6 3.6-2.9 6.2-.1 1 .2 1.6.7 2.1-.6.4-1.5.7-1.4 1.6.1.9 1.3 1 2.6 1.5 1.1.4 1.9 1 2.8 1 .8 0 1.3-.5 1.6-1h1.2c.3.5.8 1 1.6 1 .9 0 1.7-.6 2.8-1 1.3-.5 2.5-.6 2.6-1.5.1-.9-.8-1.2-1.4-1.6.5-.5.8-1.1.7-2.1-.3-2.6-2.1-4.8-2.9-6.2-.6-1.1-.4-1.9-.4-3.1C15.6 3.9 14.2 2 12 2zm-1.5 3.6c.5 0 .8.6.8 1.2s-.3 1-.6 1.1l-.3-.1c-.3-.1-.6-.5-.6-1 0-.7.3-1.2.7-1.2zm3 0c.4 0 .7.5.7 1.2 0 .5-.3.9-.6 1l-.3.1c-.3-.1-.6-.5-.6-1.1s.3-1.2.8-1.2zM12 8.3c.8 0 2 .5 2 .9 0 .3-1.2 1.2-2 1.2s-2-.9-2-1.2c0-.4 1.2-.9 2-.9zm-2.2 3.3c.6.4 1.4.7 2.2.7s1.6-.3 2.2-.7c.8 1.2 1.6 2.6 1.6 4.2 0 1.9-1.6 3-3.8 3s-3.8-1.1-3.8-3c0-1.6.8-3 1.6-4.2z" />
    </svg>
  );
}
export function AndroidMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.5 9.6 19.3 6.5a.4.4 0 0 0-.7-.4l-1.8 3.1A10.8 10.8 0 0 0 12 8.2c-1.7 0-3.3.4-4.8 1L5.4 6.1a.4.4 0 0 0-.7.4l1.8 3.1C3.5 11.2 1.5 14.2 1.2 17.8h21.6c-.3-3.6-2.3-6.6-5.3-8.2zM7 15.1a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm10 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z" />
    </svg>
  );
}

export const PLATFORM_MARKS: Record<MarkPlatform, (p: { className?: string }) => ReactNode> = {
  windows: WindowsMark,
  mac: AppleMark,
  linux: LinuxMark,
  android: AndroidMark,
};
