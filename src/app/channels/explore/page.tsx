"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ServerBadge } from "@/components/ui/badges";
import {
  Search,
  Users,
  TrendingUp,
  Gamepad2,
  Music,
  Code,
  Palette,
  BookOpen,
  Film,
  Sparkles,
  Globe,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Server {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  banner?: string;
  memberCount: number;
  onlineCount?: number;
  isPartnered?: boolean;
  category?: string;
  tags?: string[];
}

const categories = [
  { id: "all", name: "All", icon: Globe },
  { id: "gaming", name: "Gaming", icon: Gamepad2 },
  { id: "music", name: "Music", icon: Music },
  { id: "tech", name: "Tech & Programming", icon: Code },
  { id: "art", name: "Art & Design", icon: Palette },
  { id: "education", name: "Education", icon: BookOpen },
  { id: "entertainment", name: "Entertainment", icon: Film },
];

function formatMemberCount(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function ServerCard({
  server,
  featured,
  onJoin,
  joining,
}: {
  server: Server;
  featured?: boolean;
  onJoin: () => void;
  joining: boolean;
}) {
  return (
    <div
      className="group bg-[#111214] rounded-xl overflow-hidden border border-[#1f1f22] hover:border-[#404249] hover:shadow-xl transition-all cursor-pointer"
      onClick={onJoin}
    >
      {/* Banner */}
      <div className={cn("relative", featured ? "h-32" : "h-24")}>
        {server.banner ? (
          <img src={server.banner} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#5865F2]/40 to-[#EB459E]/40" />
        )}
      </div>

      <div className="p-4 relative">
        <div className="flex gap-3">
          <Avatar
            className={cn(
              "flex-shrink-0 border-4 border-[#111214] -mt-10",
              featured ? "w-20 h-20" : "w-16 h-16"
            )}
          >
            <AvatarImage src={server.icon} />
            <AvatarFallback className="bg-[#5865F2] text-white text-lg">
              {server.name.charAt(0)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-center gap-1.5">
              {server.isPartnered && <ServerBadge type="partnered" size="sm" />}
              <h3 className="text-white font-bold truncate">{server.name}</h3>
            </div>
            <p className="text-[#949ba4] text-sm line-clamp-2 mt-1">
              {server.description || "No description"}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-3 text-xs text-[#949ba4]">
            <span className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[#23A55A]" />
              {formatMemberCount(server.onlineCount || 0)} Online
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {formatMemberCount(server.memberCount)} Members
            </span>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onJoin();
            }}
            disabled={joining}
            className="px-4 py-1.5 rounded-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join"}
          </button>
        </div>

        {server.tags && server.tags.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {server.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="px-2 py-0.5 bg-[#1f1f22] text-[#949ba4] text-xs rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [servers, setServers] = useState<Server[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [joiningServerId, setJoiningServerId] = useState<string | null>(null);

  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (selectedCategory !== "all") params.set("category", selectedCategory);
    if (debouncedSearch) params.set("search", debouncedSearch);
    fetch(`/api/servers/discoverable?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setServers(data.servers ?? []))
      .catch(() => setServers([]))
      .finally(() => setIsLoading(false));
  }, [selectedCategory, debouncedSearch]);

  const handleJoinServer = async (serverId: string) => {
    setJoiningServerId(serverId);
    try {
      const response = await fetch(`/api/servers/${serverId}/join`, {
        method: "POST",
      });
      if (response.ok) {
        router.push(`/channels/${serverId}`);
      }
    } catch (error) {
      console.error("Failed to join server:", error);
    } finally {
      setJoiningServerId(null);
    }
  };

  const filteredServers = debouncedSearch
    ? servers
    : servers.filter((s) => !s.isPartnered || selectedCategory !== "all");

  const featuredServers = servers.filter((s) => s.isPartnered).slice(0, 4);

  return (
    <div className="flex-1 flex min-h-0 bg-[#0a0a0a]">
      {/* Sidebar */}
      <aside className="w-60 hidden md:flex flex-col border-r border-[#1f1f22] bg-[#111214]">
        <div className="p-4">
          <h2 className="text-xs font-bold text-[#949ba4] uppercase tracking-wider mb-3">
            Discover
          </h2>
          <nav className="space-y-1">
            {categories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    selectedCategory === category.id
                      ? "bg-[#404249] text-white"
                      : "text-[#b5bac1] hover:bg-[#2b2d31] hover:text-white"
                  )}
                >
                  <Icon className="w-4 h-4" />
                  {category.name}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Hero */}
        <div className="relative h-[220px] md:h-[300px] bg-gradient-to-br from-[#5865F2] via-[#8B5CF6] to-[#EB459E] overflow-hidden flex-shrink-0">
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] to-transparent" />

          <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
            <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-2">
              Find your community
            </h1>
            <p className="text-white/80 text-sm md:text-lg max-w-xl mb-6">
              From gaming, to music, to learning, there&apos;s a place for you.
            </p>

            <div className="w-full max-w-xl relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#888888]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Explore communities"
                className="pl-12 h-12 bg-[#111111]/90 backdrop-blur border-none text-white text-base placeholder:text-[#888888] rounded-full"
              />
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-8">
          {/* Featured */}
          {selectedCategory === "all" && !debouncedSearch && featuredServers.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-5 h-5 text-[var(--accent-color)]" />
                <h2 className="text-lg font-bold text-white">Featured Communities</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {featuredServers.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    featured
                    onJoin={() => handleJoinServer(server.id)}
                    joining={joiningServerId === server.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* All / Popular */}
          <section>
            <h2 className="text-lg font-bold text-white mb-4">
              {searchQuery
                ? `Results for "${searchQuery}"`
                : selectedCategory === "all"
                ? "Popular Communities"
                : `${categories.find((c) => c.id === selectedCategory)?.name} Communities`}
            </h2>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-[var(--accent-color)] animate-spin" />
              </div>
            ) : filteredServers.length === 0 ? (
              <div className="text-center py-12">
                <Search className="w-12 h-12 text-[#555555] mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-2">
                  No communities found
                </h3>
                <p className="text-[#888888] text-sm">
                  Try a different search term or browse categories
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredServers.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    onJoin={() => handleJoinServer(server.id)}
                    joining={joiningServerId === server.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}
