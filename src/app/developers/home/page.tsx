"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Boxes,
  Bug,
  ChevronRight,
  Code2,
  FileText,
  GitCompareArrows,
  LayoutGrid,
  Library,
  Package,
  Plus,
  Server,
  Sparkles,
  SquareTerminal,
  Users,
  Webhook,
} from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { DevAppAvatar, DevAppStatus } from "@/components/apps/DevAppAvatar";

interface App {
  id: string;
  name: string;
  description?: string;
  icon?: string | null;
  botAvatar?: string | null;
  botUsername?: string | null;
  botPublic?: boolean;
  botId?: string | null;
  createdAt: string;
  serverCount?: number;
  verified?: boolean;
  official?: boolean;
  verificationStatus?: string | null;
}

export default function DeveloperHomePage() {
  const gt = useGT();
  const { user } = useAuth();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/developers/applications")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setApps(data.applications || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recentApps = apps.slice(0, 5);
  const bots = apps.filter((a) => a.botId).length;
  const servers = apps.reduce((sum, a) => sum + (a.serverCount ?? 0), 0);
  const verified = apps.filter((a) => a.verified || a.official).length;
  const name = user?.displayName || user?.username || gt("Developer");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-10 py-8 md:py-10">
        {/* Header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between mb-8">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-[#8B5CF6] mb-2">{gt("Developer Portal")}</p>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight truncate">
              {gt("Welcome back, {name}", { name })}
            </h1>
            <p className="text-sm text-[#949ba4] mt-1.5">
              {gt("Build bots, integrations and experiences for SerikaCord and Discord.")}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/developers/docs/intro"
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] text-sm font-medium transition-colors"
            >
              <FileText className="size-4 text-[#949ba4]" /> {gt("Docs")}
            </Link>
            <Link
              href="/developers/applications?new=1"
              className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
            >
              <Plus className="size-4" /> {gt("New Application")}
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <Stat icon={Boxes} label={gt("Applications")} value={loading ? "–" : String(apps.length)} />
          <Stat icon={Bot} label={gt("Bots")} value={loading ? "–" : String(bots)} />
          <Stat icon={Server} label={gt("Servers reached")} value={loading ? "–" : servers.toLocaleString()} />
          <Stat icon={BadgeCheck} label={gt("Verified")} value={loading ? "–" : String(verified)} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Your applications */}
          <section className="lg:col-span-2 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">{gt("Your applications")}</h2>
              {apps.length > 0 && (
                <Link href="/developers/applications" className="text-xs text-[#949ba4] hover:text-white inline-flex items-center gap-1 transition-colors">
                  {gt("View all")} <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#949ba4]">
                  <Loader size={24} className="size-4" /> {gt("Loading your apps...")}
                </div>
              ) : recentApps.length === 0 ? (
                <div className="text-center px-6 py-14">
                  <div className="size-12 rounded-xl bg-[#8B5CF6]/10 text-[#a78bfa] flex items-center justify-center mx-auto mb-4">
                    <Bot className="size-6" />
                  </div>
                  <h3 className="text-sm font-semibold mb-1">{gt("Create your first application")}</h3>
                  <p className="text-xs text-[#949ba4] max-w-sm mx-auto mb-5">
                    {gt("An application gives you a bot user, OAuth2 credentials and slash commands. It takes a few seconds.")}
                  </p>
                  <Link
                    href="/developers/applications?new=1"
                    className="inline-flex items-center gap-2 h-9 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-semibold transition-colors"
                  >
                    <Plus className="size-4" /> {gt("New Application")}
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.05]">
                  {recentApps.map((app) => (
                    <li key={app.id}>
                      <Link
                        href={`/developers/applications/${app.id}/information`}
                        className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors"
                      >
                        <DevAppAvatar name={app.name} icon={app.icon} botAvatar={app.botAvatar} className="size-10 text-base" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-semibold truncate">{app.name}</span>
                            <DevAppStatus app={app} className="hidden sm:flex" />
                          </div>
                          <p className="text-xs text-[#949ba4] truncate mt-0.5">
                            {app.botUsername ? `@${app.botUsername}` : gt("No bot user yet")}
                            {app.description ? ` · ${app.description}` : ""}
                          </p>
                        </div>
                        <div className="hidden sm:flex flex-col items-end shrink-0 text-right">
                          <span className="text-sm font-semibold tabular-nums">{(app.serverCount ?? 0).toLocaleString()}</span>
                          <span className="text-[11px] text-[#71717a]">{gt("servers")}</span>
                        </div>
                        <ChevronRight className="size-4 text-[#52525b] group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Build */}
            <h2 className="text-sm font-semibold mt-8 mb-3">{gt("Build something")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BuildCard
                icon={Bot}
                title={gt("Build a bot")}
                description={gt("Slash commands, buttons, moderation and automation with any Discord library.")}
                href="/developers/docs/quick-start"
              />
              <BuildCard
                icon={LayoutGrid}
                title={gt("Components V2")}
                description={gt("Cards, sections, galleries and menus for rich bot and webhook messages.")}
                href="/developers/docs/resources/message#components-v2"
              />
              <BuildCard
                icon={Sparkles}
                title={gt("Social SDK")}
                description={gt("Relationships, live presence and profile widgets for your game or app.")}
                href="/developers/docs/social-sdk/overview"
              />
            </div>
          </section>

          {/* Sidebar */}
          <aside className="space-y-6 min-w-0">
            <div>
              <h2 className="text-sm font-semibold mb-3">{gt("Get started")}</h2>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
                <QuickLink icon={SquareTerminal} title={gt("Quick start")} description={gt("Your first bot in a few minutes")} href="/developers/docs/quick-start" />
                <QuickLink icon={Package} title={gt("serika.js")} description={gt("The official JavaScript library")} href="https://www.npmjs.com/package/@serikadev/serika.js" external />
                <QuickLink icon={GitCompareArrows} title={gt("Discord compatibility")} description={gt("Every route and event we support")} href="/developers/docs/topics/compatibility" />
                <QuickLink icon={Webhook} title={gt("Webhooks and OAuth2")} description={gt("Authentication and integrations")} href="/developers/docs/topics/oauth2" />
                <QuickLink icon={Users} title={gt("Teams")} description={gt("Manage applications together")} href="/developers/teams" />
              </div>
            </div>

            <div className="rounded-xl border border-[#8B5CF6]/20 bg-gradient-to-br from-[#8B5CF6]/[0.10] to-transparent p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#a78bfa] mb-2">{gt("What's new")}</p>
              <ul className="space-y-2.5 text-xs text-[#d4d4d8]">
                <li className="flex gap-2">
                  <Code2 className="size-3.5 text-[#a78bfa] shrink-0 mt-0.5" />
                  <span>{gt("Bots in bridged servers can tell relayed Discord messages apart and look up bridged channels.")}</span>
                </li>
                <li className="flex gap-2">
                  <Library className="size-3.5 text-[#a78bfa] shrink-0 mt-0.5" />
                  <span>{gt("List your bot in the App Directory to show up on /bots and in App Discovery.")}</span>
                </li>
                <li className="flex gap-2">
                  <BadgeCheck className="size-3.5 text-[#a78bfa] shrink-0 mt-0.5" />
                  <span>{gt("Verified bots now show their check next to the BOT tag.")}</span>
                </li>
              </ul>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.05]">
              <QuickLink icon={Library} title={gt("Bot library")} description={gt("Browse bots on SerikaCord")} href="/bots" />
              <QuickLink icon={Bug} title={gt("Report an issue")} description={gt("Bugs and feature requests")} href="https://issues.serika.dev" external />
            </div>
          </aside>
        </div>

        {/* Footer */}
        <div className="mt-10 pt-6 border-t border-white/[0.06] flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#71717a]">
          <Link href="/developers/docs/intro" className="hover:text-white transition-colors">{gt("Documentation")}</Link>
          <Link href="/developers/docs/topics/rate-limits" className="hover:text-white transition-colors">{gt("API Limits")}</Link>
          <Link href="/developers/docs/topics/oauth2" className="hover:text-white transition-colors">{gt("OAuth2")}</Link>
          <Link href="/channels/me" className="hover:text-white transition-colors">{gt("Open SerikaCord")}</Link>
          <span className="sm:ml-auto">{gt("© SerikaCord Developer Portal")}</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-[#949ba4]">
        <Icon className="size-3.5" /> {label}
      </div>
      <p className="text-xl font-bold tabular-nums mt-1.5">{value}</p>
    </div>
  );
}

function BuildCard({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.12] p-4 transition-colors"
    >
      <div className="size-8 rounded-lg bg-[#8B5CF6]/12 text-[#a78bfa] flex items-center justify-center mb-3">
        <Icon className="size-4" />
      </div>
      <h3 className="text-sm font-semibold mb-1 flex items-center gap-1">
        {title}
        <ArrowRight className="size-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
      </h3>
      <p className="text-xs text-[#949ba4] leading-relaxed">{description}</p>
    </Link>
  );
}

function QuickLink({
  icon: Icon,
  title,
  description,
  href,
  external,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="group flex items-center gap-3 px-3.5 py-3 hover:bg-white/[0.03] transition-colors first:rounded-t-xl last:rounded-b-xl"
    >
      <div className="size-8 rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
        <Icon className="size-4 text-[#a1a1aa]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-[#71717a] truncate">{description}</p>
      </div>
      {external ? (
        <ArrowUpRight className="size-4 text-[#52525b] group-hover:text-white transition-colors shrink-0" />
      ) : (
        <ChevronRight className="size-4 text-[#52525b] group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
      )}
    </Link>
  );
}
