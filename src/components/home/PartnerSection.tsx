"use client";

import { useEffect, useState } from "react";
import { cdnImage } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { Users } from "lucide-react";
import { T, useGT } from "gt-next";

interface PartnerServer {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  memberCount: number;
  onlineCount?: number;
  vanityUrlCode: string | null;
  /** serika.cc join code: the vanity URL or a permanent homepage invite. */
  joinCode?: string | null;
}

/** At most this many partners on the homepage. */
const MAX_PARTNERS = 12;

function ServerAvatar({ name, icon }: { name: string; icon: string | null }) {
  if (icon) {
    return (
      <Image
        src={cdnImage(icon)}
        alt={name}
        width={56}
        height={56}
        className="w-14 h-14 rounded-2xl object-cover"
        unoptimized
      />
    );
  }
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="w-14 h-14 rounded-2xl bg-[#8B5CF6]/20 border border-[#8B5CF6]/30 flex items-center justify-center flex-shrink-0">
      <span className="text-[#8B5CF6] font-bold text-lg">{initials}</span>
    </div>
  );
}

export function PartnerSection() {
  const gt = useGT();
  const [servers, setServers] = useState<PartnerServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/servers/partnered")
      .then((r) => r.json())
      .then((data) => setServers((data.servers ?? []).slice(0, MAX_PARTNERS)))
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, []);

  if (!loading && servers.length === 0) return null;

  return (
    <section id="discover" className="py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2"><T>Partnered Communities</T></h2>
          <p className="text-[#666] text-sm"><T>Official partners verified by Serika Company.</T></p>
        </div>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 rounded-2xl bg-[#0a0a0a] border border-white/[0.06] animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {servers.map((server) => {
              // serika.cc/<code>?join=1 joins in one step once signed in.
              const code = server.joinCode || server.vanityUrlCode;
              const href = code
                ? `https://serika.cc/${encodeURIComponent(code)}?join=1`
                : `/channels/${server.id}`;
              return (
                <Link
                  key={server.id}
                  href={href}
                  className="group flex items-start gap-4 p-5 rounded-2xl bg-[#080a0f] border border-white/[0.06] hover:border-[#8B5CF6]/30 hover:bg-[#0d0f1a] transition-all duration-200"
                >
                  <ServerAvatar name={server.name} icon={server.icon} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white truncate">{server.name}</span>
                      {/* Partner badge */}
                      <svg className="w-4 h-4 shrink-0 text-[#8B5CF6]" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M8 0l1.8 3.6L14 4.5l-3 2.9.7 4.1L8 9.4l-3.7 2.1.7-4.1-3-2.9 4.2-.9z"/>
                      </svg>
                    </div>
                    {server.description && (
                      <p className="text-xs text-[#555] line-clamp-2 mb-2 group-hover:text-[#777] transition-colors">
                        {server.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 text-xs text-[#444]">
                      {typeof server.onlineCount === "number" && server.onlineCount > 0 && (
                        <span className="flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-green-500" aria-hidden />
                          {gt("{count} online", { count: server.onlineCount.toLocaleString() })}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {gt("{count} members", { count: server.memberCount.toLocaleString() })}
                      </span>
                      {code && (
                        <span className="ml-auto px-2.5 py-1 rounded-lg bg-[#8B5CF6]/15 text-[#a78bfa] font-semibold group-hover:bg-[#8B5CF6] group-hover:text-white transition-colors">
                          {gt("Join")}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
