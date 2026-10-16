"use client";

import { useEffect, useState } from "react";
import { cdnImage } from "@/lib/utils";
import Link from "next/link";
import Image from "next/image";
import { BadgeCheck, Compass, Users } from "lucide-react";
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
        alt=""
        width={56}
        height={56}
        className="h-12 w-12 shrink-0 rounded-[14px] object-cover sm:h-14 sm:w-14 sm:rounded-[16px]"
        unoptimized
      />
    );
  }
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] sm:h-14 sm:w-14 sm:rounded-[16px] bg-[color-mix(in_srgb,var(--brand-violet)_18%,transparent)]" aria-hidden>
      <span className="text-lg font-bold text-[var(--hm-accent-text)]">{initials}</span>
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
    <section id="discover" aria-labelledby="hm-partners-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col justify-between gap-4 sm:gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="hm-label mb-2 sm:mb-3">{gt("Partners")}</p>
            <h2 id="hm-partners-title" className="hm-display hm-h2">{gt("Partnered communities")}</h2>
            <p className="hm-lede mt-3 sm:mt-5"><T>Official partners verified by Serika Company.</T></p>
          </div>
          <Link href="/channels/explore" className="hm-btn hm-btn-ghost hm-btn-compact shrink-0 self-start md:self-end">
            <Compass className="h-4 w-4" aria-hidden />
            {gt("Browse Discover")}
          </Link>
        </div>

        {loading ? (
          <div className="hm-snap-row mt-6 sm:mt-12 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" aria-busy="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="hm-card h-[132px] shrink-0 basis-[82%] animate-pulse motion-reduce:animate-none sm:basis-auto" />
            ))}
          </div>
        ) : (
          <ul className="hm-snap-row mt-6 sm:mt-12 sm:grid sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {servers.map((server) => {
              // serika.cc/<code>?join=1 joins in one step once signed in.
              const code = server.joinCode || server.vanityUrlCode;
              const href = code
                ? `https://serika.cc/${encodeURIComponent(code)}?join=1`
                : `/channels/${server.id}`;
              return (
                <li key={server.id}>
                  <Link href={href} className="hm-card group flex h-full items-start gap-3 !rounded-[16px] p-4 sm:gap-4 sm:!rounded-[24px] sm:p-5">
                    <ServerAvatar name={server.name} icon={server.icon} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-1.5">
                        <span className="truncate font-semibold text-[var(--hm-ink)]">{server.name}</span>
                        <BadgeCheck className="h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-label={gt("Partner")} />
                      </div>
                      {server.description && (
                        <p className="mb-3 line-clamp-2 text-sm leading-snug">{server.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--hm-faint)]">
                        {typeof server.onlineCount === "number" && server.onlineCount > 0 && (
                          <span className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[var(--hm-online)]" aria-hidden />
                            {gt("{count} online", { count: server.onlineCount.toLocaleString() })}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" aria-hidden />
                          {gt("{count} members", { count: server.memberCount.toLocaleString() })}
                        </span>
                        {code && (
                          <span className="ms-auto rounded-full bg-[color-mix(in_srgb,var(--brand-violet)_15%,transparent)] px-3 py-1 font-semibold text-[var(--hm-accent-text)] transition-colors group-hover:bg-[var(--brand-violet)] group-hover:text-white">
                            {gt("Join")}
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
