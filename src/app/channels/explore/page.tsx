"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ServerBadge } from "@/components/ui/badges";
import { useServer } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import { UserPanel } from "@/components/layout/ChannelSidebar";
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
  Lock,
  Mail,
} from "lucide-react";
import { cn, cdnImage } from "@/lib/utils";
import { T, useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { toast } from "sonner";

type GTFunc = ReturnType<typeof useGT>;

// The single accent used everywhere (falls back to the default brand purple).
const ACCENT = "var(--accent-color, #8B5CF6)";

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
  vanityUrlCode?: string | null;
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
  { id: "all", name: "All Communities", icon: Globe },
  { id: "gaming", name: "Gaming", icon: Gamepad2 },
  { id: "music", name: "Music", icon: Music },
  { id: "tech", name: "Tech & Programming", icon: Code },
  { id: "art", name: "Art & Design", icon: Palette },
  { id: "education", name: "Education", icon: BookOpen },
  { id: "entertainment", name: "Entertainment", icon: Film },
  { id: "anime", name: "Anime & Manga", icon: Sparkles },
  { id: "science", name: "Science", icon: Microscope },
  { id: "sports", name: "Sports & Fitness", icon: Dumbbell },
  { id: "food", name: "Food & Drink", icon: Pizza },
  { id: "travel", name: "Travel", icon: Plane },
  { id: "languages", name: "Languages", icon: Languages },
  { id: "photography", name: "Photography", icon: Camera },
  { id: "business", name: "Business", icon: Briefcase },
  { id: "lifestyle", name: "Lifestyle", icon: Heart },
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

function ServerCard({
  server,
  featured,
  onJoin,
  joining,
  isJoined,
}: {
  server: Server;
  featured?: boolean;
  onJoin: () => void;
  joining: boolean;
  isJoined: boolean;
}) {
  const gt = useGT();
  const gradient = getServerGradient(server.id + server.name);
  const isNew = isNewServer(server.createdAt);

  return (
    <div
      className={cn(
        "group relative rounded-2xl overflow-hidden flex flex-col cursor-pointer",
        "bg-[var(--bg-card)] border border-[var(--border-subtle)]",
        "transition-all duration-300 ease-in-out hover:scale-[1.015]",
        "hover:border-[var(--accent-color)]/40 hover:shadow-xl hover:shadow-black/20",
      )}
      onClick={onJoin}
    >
      {/* === BANNER === */}
      <div className={cn("relative overflow-hidden w-full", featured ? "h-32" : "h-24")}>
        {server.banner ? (
          <img src={cdnImage(server.banner)} alt="" className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700" />
        ) : (
          <div
            className="w-full h-full group-hover:scale-[1.03] transition-transform duration-700"
            style={{ background: `linear-gradient(135deg, ${gradient.from}, ${gradient.to})` }}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-white/15 to-transparent" />
          </div>
        )}

        {isNew && (
          <div
            className="absolute top-2.5 right-2.5 px-2.5 py-1 text-white text-[10px] font-bold rounded-full flex items-center gap-1 shadow-lg z-10"
            style={{ backgroundColor: ACCENT }}
          >
            <Sparkles className="w-2.5 h-2.5" />
            {gt("NEW")}
          </div>
        )}

        {/* Join mode badge */}
        {server.joinMode === "apply_to_join" && (
          <div className="absolute top-2.5 left-2.5 px-2 py-1 text-[10px] font-bold rounded-full flex items-center gap-1 shadow-lg z-10 bg-amber-500/90 text-white">
            <Mail className="w-2.5 h-2.5" />
            {gt("Apply")}
          </div>
        )}
        {server.joinMode === "invite_only" && (
          <div className="absolute top-2.5 left-2.5 px-2 py-1 text-[10px] font-bold rounded-full flex items-center gap-1 shadow-lg z-10 bg-black/60 text-white/80 backdrop-blur-sm">
            <Lock className="w-2.5 h-2.5" />
            {gt("Invite Only")}
          </div>
        )}
      </div>

      {/* === AVATAR === */}
      <div className="flex justify-center -mt-9 mb-1.5 relative z-10">
        <Avatar
          className={cn(
            "flex-shrink-0 border-4 border-[var(--bg-card)] transition-all duration-300",
            featured ? "w-[68px] h-[68px]" : "w-14 h-14"
          )}
        >
          <AvatarImage src={cdnImage(server.icon)} />
          <AvatarFallback
            className="text-white text-lg font-bold"
            style={{ backgroundColor: gradient.from }}
          >
            {server.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>

      {/* === INFO === */}
      <div className="px-4 pb-4 flex flex-col items-center text-center flex-1 w-full">
        <div className="flex flex-col items-center w-full flex-1">
          <div className="flex items-center gap-1.5 justify-center flex-wrap max-w-full">
            {server.isPartnered && <ServerBadge type="partnered" size="sm" iconOnly />}
            {server.isVerified && (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: ACCENT }} />
            )}
            <h3 className="text-[var(--text-primary)] font-bold truncate text-[15px]">{server.name}</h3>
          </div>

          <p className="text-[var(--text-secondary)] text-[13px] leading-relaxed line-clamp-2 mt-1.5 min-h-[2.4rem]">
            {server.description || gt("No description")}
          </p>

          {/* Stats row */}
          <div className="flex items-center gap-4 mt-3 text-xs text-[var(--text-muted)]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#23A55A]" />
              {formatMemberCount(server.onlineCount || 0)} {gt("Online")}
            </span>
            <span className="flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              {formatMemberCount(server.memberCount)} {gt("Members")}
            </span>
          </div>

          {/* Tags — all use the accent color */}
          {server.tags && server.tags.length > 0 && (
            <div className="flex gap-1.5 mt-3.5 flex-wrap justify-center">
              {server.tags.slice(0, 3).map((tag) => {
                const cat = categories.find((c) => c.id === tag);
                return (
                  <span
                    key={tag}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-md"
                    style={{
                      color: ACCENT,
                      backgroundColor: `color-mix(in srgb, ${ACCENT} 10%, transparent)`,
                    }}
                  >
                    {cat ? categoryLabel(cat.id, gt) : tag}
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Join button */}
        <div className="mt-auto pt-5 w-full shrink-0">
          {isJoined ? (
            <button
              disabled
              className="w-full px-4 py-2 rounded-lg bg-[#23A55A]/15 text-[#23A55A] text-sm font-semibold flex items-center justify-center gap-1.5 cursor-default"
            >
              <CheckCircle2 className="w-4 h-4" />
              {gt("Joined")}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onJoin();
              }}
              disabled={joining}
              className="w-full px-4 py-2.5 rounded-lg text-white text-sm font-semibold transition-all hover:brightness-110 hover:shadow-md active:scale-95 disabled:opacity-60"
              style={{ backgroundColor: ACCENT }}
            >
              {joining ? <Loader size={16} className="mx-auto" /> : server.joinMode === "apply_to_join" ? gt("Apply to Join") : gt("Join Server")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ExplorePage() {
  const gt = useGT();
  const router = useRouter();
  const { user } = useAuth();
  const { servers: joinedServers, fetchServers } = useServer();
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
  const [joinedServerIds, setJoinedServerIds] = useState<Set<string>>(new Set());

  // Track joined servers from ServerContext
  useEffect(() => {
    setJoinedServerIds(new Set(joinedServers.map((s) => s.id)));
  }, [joinedServers]);

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

  const handleJoinServer = useCallback(async (serverId: string) => {
    const server = servers.find((s) => s.id === serverId);
    if (!server) return;

    // Already joined — navigate to server
    if (joinedServerIds.has(serverId)) {
      router.push(`/channels/${serverId}`);
      return;
    }

    if (server.joinMode === "apply_to_join") {
      setApplyServer(server);
      setApplyAnswer("");
      return;
    }

    setJoiningServerId(serverId);
    try {
      // Try direct join first (works for open servers)
      let response = await fetch(`/api/servers/${serverId}/join`, {
        method: "POST",
      });

      // If direct join fails with 403 (invite-only), try via vanity URL or invite code
      if (!response.ok && response.status === 403 && server.vanityUrlCode) {
        response = await fetch(`/api/invites/${server.vanityUrlCode}`, {
          method: "POST",
        });
      }

      const data = await response.json();

      if (response.ok) {
        // Update joined server list reactively
        await fetchServers();
        // Optimistically mark as joined
        setJoinedServerIds((prev) => new Set(prev).add(serverId));
        toast.success(gt("Joined") + " " + server.name);
        router.push(`/channels/${serverId}`);
      } else if (response.status === 400 && data.error?.includes("Already a member")) {
        // Already a member — navigate to server
        setJoinedServerIds((prev) => new Set(prev).add(serverId));
        router.push(`/channels/${serverId}`);
      } else if (data.error === "application_required") {
        setApplyServer(server);
        setApplyAnswer("");
      } else {
        toast.error(data.error || gt("Failed to join server"));
      }
    } catch (error) {
      console.error("Failed to join server:", error);
      toast.error(gt("Something went wrong. Please try again."));
    } finally {
      setJoiningServerId(null);
    }
  }, [servers, joinedServerIds, router, fetchServers, gt]);

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
        toast.success(gt("Application submitted! You will be notified when it is reviewed."));
      } else {
        const data = await response.json();
        toast.error(data.error || gt("Failed to submit application"));
      }
    } catch (error) {
      console.error("Failed to submit application:", error);
      toast.error(gt("Something went wrong. Please try again."));
    } finally {
      setIsSubmittingApply(false);
    }
  };

  // Featured (partnered) servers only surface as a highlight strip on the default
  // "Popular / All" view. On every other view (a specific category, a search, or the
  // Trending / New sorts) partnered servers stay inline with everyone else so nothing
  // silently disappears.
  const showFeatured = selectedCategory === "all" && !debouncedSearch && sortMode === "popular";

  const featuredServers = useMemo(
    () => (showFeatured ? servers.filter((s) => s.isPartnered).slice(0, 3) : []),
    [servers, showFeatured]
  );

  const filteredServers = useMemo(() => {
    if (!showFeatured) return servers;
    const featuredIds = new Set(featuredServers.map((s) => s.id));
    return servers.filter((s) => !featuredIds.has(s.id));
  }, [servers, showFeatured, featuredServers]);

  const selectedCat = categories.find((c) => c.id === selectedCategory);

  const sectionTitle = debouncedSearch
    ? `${gt("Results for")} "${debouncedSearch}"`
    : selectedCategory === "all"
    ? sortMode === "new" ? gt("Newest Communities") : sortMode === "trending" ? gt("Trending Now") : gt("Popular Communities")
    : selectedCat ? categoryLabel(selectedCat.id, gt) : gt("Communities");

  return (
    <div className="flex-1 flex min-h-0 bg-[var(--app-bg)]">
      {/* Sidebar */}
      <aside className="w-64 hidden md:flex flex-col border-r border-[var(--border-subtle)] bg-[var(--bg-card)] flex-shrink-0">
        <div className="p-3 flex-1 overflow-y-auto">
          <h2 className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-3 px-2">
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
                    "group/cat relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                    isActive
                      ? "text-[var(--text-primary)] font-semibold"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                  )}
                  style={isActive ? { backgroundColor: `color-mix(in srgb, ${ACCENT} 10%, transparent)` } : undefined}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full" style={{ backgroundColor: ACCENT }} />
                  )}
                  <Icon className="w-[18px] h-[18px] flex-shrink-0" style={isActive ? { color: ACCENT } : undefined} />
                  <span className="flex-1 text-left truncate">{categoryLabel(category.id, gt)}</span>
                  {count > 0 && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={isActive
                        ? { color: ACCENT, backgroundColor: `color-mix(in srgb, ${ACCENT} 20%, transparent)` }
                        : { color: "var(--text-muted)", backgroundColor: "var(--bg-hover)" }}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Panel footer */}
        <div className="mt-auto shrink-0">
          <UserPanel user={user} />
        </div>
      </aside>

      {/* Main Content */}
      <ScrollArea className="flex-1 min-h-0">
        {/* Hero */}
        <div className="relative h-[200px] md:h-[280px] overflow-hidden flex-shrink-0">
          {/* Deep dark premium background with subtle radial gradient */}
          <div
            className="absolute inset-0 bg-[#0c0c0e]"
            style={{
              backgroundImage: `radial-gradient(circle at 50% -20%, color-mix(in srgb, ${ACCENT} 18%, transparent), transparent 75%)`
            }}
          />
          {/* Subtle grid pattern overlay */}
          <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.06] mix-blend-overlay" />
          
          {/* Floating subtle glowing orbs */}
          <div className="absolute top-[-10%] left-[15%] w-72 h-72 rounded-full blur-[100px] opacity-[0.1]" style={{ backgroundColor: ACCENT }} />
          <div className="absolute bottom-[-10%] right-[15%] w-80 h-80 rounded-full blur-[120px] opacity-[0.06]" style={{ backgroundColor: ACCENT }} />

          <div className="relative h-full flex flex-col items-center justify-center px-4 text-center z-10">
            <h1 className="text-3xl md:text-5xl font-extrabold text-white mb-2 tracking-tight drop-shadow-md">
              <T>Find your community</T>
            </h1>
            <p className="text-white/60 text-sm md:text-lg max-w-xl mb-6 font-medium">
              <T>From gaming, to music, to learning, there's a place for you.</T>
            </p>

            <div className="w-full max-w-xl relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-muted)] z-10 pointer-events-none" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={gt("Explore communities...")}
                className="pl-12 h-12 bg-black/40 hover:bg-black/60 focus:bg-black/85 backdrop-blur-md border border-[var(--border-subtle)] text-[var(--text-primary)] text-base placeholder:text-[var(--text-muted)] rounded-xl shadow-2xl transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--accent-color)]/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-white/10 transition-colors"
                >
                  <X className="w-4 h-4 text-[var(--text-muted)]" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile category tabs (underline style, accent — no pills) */}
        <div className="md:hidden sticky top-0 z-10 bg-[var(--app-bg)]/95 backdrop-blur border-b border-[var(--border-subtle)]">
          <div className="flex gap-1 overflow-x-auto no-scrollbar px-3">
            {categories.map((category) => {
              const Icon = category.icon;
              const isActive = selectedCategory === category.id;
              return (
                <button
                  key={category.id}
                  onClick={() => setSelectedCategory(category.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 px-4 py-3.5 text-sm font-medium whitespace-nowrap transition-colors flex-shrink-0 border-b-2",
                    isActive
                      ? "text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]"
                  )}
                  style={isActive ? { borderBottomColor: ACCENT } : undefined}
                >
                  <Icon className="w-4 h-4" style={isActive ? { color: ACCENT } : undefined} />
                  {categoryLabel(category.id, gt)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6 md:py-8">
          {/* Sort tabs + section title */}
          <div className="flex items-end justify-between mb-6 flex-wrap gap-4">
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)]">{sectionTitle}</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {filteredServers.length} {filteredServers.length === 1 ? gt("community") : gt("communities")}
                {selectedCategory === "all" && !debouncedSearch && ` • ${formatMemberCount(stats.totalMembers)} ${gt("total members")}`}
              </p>
            </div>

            {/* Sort tabs — accent underline segmented control */}
            <div className="flex items-center gap-1 bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-xl p-1 shadow-sm">
              {sortOptions.map((option) => {
                const Icon = option.icon;
                const isActive = sortMode === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => setSortMode(option.id)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150",
                      isActive ? "text-white shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]/40"
                    )}
                    style={isActive ? { backgroundColor: ACCENT } : undefined}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {sortLabel(option.id, gt)}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Featured */}
          {showFeatured && featuredServers.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-1 h-5 rounded-full" style={{ backgroundColor: ACCENT }} />
                <h3 className="text-lg font-bold text-[var(--text-primary)]"><T>Featured Communities</T></h3>
                <span
                  className="px-2 py-0.5 text-[10px] font-bold rounded-full"
                  style={{ color: ACCENT, backgroundColor: `color-mix(in srgb, ${ACCENT} 14%, transparent)` }}
                >
                  <T>PARTNERED</T>
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {featuredServers.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    featured
                    onJoin={() => handleJoinServer(server.id)}
                    joining={joiningServerId === server.id}
                    isJoined={joinedServerIds.has(server.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* All Servers */}
          <section>
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] overflow-hidden animate-pulse flex flex-col">
                    <div className="h-24 bg-[var(--bg-hover)]" />
                    <div className="flex justify-center -mt-9 mb-1.5">
                      <div className="w-14 h-14 rounded-full bg-[var(--bg-hover)] border-4 border-[var(--bg-card)]" />
                    </div>
                    <div className="px-4 pb-4 flex flex-col items-center gap-2">
                      <div className="h-4 bg-[var(--bg-hover)] rounded w-2/3" />
                      <div className="h-3 bg-[var(--bg-hover)] rounded w-full" />
                      <div className="h-3 bg-[var(--bg-hover)] rounded w-1/2" />
                      <div className="h-8 bg-[var(--bg-hover)] rounded-lg w-full mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredServers.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] flex items-center justify-center">
                  <Search className="w-10 h-10 text-[var(--text-muted)]" />
                </div>
                <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
                  {debouncedSearch ? gt("No communities found") : gt("No communities in this category yet")}
                </h3>
                <p className="text-[var(--text-muted)] text-sm max-w-md mx-auto">
                  {debouncedSearch
                    ? gt("Try a different search term or browse other categories.")
                    : gt("Be the first to list your server in this category! Enable Discoverable in your server settings.")}
                </p>
                {!debouncedSearch && selectedCategory !== "all" && (
                  <button
                    onClick={() => setSelectedCategory("all")}
                    className="mt-4 px-4 py-2 text-white text-sm font-semibold rounded-lg transition-all hover:brightness-110"
                    style={{ backgroundColor: ACCENT }}
                  >
                    <T>Browse all communities</T>
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredServers.map((server) => (
                  <ServerCard
                    key={server.id}
                    server={server}
                    onJoin={() => handleJoinServer(server.id)}
                    joining={joiningServerId === server.id}
                    isJoined={joinedServerIds.has(server.id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      {applyServer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md bg-[var(--bg-card)] rounded-2xl border border-[var(--border-subtle)] p-6 space-y-4 shadow-2xl">
            <div>
              <h3 className="text-xl font-bold text-[var(--text-primary)]">{gt("Apply to join")} {applyServer.name}</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                <T>This server requires an application. Tell them a bit about yourself.</T>
              </p>
            </div>
            <textarea
              value={applyAnswer}
              onChange={(e) => setApplyAnswer(e.target.value)}
              placeholder={gt("Why would you like to join?")}
              rows={4}
              className="w-full p-3 rounded-lg bg-[var(--app-bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-color)] resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setApplyServer(null)}
                className="px-4 py-2 text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
              >
                <T>Cancel</T>
              </button>
              <button
                onClick={() => void handleSubmitApplication()}
                disabled={!applyAnswer.trim() || isSubmittingApply}
                className="px-4 py-2 text-white rounded-lg transition-all hover:brightness-110 disabled:opacity-60"
                style={{ backgroundColor: ACCENT }}
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
