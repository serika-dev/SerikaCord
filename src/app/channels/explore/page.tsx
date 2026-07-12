"use client";

import { useState, useEffect, useMemo } from "react";
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
  Flame,
  Clock,
  CheckCircle2,
  X,
  Activity,
  Heart,
  Camera,
  Dumbbell,
  Languages,
  Microscope,
  Pizza,
  Plane,
  Briefcase,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

type GTFunc = ReturnType<typeof useGT>;

function categoryLabel(id: string, gt: GTFunc): string {
  switch (id) {
    case 'all': return gt('All Communities');
    case 'gaming': return gt('Gaming');
    case 'music': return gt('Music');
    case 'tech': return gt('Tech & Programming');
    case 'art': return gt('Art & Design');
    case 'education': return gt('Education');
    case 'entertainment': return gt('Entertainment');
    case 'anime': return gt('Anime & Manga');
    case 'science': return gt('Science');
    case 'sports': return gt('Sports & Fitness');
    case 'food': return gt('Food & Drink');
    case 'travel': return gt('Travel');
    case 'languages': return gt('Languages');
    case 'photography': return gt('Photography');
    case 'business': return gt('Business');
    case 'lifestyle': return gt('Lifestyle');
    default: return id;
  }
}

function sortLabel(id: SortMode, gt: GTFunc): string {
  switch (id) {
    case 'popular': return gt('Popular');
    case 'trending': return gt('Trending');
    case 'new': return gt('New');
    default: return id;
  }
}

interface Server {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  banner?: string;
  memberCount: number;
  onlineCount?: number;
  isPartnered?: boolean;
  isVerified?: boolean;
  joinMode?: string;
  category?: string;
  tags?: string[];
  createdAt?: string;
}

interface DiscoverResponse {
  servers: Server[];
  categoryCounts?: Record<string, number>;
  totalServers?: number;
  totalMembers?: number;
  totalOnline?: number;
}

type SortMode = "popular" | "new" | "trending";

const categories = [
  { id: "all", name: "All Communities", icon: Globe, color: "#5865F2" },
  { id: "gaming", name: "Gaming", icon: Gamepad2, color: "#9146FF" },
  { id: "music", name: "Music", icon: Music, color: "#1DB954" },
  { id: "tech", name: "Tech & Programming", icon: Code, color: "#00B0FF" },
  { id: "art", name: "Art & Design", icon: Palette, color: "#FF4081" },
  { id: "education", name: "Education", icon: BookOpen, color: "#FFC107" },
  { id: "entertainment", name: "Entertainment", icon: Film, color: "#FF5722" },
  { id: "anime", name: "Anime & Manga", icon: Sparkles, color: "#E040FB" },
  { id: "science", name: "Science", icon: Microscope, color: "#00BCD4" },
  { id: "sports", name: "Sports & Fitness", icon: Dumbbell, color: "#4CAF50" },
  { id: "food", name: "Food & Drink", icon: Pizza, color: "#FF9800" },
  { id: "travel", name: "Travel", icon: Plane, color: "#2979FF" },
  { id: "languages", name: "Languages", icon: Languages, color: "#7C4DFF" },
  { id: "photography", name: "Photography", icon: Camera, color: "#F50057" },
  { id: "business", name: "Business", icon: Briefcase, color: "#607D8B" },
  { id: "lifestyle", name: "Lifestyle", icon: Heart, color: "#FF1744" },
];

const sortOptions: { id: SortMode; label: string; icon: typeof TrendingUp }[] = [
  { id: "popular", label: "Popular", icon: TrendingUp },
  { id: "trending", label: "Trending", icon: Flame },
  { id: "new", label: "New", icon: Clock },
];

