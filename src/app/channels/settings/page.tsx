"use client";

import Link from "next/link";

const links = [
  { href: "/channels/settings/account", label: "My Account" },
  { href: "/channels/settings/privacy", label: "Privacy & Safety" },
  { href: "/channels/settings/apps", label: "Authorized Apps" },
  { href: "/channels/settings/notifications", label: "Notifications" },
  { href: "/channels/settings/appearance", label: "Appearance" },
  { href: "/channels/settings/accessibility", label: "Accessibility" },
  { href: "/channels/settings/voice", label: "Voice & Video" },
  { href: "/channels/settings/language", label: "Language" },
  { href: "/channels/settings/premium", label: "Premium" },
  { href: "/channels/settings/help", label: "Help" },
  { href: "/channels/settings/bug-report", label: "Bug Report" },
  { href: "/channels/settings/feedback", label: "Feedback" },
  { href: "/channels/settings/status", label: "Status" },
];

export default function MobileSettingsIndexPage() {
  return (
    <div className="min-h-full bg-[var(--bg-app)] p-4 space-y-2">
      <h1 className="text-xl font-bold text-[var(--text-primary)] mb-3">Settings</h1>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="block rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
