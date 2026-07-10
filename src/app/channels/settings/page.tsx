"use client";

import Link from "next/link";
import { T, useGT } from "gt-next";
import {
  User,
  Shield,
  Bell,
  Palette,
  Accessibility,
  Mic,
  Globe,
  Crown,
  HelpCircle,
  Bug,
  MessageSquare,
  Circle,
  ChevronRight,
  UserCheck,
  Link as LinkIcon,
} from "lucide-react";

export default function MobileSettingsIndexPage() {
  const gt = useGT();
  const sections = [
    {
      title: gt("Account"),
      items: [
        { href: "/channels/settings/account", label: gt("My Account"), icon: User },
        { href: "/channels/settings/profiles", label: gt("Profiles"), icon: UserCheck },
        { href: "/channels/settings/connections", label: gt("Connections"), icon: LinkIcon },
        { href: "/channels/settings/status", label: gt("Status"), icon: Circle },
        { href: "/channels/settings/privacy", label: gt("Privacy & Safety"), icon: Shield },
      ],
    },
    {
      title: gt("App Settings"),
      items: [
        { href: "/channels/settings/notifications", label: gt("Notifications"), icon: Bell },
        { href: "/channels/settings/appearance", label: gt("Appearance"), icon: Palette },
        { href: "/channels/settings/accessibility", label: gt("Accessibility"), icon: Accessibility },
        { href: "/channels/settings/voice", label: gt("Voice & Video"), icon: Mic },
        { href: "/channels/settings/language", label: gt("Language"), icon: Globe },
      ],
    },
    {
      title: gt("Premium"),
      items: [
        { href: "/channels/settings/premium", label: gt("SerikaCord Premium"), icon: Crown },
      ],
    },
    {
      title: gt("Support"),
      items: [
        { href: "/channels/settings/help", label: gt("Help & Support"), icon: HelpCircle },
        { href: "/channels/settings/bug-report", label: gt("Report a Bug"), icon: Bug },
        { href: "/channels/settings/feedback", label: gt("Give Feedback"), icon: MessageSquare },
      ],
    },
  ];
  return (
    <div className="min-h-full bg-[var(--bg-app)] overflow-y-auto pb-20">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">{gt("Settings")}</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">{gt("Manage your account and preferences")}</p>
      </div>

      <div className="px-4 space-y-6">
        {sections.map((section) => (
          <div key={section.title}>
            <h2 className="text-xs font-bold uppercase text-[var(--text-muted)] mb-2 px-1 tracking-wider">
              {section.title}
            </h2>
            <div className="space-y-1.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--app-accent)]/30 transition-all active:scale-[0.98]"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[var(--bg-hover)] flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5 text-[var(--text-secondary)]" />
                    </div>
                    <span className="flex-1 font-medium text-sm">{item.label}</span>
                    <ChevronRight className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
