"use client";

import { useState, useEffect } from "react";
import { Megaphone, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AnnouncementData {
  announcement: string | null;
  updatedAt: string | null;
}

export function GlobalAnnouncementBanner() {
  const [data, setData] = useState<AnnouncementData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchAnnouncement = async () => {
      try {
        const res = await fetch("/api/platform/announcement");
        if (res.ok) {
          const json = await res.json();
          if (!cancelled) setData(json);
        }
      } catch {
        // silent fail
      }
    };
    void fetchAnnouncement();
    const interval = setInterval(fetchAnnouncement, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!data?.announcement) return;
    const key = `announcement-dismissed-${data.updatedAt}`;
    if (localStorage.getItem(key)) setDismissed(true);
  }, [data]);

  if (!data?.announcement || dismissed) return null;

  const handleDismiss = () => {
    const key = `announcement-dismissed-${data.updatedAt}`;
    localStorage.setItem(key, "1");
    setDismissed(true);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#8B5CF6]/10 border-b border-[#8B5CF6]/20 text-sm">
      <Megaphone className="w-4 h-4 text-[#8B5CF6] flex-shrink-0" />
      <span className="flex-1 text-[var(--text-primary)] truncate">{data.announcement}</span>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
