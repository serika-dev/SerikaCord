"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Info,
  Bot,
  Download,
  Smile,
  Webhook,
  KeyRound,
  Users,
  Gift,
  Activity, 
  ArrowLeft,
  AlertTriangle,
} from "lucide-react";
import { useApplication } from "./useApplication";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

export default function ApplicationDetailLayoutClient({
  children,
}: {
  children: React.ReactNode;
}) {
  const gt = useGT();
  const params = useParams();
  const pathname = usePathname();
  const appId = params.id as string;
  const { app, loading, error } = useApplication(appId);

  const tabs = [
    { label: gt("General Information"), href: "information", icon: Info },
    { label: gt("Bot"), href: "bot", icon: Bot },
    { label: gt("Installation"), href: "installation", icon: Download },
    { label: gt("OAuth2"), href: "oauth2", icon: KeyRound },
    { label: gt("Emoji"), href: "emojis", icon: Smile },
    { label: gt("Webhooks"), href: "webhooks", icon: Webhook },
    { label: gt("App Directory Page"), href: "directory", icon: Gift },
    { label: gt("Analytics"), href: "analytics", icon: Activity },
    { label: gt("Team"), href: "team", icon: Users },
  ];

  const activeTab = pathname?.split("/").pop() || "information";

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 border-r border-white/[0.06] bg-[#0d0d0d] flex flex-col shrink-0 h-[calc(100vh-3.5rem)] sticky top-0">
        <div className="p-5 border-b border-white/[0.06]">
          <Link
            href="/developers/applications"
            className="flex items-center gap-2 text-xs text-[#777] hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="size-3" /> {gt("All Applications")}
          </Link>
          {loading ? (
            <div className="flex items-center gap-2">
              <Loader size={24} className="size-4" />
              <span className="text-sm text-[#888]">{gt("Loading...")}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#6366f1]/20 border border-white/[0.08] flex items-center justify-center shrink-0 overflow-hidden shadow-[0_0_10px_rgba(139,92,246,0.1)]">
                {app?.icon ? (
                  <img src={app.icon} alt="" className="size-10 rounded-xl object-cover" />
                ) : app?.botAvatar ? (
                  <img src={app.botAvatar} alt="" className="size-10 rounded-xl object-cover" />
                ) : (
                  <img 
                    src={`https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(app?.name || 'bot')}`}
                    alt=""
                    className="size-10 rounded-xl object-cover animate-pulse-slow" 
                  />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate text-white/90">{app?.name || gt("Unnamed")}</h2>
                <p className="text-[10px] font-mono text-[#555] truncate mt-0.5">{app?.id}</p>
                {app?.botUsername && (
                  <p className="text-[10px] text-[#8B5CF6]/70 truncate mt-0.5">@{app.botUsername}</p>
                )}
              </div>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.href;
            return (
              <Link
                key={tab.href}
                href={`/developers/applications/${appId}/${tab.href}`}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors mb-0.5",
                  active
                    ? "bg-white/10 text-white"
                    : "text-[#949ba4] hover:text-white hover:bg-white/[0.04]"
                )}
              >
                <tab.icon className="size-4 shrink-0" />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {app?.verified !== undefined && (
          <div className="p-4 border-t border-white/[0.06]">
            {app.verified ? (
              <div className="flex items-center gap-2 text-xs text-green-400">
                <span className="size-2 rounded-full bg-green-400" /> {gt("Verified Bot")}
              </div>
            ) : (
              <div className="text-xs text-[#666]">
                <p>{gt("Not verified")}</p>
                <p className="mt-1 text-[#555]">
                  {gt("Reach 100+ servers to apply for verification.")}
                </p>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto bg-[#0a0a0a]">
        <div className="max-w-4xl mx-auto px-6 py-8">
          {error ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="size-16 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4">
                <AlertTriangle className="size-8 text-red-400" />
              </div>
              <h2 className="text-base font-semibold mb-1">{gt("Failed to load application")}</h2>
              <p className="text-sm text-[#777] mb-4">{error}</p>
              <Link
                href="/developers/applications"
                className="flex items-center gap-2 px-4 py-2 bg-white/[0.06] hover:bg-white/[0.1] text-sm font-medium rounded-lg transition-colors"
              >
                <ArrowLeft className="size-4" /> {gt("Back to Applications")}
              </Link>
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  );
}
