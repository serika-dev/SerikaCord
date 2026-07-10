"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useApplication } from "../useApplication";
import { Loader2, Activity, TrendingUp, Server, Users } from "lucide-react";
import { useGT } from "gt-next";

interface AnalyticsData {
  server_count: number;
  active_users: number;
  commands_used_today: number;
  commands_used_30d: number;
  interactions_today: number;
  interactions_30d: number;
  since: string;
}

export default function AnalyticsPage() {
  const gt = useGT();
  const params = useParams();
  const appId = params.id as string;
  const { app, loading } = useApplication(appId);
  const [range, setRange] = useState("7d");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);

  const daysMap: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };

  useEffect(() => {
    if (loading) return;
    setAnalyticsLoading(true);
    fetch(`/api/developers/applications/${appId}/analytics?days=${daysMap[range] || 7}`)
      .then((res) => res.json())
      .then((data) => setAnalytics(data))
      .catch(() => {})
      .finally(() => setAnalyticsLoading(false));
  }, [appId, range, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-[#8B5CF6]" />
      </div>
    );
  }

  const stats = [
    {
      label: gt("Active Servers"),
      value: analytics?.server_count ?? app?.serverCount ?? 0,
      icon: Server,
    },
    {
      label: gt("Active Users"),
      value: analytics?.active_users ?? 0,
      icon: Users,
    },
    {
      label: gt("Commands Used"),
      value: range === "24h" ? analytics?.commands_used_today ?? 0 : analytics?.commands_used_30d ?? 0,
      icon: TrendingUp,
    },
    {
      label: gt("Interactions"),
      value: range === "24h" ? analytics?.interactions_today ?? 0 : analytics?.interactions_30d ?? 0,
      icon: Activity,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">{gt("Analytics")}</h1>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="bg-[#1a1a1a] border border-white/[0.08] rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#8B5CF6]/50"
        >
          <option value="24h">{gt("Last 24 hours")}</option>
          <option value="7d">{gt("Last 7 days")}</option>
          <option value="30d">{gt("Last 30 days")}</option>
          <option value="90d">{gt("Last 90 days")}</option>
        </select>
      </div>

      {analyticsLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-[#8B5CF6]" />
        </div>
      ) : (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <stat.icon className="size-5 text-[#8B5CF6]" />
                </div>
                <p className="text-2xl font-bold">{stat.value.toLocaleString()}</p>
                <p className="text-xs text-[#888] mt-1">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Chart Placeholder */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
            <h3 className="text-sm font-semibold mb-4">{gt("Server Growth Over Time")}</h3>
            <div className="h-48 flex items-end justify-between gap-1">
              {Array.from({ length: 30 }).map((_, i) => {
                const height = Math.max(4, Math.sin(i / 5) * 30 + 40 + (analytics?.server_count ?? 0) / 10);
                return (
                  <div
                    key={i}
                    className="flex-1 bg-gradient-to-t from-[#8B5CF6]/40 to-[#8B5CF6]/80 rounded-sm"
                    style={{ height: `${Math.min(height, 100)}%` }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-2 text-xs text-[#555]">
              <span>{gt("30 days ago")}</span>
              <span>{gt("Today")}</span>
            </div>
          </div>

          <p className="text-xs text-[#555] mt-6 text-center">
            {gt("Analytics data updates every 24 hours. More detailed metrics available after verification.")}
          </p>
        </>
      )}
    </div>
  );
}