const DISCOVER_GRADIENTS = [
  { from: '#5865F2', to: '#EB459E' },
  { from: '#FF3366', to: '#FFD12A' },
  { from: '#00E676', to: '#00B0FF' },
  { from: '#D500F9', to: '#FF1744' },
  { from: '#1DE9B6', to: '#3D5AFE' },
  { from: '#FF4081', to: '#E040FB' },
  { from: '#2979FF', to: '#00E5FF' },
  { from: '#7C4DFF', to: '#E040FB' },
  { from: '#F50057', to: '#FF3366' },
  { from: '#FF9800', to: '#FF5722' },
  { from: '#4CAF50', to: '#8BC34A' },
  { from: '#9C27B0', to: '#673AB7' },
  { from: '#3F51B5', to: '#2196F3' },
  { from: '#00BCD4', to: '#009688' },
  { from: '#CDDC39', to: '#FFEB3B' },
  { from: '#FFC107', to: '#FF5722' },
];

function getServerGradient(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return DISCOVER_GRADIENTS[hash % DISCOVER_GRADIENTS.length];
}

function formatMemberCount(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

function isNewServer(createdAt?: string) {
  if (!createdAt) return false;
  const diff = Date.now() - new Date(createdAt).getTime();
  return diff < 7 * 24 * 60 * 60 * 1000; // 7 days
}

function timeAgo(createdAt?: string) {
  if (!createdAt) return "";
  const diff = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  if (days < 1) return "Today";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
  const gt = useGT();
  const gradient = getServerGradient(server.id + server.name);
  const isNew = isNewServer(server.createdAt);

  return (
    <div
      className={cn(
        "group relative bg-[#111214] rounded-2xl overflow-hidden border border-[#1f1f22]",
        "hover:border-[#5865F2]/50 hover:shadow-2xl hover:shadow-[#5865F2]/10",
        "transition-all duration-300 cursor-pointer hover:-translate-y-1 flex flex-col",
      )}
      onClick={onJoin}
    >
      {/* === BANNER (top) === */}
      <div className={cn("relative overflow-hidden w-full", featured ? "h-36" : "h-28")}>
        {server.banner ? (
          <img src={server.banner} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div
            className="w-full h-full group-hover:scale-105 transition-transform duration-500"
            style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
          </div>
        )}
        {/* New badge */}
        {isNew && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-[#23A55A] text-white text-[10px] font-bold rounded-full flex items-center gap-1 shadow-lg z-10">
            <Sparkles className="w-2.5 h-2.5" />
            {gt("NEW")}
          </div>
        )}
        {/* Online pulse on banner */}
        {(server.onlineCount ?? 0) > 0 && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 px-2 py-0.5 bg-black/60 backdrop-blur-sm rounded-full z-10">
            <div className="relative">
              <div className="w-2 h-2 rounded-full bg-[#23A55A]" />
              <div className="absolute inset-0 w-2 h-2 rounded-full bg-[#23A55A] animate-ping opacity-75" />
            </div>
            <span className="text-[10px] text-white font-medium">{formatMemberCount(server.onlineCount || 0)} {gt("online")}</span>
          </div>
        )}
      </div>

      {/* === PFP (middle, overlapping banner) === */}
      <div className="flex justify-center -mt-10 mb-2 relative z-10">
        <Avatar
          className={cn(
            "flex-shrink-0 border-4 border-[#111214] ring-2 ring-transparent group-hover:ring-[#5865F2]/30 transition-all",
            featured ? "w-20 h-20" : "w-16 h-16"
          )}
        >
          <AvatarImage src={server.icon} />
          <AvatarFallback
            className="text-white text-xl font-bold"
            style={{ backgroundColor: gradient.from }}
          >
            {server.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* === SERVER INFO (below) === */}
      <div className="px-4 pb-4 flex flex-col items-center text-center flex-1">
        <div className="flex items-center gap-1.5 justify-center flex-wrap">
          {server.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
          {server.isVerified && (
            <CheckCircle2 className="w-4 h-4 text-[#5865F2] flex-shrink-0" />
          )}
          <h3 className="text-white font-bold truncate text-base">{server.name}</h3>
        </div>

        <p className="text-[#949ba4] text-sm line-clamp-2 mt-1.5 min-h-[2.5rem]">
          {server.description || gt("No description")}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-4 mt-3 text-xs text-[#949ba4]">
          <span className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-[#23A55A]" />
            {formatMemberCount(server.onlineCount || 0)} {gt("Online")}
          </span>
          <span className="flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {formatMemberCount(server.memberCount)} {gt("Members")}
          </span>
        </div>

        {/* Tags */}
        {server.tags && server.tags.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap justify-center">
            {server.tags.slice(0, 3).map((tag) => {
              const cat = categories.find((c) => c.id === tag);
              return (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs rounded-full border"
                  style={{
                    color: cat?.color || "#949ba4",
                    borderColor: `${cat?.color || "#949ba4"}30`,
                    backgroundColor: `${cat?.color || "#949ba4"}10`,
                  }}
                >
                  {cat ? categoryLabel(cat.id, gt) : tag}
                </span>
              );
            })}
          </div>
        )}

        {/* Join button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onJoin();
          }}
          disabled={joining}
          className="mt-4 w-full px-4 py-2 rounded-full bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-60 disabled:hover:scale-100"
        >
          {joining ? <Loader size={16} className="mx-auto" /> : server.joinMode === "apply_to_join" ? gt("Apply to Join") : gt("Join Server")}
        </button>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const gt = useGT();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("popular");
  const [servers, setServers] = useState<Server[]>([]);
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [stats, setStats] = useState({ totalServers: 0, totalMembers: 0, totalOnline: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [joiningServerId, setJoiningServerId] = useState<string | null>(null);
  const [applyServer, setApplyServer] = useState<Server | null>(null);
  const [applyAnswer, setApplyAnswer] = useState("");
  const [isSubmittingApply, setIsSubmittingApply] = useState(false);

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
    params.set("sort", sortMode);
    fetch(`/api/servers/discoverable?${params.toString()}`)
      .then((r) => r.json())
      .then((data: DiscoverResponse) => {
        setServers(data.servers ?? []);
        setCategoryCounts(data.categoryCounts ?? {});
        setStats({
          totalServers: data.totalServers ?? 0,
          totalMembers: data.totalMembers ?? 0,
          totalOnline: data.totalOnline ?? 0,
        });
      })
      .catch(() => setServers([]))
      .finally(() => setIsLoading(false));
  }, [selectedCategory, debouncedSearch, sortMode]);

  const handleJoinServer = async (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (server?.joinMode === "apply_to_join") {
      setApplyServer(server);
      setApplyAnswer("");
      return;
    }

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

  const handleSubmitApplication = async () => {
    if (!applyServer || !applyAnswer.trim()) return;
    setIsSubmittingApply(true);
    try {
      const response = await fetch(`/api/servers/${applyServer.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            { question: "Why would you like to join?", answer: applyAnswer.trim() },
          ],
        }),
      });
      if (response.ok) {
        setApplyServer(null);
        setApplyAnswer("");
        alert(gt("Application submitted! You will be notified when it is reviewed."));
      }
    } catch (error) {
      console.error("Failed to submit application:", error);
    } finally {
      setIsSubmittingApply(false);
    }
  };

  const filteredServers = useMemo(() => {
    if (debouncedSearch) return servers;
    return servers.filter((s) => !s.isPartnered || selectedCategory !== "all");
  }, [servers, debouncedSearch, selectedCategory]);

  const featuredServers = useMemo(
    () => servers.filter((s) => s.isPartnered).slice(0, 4),
    [servers]
  );

  const selectedCat = categories.find((c) => c.id === selectedCategory);

  return (
    <div className="flex-1 flex min-h-0 bg-[#0a0a0a]">
      {/* Sidebar */}
      <aside className="w-64 hidden md:flex flex-col border-r border-[#1f1f22] bg-[#111214] flex-shrink-0">
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-xs font-bold text-[#949ba4] uppercase tracking-wider mb-3">
            <T>Discover</T>
          </h2>
          <nav className="space-y-1">
            {categories.map((category) => {
              const Icon = category.icon;
              const count = category.id === "all" ? stats.totalServers : (categoryCounts[category.id] || 0);
              const isActive = selectedCategory === category.id;
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                    isActive
                      ? "bg-[#404249] text-white"
                      : "text-[#b5bac1] hover:bg-[#2b2d31] hover:text-white"
                  )}
                >
                  <Icon
                    className="w-4 h-4 flex-shrink-0"
                    style={isActive ? { color: category.color } : undefined}
                  />
                  <span className="flex-1 text-left truncate">{categoryLabel(category.id, gt)}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                        isActive ? "bg-[#5865F2] text-white" : "bg-[#2b2d31] text-[#949ba4]"
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Stats footer */}
        <div className="p-4 border-t border-[#1f1f22] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#949ba4] flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5" />
              <T>Communities</T>
            </span>
            <span className="text-white font-bold">{formatMemberCount(stats.totalServers)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#949ba4] flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              <T>Total Members</T>
            </span>
            <span className="text-white font-bold">{formatMemberCount(stats.totalMembers)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#949ba4] flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[#23A55A]" />
              <T>Online Now</T>
            </span>
            <span className="text-[#23A55A] font-bold">{formatMemberCount(stats.totalOnline)}</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Hero */}
        <div className="relative h-[220px] md:h-[320px] overflow-hidden flex-shrink-0">
          {/* Animated gradient background */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#5865F2] via-[#8B5CF6] to-[#EB459E]" />
          {/* Floating orbs */}
          <div className="absolute top-10 left-10 w-40 h-40 bg-white/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-10 right-20 w-52 h-52 bg-[#EB459E]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/3 w-32 h-32 bg-[#5865F2]/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
          {/* Grid overlay */}
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-20" />
          {/* Fade to background */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/40 to-transparent" />

          <div className="relative h-full flex flex-col items-center justify-center px-4 text-center">
            <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-2 drop-shadow-lg">
              <T>Find your community</T>
            </h1>
            <p className="text-white/80 text-sm md:text-lg max-w-xl mb-6">
              <T>From gaming, to music, to learning, there's a place for you.</T>
            </p>

            <div className="w-full max-w-xl relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#888888]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={gt("Explore communities...")}
                className="pl-12 h-12 bg-[#111111]/90 backdrop-blur border-none text-white text-base placeholder:text-[#888888] rounded-full"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[#2b2d31] transition-colors"
                >
                  <X className="w-4 h-4 text-[#888888]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile category pills */}
        <div className="md:hidden sticky top-0 z-10 bg-[#0a0a0a]/95 backdrop-blur border-b border-[#1f1f22] px-4 py-3">
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {categories.map((category) => {
              const Icon = category.icon;
              const isActive = selectedCategory === category.id;
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all flex-shrink-0",
                    isActive
                      ? "text-white"
                      : "text-[#b5bac1] bg-[#1f1f22] hover:bg-[#2b2d31]"
                  )}
                  style={isActive ? { backgroundColor: category.color } : undefined}
                >
                  <Icon className="w-4 h-4" />
                  {categoryLabel(category.id, gt)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 py-8">
          {/* Sort tabs + section title */}
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">
                {debouncedSearch
                  ? <>{gt("Results for")} "{debouncedSearch}"</>
                  : selectedCategory === "all"
                  ? sortMode === "new" ? gt("Newest Communities") : sortMode === "trending" ? gt("Trending Now") : gt("Popular Communities")
                  : selectedCat ? categoryLabel(selectedCat.id, gt) : gt("Communities")}
              </h2>
              <p className="text-sm text-[#949ba4] mt-0.5">
                {filteredServers.length} {filteredServers.length === 1 ? gt("community") : gt("communities")}
                {selectedCategory === "all" && !debouncedSearch && ` • ${formatMemberCount(stats.totalMembers)} ${gt("total members")}`}
              </p>
            </div>

            {/* Sort tabs */}
            <div className="flex items-center gap-1 bg-[#1f1f22] rounded-lg p-1">
              {sortOptions.map((option) => {
                const Icon = option.icon;
                const isActive = sortMode === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setSortMode(option.id)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all",
                      isActive
                        ? "bg-[#404249] text-white"
                        : "text-[#949ba4] hover:text-white"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {sortLabel(option.id, gt)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Featured */}
          {selectedCategory === "all" && !debouncedSearch && sortMode === "popular" && featuredServers.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-1 h-5 bg-gradient-to-b from-[#FFD12A] to-[#FF5722] rounded-full" />
                <h3 className="text-lg font-bold text-white"><T>Featured Communities</T></h3>
                <span className="px-2 py-0.5 bg-[#FFD12A]/10 text-[#FFD12A] text-[10px] font-bold rounded-full border border-[#FFD12A]/20">
                  <T>PARTNERED</T>
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

          {/* All Servers */}
          <section>
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-[#111214] rounded-2xl border border-[#1f1f22] overflow-hidden animate-pulse flex flex-col">
                    <div className="h-28 bg-[#1f1f22]" />
                    <div className="flex justify-center -mt-10 mb-2">
                      <div className="w-16 h-16 rounded-full bg-[#1f1f22] border-4 border-[#111214]" />
                    </div>
                    <div className="px-4 pb-4 flex flex-col items-center gap-2">
                      <div className="h-4 bg-[#1f1f22] rounded w-2/3" />
                      <div className="h-3 bg-[#1f1f22] rounded w-full" />
                      <div className="h-3 bg-[#1f1f22] rounded w-1/2" />
                      <div className="h-8 bg-[#1f1f22] rounded-full w-full mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredServers.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[#1f1f22] flex items-center justify-center">
                  <Search className="w-10 h-10 text-[#555555]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">
                  {debouncedSearch ? gt("No communities found") : gt("No communities in this category yet")}
                </h3>
                <p className="text-[#888888] text-sm max-w-md mx-auto">
                  {debouncedSearch
                    ? gt("Try a different search term or browse other categories.")
                    : gt("Be the first to list your server in this category! Enable Discoverable in your server settings.")}
                </p>
                {!debouncedSearch && selectedCategory !== "all" && (
                  <button
                    onClick={() => setSelectedCategory("all")}
                    className="mt-4 px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium rounded-full transition-colors"
                  >
                    <T>Browse all communities</T>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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

      {applyServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md bg-[#111214] rounded-xl border border-[#1f1f22] p-6 space-y-4">
            <div>
              <h3 className="text-xl font-bold text-white">{gt("Apply to join")} {applyServer.name}</h3>
              <p className="text-sm text-[#949ba4] mt-1">
                <T>This server requires an application. Tell them a bit about yourself.</T>
              </p>
            </div>
            <textarea
              value={applyAnswer}
              onChange={(e) => setApplyAnswer(e.target.value)}
              placeholder={gt("Why would you like to join?")}
              rows={4}
              className="w-full p-3 rounded-lg bg-[#1f1f22] border border-[#2b2d31] text-white placeholder:text-[#949ba4] focus:outline-none focus:border-[#5865F2] resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setApplyServer(null)}
                className="px-4 py-2 text-white hover:bg-[#2b2d31] rounded-lg transition-colors"
              >
                <T>Cancel</T>
              </button>
              <button
                onClick={() => void handleSubmitApplication()}
                disabled={!applyAnswer.trim() || isSubmittingApply}
                className="px-4 py-2 bg-[#5865F2] hover:bg-[#4752c4] disabled:opacity-60 text-white rounded-lg transition-colors"
              >
                {isSubmittingApply ? gt("Submitting...") : gt("Submit Application")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
