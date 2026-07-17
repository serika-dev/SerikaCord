"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useGT } from "gt-next";
import { Share2, BookOpen, KeyRound, MessageSquare, LayoutGrid, ArrowRight } from "lucide-react";

export default function SocialSdkPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;

  const resources = [
    { label: gt("API Reference"), desc: gt("The native /api/v1 Social SDK endpoints."), icon: BookOpen, href: "/developers/docs/social-sdk/api-reference" },
    { label: gt("External Auth"), desc: gt("OAuth2 access tokens & scopes for SDK calls."), icon: KeyRound, href: "/developers/docs/social-sdk/external-auth" },
    { label: gt("Relationships & Presence"), desc: gt("Read friends and live rich presence."), icon: MessageSquare, href: "/developers/docs/social-sdk/relationships" },
    { label: gt("Widgets"), desc: gt("Author a profile widget and push user data."), icon: LayoutGrid, href: `/developers/applications/${appId}/widget` },
  ];

  return (
    <div className="max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#6366f1] flex items-center justify-center">
          <Share2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{gt("Serika Social SDK")}</h1>
          <p className="text-sm text-white/50">{gt("Bring Serika relationships, presence, and widgets into your app.")}</p>
        </div>
      </div>

      <p className="text-sm text-white/60 leading-relaxed my-5">
        {gt("The Social SDK lets your app read a user's Serika relationships and live presence, drive a Serika RPC activity with image assets, and render a configurable profile widget. Everything is exposed over the native /api/v1 HTTP API so you can wrap it in a binary SDK later.")}
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {resources.map((r) => (
          <Link
            key={r.label}
            href={r.href}
            className="group flex items-start gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:border-white/[0.14] hover:bg-white/[0.05] transition-all"
          >
            <r.icon className="w-5 h-5 text-[#8B5CF6] shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white flex items-center gap-1">{r.label} <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" /></p>
              <p className="text-xs text-white/50 mt-0.5">{r.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
