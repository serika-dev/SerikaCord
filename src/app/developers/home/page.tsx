"use client";

import { useState, useEffect } from "react";
import { cdnImage } from "@/lib/utils";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import {
  Boxes,
  Book,
  Users,
  ArrowRight,
  Bot, 
  Rocket,
  Code2,
  Webhook,
  Sparkles,
  FileText,
  Github,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

interface App {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  botPublic?: boolean;
  botId?: string;
  createdAt: string;
  serverCount?: number;
  verified?: boolean;
}

export default function DeveloperHomePage() {
  const gt = useGT();
  const { user } = useAuth();
  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApps();
  }, []);

  const fetchApps = async () => {
    try {
      const res = await fetch("/api/developers/applications");
      if (res.ok) {
        const data = await res.json();
        setApps(data.applications || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const recentApps = apps.slice(0, 3);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 md:px-10 py-8 md:py-12">
        {/* Welcome */}
        <div className="mb-10">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            Welcome, {user?.displayName || user?.username || gt("Developer")}
          </h1>
          <p className="text-[#949ba4] text-base">
            {gt("Build bots, integrations, and experiences for SerikaCord.")}
          </p>
        </div>

        {/* Jump Back In */}
        {loading ? (
          <div className="flex items-center gap-2 text-[#949ba4] text-sm mb-10">
            <Loader size={24} className="size-4" /> {gt("Loading your apps...")}
          </div>
        ) : recentApps.length > 0 ? (
          <div className="mb-10">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Rocket className="size-5 text-[#8B5CF6]" />
              {gt("Jump back in")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {recentApps.map((app) => (
                <Link
                  key={app.id}
                  href={`/developers/applications/${app.id}/information`}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-4 transition-all"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="size-10 rounded-lg bg-gradient-to-br from-[#8B5CF6] to-[#6366f1] flex items-center justify-center shrink-0 overflow-hidden">
                      {app.icon ? (
                        <img src={cdnImage(app.icon)} alt="" className="size-10 rounded-lg object-cover" />
                      ) : (
                        <Bot className="size-5 text-white" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold truncate">{app.name}</h3>
                      {app.serverCount !== undefined && (
                        <p className="text-xs text-[#666]">{gt("{count} servers", { count: app.serverCount })}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-[#8B5CF6] group-hover:gap-2 transition-all">
                    {gt("Go to app")} <ArrowRight className="size-3" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* Feature Cards */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold mb-4">{gt("More ways to build on SerikaCord")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              icon={Bot}
              title={gt("Build a bot")}
              description={gt("Create bots to enhance your servers with commands, moderation, and automation.")}
              href="/developers/applications"
              gradient="from-[#8B5CF6] to-[#6366f1]"
            />
            <FeatureCard
              icon={Code2}
              title={gt("Use the API")}
              description={gt("Interact with the SerikaCord REST API to build custom integrations and tools.")}
              href="/developers/docs/intro"
              gradient="from-[#5865F2] to-[#3B82F6]"
            />
            <FeatureCard
              icon={Users}
              title={gt("Create a team")}
              description={gt("Collaborate with other developers to manage applications together.")}
              href="/developers/teams"
              gradient="from-[#EB459E] to-[#8B5CF6]"
            />
          </div>
        </div>

        {/* Resources */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold mb-4">{gt("Resources")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <ResourceLink
              icon={FileText}
              title={gt("Documentation")}
              description={gt("Read the docs, guides, and API reference")}
              href="/developers/docs/intro"
            />
            <ResourceLink
              icon={Sparkles}
              title={gt("Quick Start")}
              description={gt("Get up and running with your first bot in minutes")}
              href="/developers/docs/quick-start"
            />
            <ResourceLink
              icon={Webhook}
              title={gt("Webhooks & OAuth2")}
              description={gt("Learn about authentication and webhook integrations")}
              href="/developers/docs/topics/oauth2"
            />
            <ResourceLink
              icon={Github}
              title={gt("Report Issues")}
              description={gt("Found a bug? Report it on our issue tracker")}
              href="https://github.com/serikacord"
              external
            />
          </div>
        </div>

        {/* Quick Actions */}
        <div className="mb-10">
          <h2 className="text-lg font-semibold mb-4">{gt("Quick Actions")}</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/developers/applications"
              className="flex items-center gap-2 px-4 py-2.5 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Boxes className="size-4" /> {gt("View Applications")}
            </Link>
            <Link
              href="/developers/teams"
              className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Users className="size-4" /> {gt("Manage Teams")}
            </Link>
            <Link
              href="/developers/docs/intro"
              className="flex items-center gap-2 px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Book className="size-4" /> {gt("Read the Docs")}
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-8 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#666]">
            <Link href="/developers/docs/intro" className="hover:text-white transition-colors">
              {gt("Documentation")}
            </Link>
            <Link href="/developers/docs/topics/rate-limiting" className="hover:text-white transition-colors">
              {gt("API Limits")}
            </Link>
            <Link href="/developers/docs/topics/oauth2" className="hover:text-white transition-colors">
              {gt("OAuth2")}
            </Link>
            <Link href="/channels/me" className="hover:text-white transition-colors">
              {gt("Open SerikaCord")}
            </Link>
            <span className="ml-auto">{gt("© SerikaCord Developer Portal")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  href,
  gradient,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
  gradient: string;
}) {
  const gt = useGT();
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-5 transition-all"
    >
      <div className={`size-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center mb-3`}>
        <Icon className="size-5 text-white" />
      </div>
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <p className="text-xs text-[#949ba4] leading-relaxed mb-3">{description}</p>
      <div className="flex items-center gap-1 text-xs text-[#8B5CF6] group-hover:gap-2 transition-all">
        {gt("Get started")} <ArrowRight className="size-3" />
      </div>
    </Link>
  );
}

function ResourceLink({
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
      className="group flex items-center gap-4 rounded-lg border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1] p-4 transition-all"
    >
      <div className="size-9 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
        <Icon className="size-4 text-[#949ba4]" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-[#777] truncate">{description}</p>
      </div>
      <ChevronRight className="size-4 text-[#555] group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
    </Link>
  );
}
