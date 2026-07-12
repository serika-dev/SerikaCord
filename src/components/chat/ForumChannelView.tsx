"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  MessagesSquare,
  Ticket,
  Plus,
  Lock,
  Archive, 
  Search,
  ArrowUpDown,
  Heart,
  MessageSquare,
  ArrowLeft,
  Check,
  LayoutGrid,
  List,
} from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { ChatArea } from "@/components/chat/ChatArea";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import { Loader } from "@/components/ui/Loader";

interface ForumTag {
  id: string;
  name: string;
  emojiName?: string;
}

interface ThreadOwner {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

interface ForumThread {
  id: string;
  name: string;
  type: "public_thread" | "private_thread";
  archived: boolean;
  locked: boolean;
  appliedTags: string[];
  messageCount: number;
  lastMessageId: string | null;
  createdAt: string;
  firstMessagePreview: string;
  reactionCount: number;
  owner: ThreadOwner | null;
}

interface ForumChannelViewProps {
  serverId: string;
  channelId: string;
  channelName: string;
  selectedThreadId?: string;
}

type SortBy = "latest_activity" | "creation_date";
type ViewMode = "list" | "gallery";

function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncatePreview(text: string, maxLen = 140): string {
  const plain = text
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return plain.slice(0, maxLen).trimEnd() + "…";
}

export function ForumChannelView({
  serverId,
  channelId,
  channelName,
  selectedThreadId,
}: ForumChannelViewProps) {
  const gt = useGT();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [threads, setThreads] = useState<ForumThread[]>([]);
  const [availableTags, setAvailableTags] = useState<ForumTag[]>([]);
  const [forumMode, setForumMode] = useState<"posts" | "tickets">("posts");
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [resolvedChannelName, setResolvedChannelName] = useState(channelName);

  // Search / sort / view
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("latest_activity");
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  // New-post form
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postTags, setPostTags] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const isTickets = forumMode === "tickets";
  const displayChannelName = channelName || resolvedChannelName || gt("Forum");

  // Resolve parent forum name when the component is rendered for a thread and
  // the name was not passed by the parent route.
  useEffect(() => {
    if (channelName) return;
    let cancelled = false;
    fetch(`/api/channels/${channelId}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.channel) return;
        setResolvedChannelName(data.channel.name);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId, channelName]);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/threads?archived=${showArchived}`);
      if (res.ok) {
        const data = await res.json();
        setThreads(data.threads || []);
        setAvailableTags(data.availableTags || []);
        setForumMode(data.forumMode || "posts");
      }
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [channelId, showArchived]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const handleCreate = async () => {
    if (!postTitle.trim() || !postBody.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/channels/${channelId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: postTitle.trim(),
          content: postBody.trim(),
          appliedTags: postTags,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create post");
      setCreateOpen(false);
      setPostTitle("");
      setPostBody("");
      setPostTags([]);
      toast.success(isTickets ? gt("Ticket opened") : gt("Post created"));
      router.push(`/channels/${serverId}/${data.thread.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to create post"));
    } finally {
      setCreating(false);
    }
  };

  const tagName = (id: string) => availableTags.find((t) => t.id === id)?.name;

  const filteredAndSortedThreads = useMemo(() => {
    let result = threads;
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.firstMessagePreview.toLowerCase().includes(q) ||
          (t.owner?.displayName || t.owner?.username || "").toLowerCase().includes(q)
      );
    }
    result = [...result];
    if (sortBy === "creation_date") {
      result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    // latest_activity is the default order returned by the API.
    return result;
  }, [threads, searchQuery, sortBy]);

  const showSplit = Boolean(selectedThreadId && !isMobile);

  const PostCard = ({ thread }: { thread: ForumThread }) => {
    const selected = selectedThreadId === thread.id;
    const hasReactions = thread.reactionCount > 0;
    const hasMessages = thread.messageCount > 0;

    return (
      <button
        key={thread.id}
        onClick={() => router.push(`/channels/${serverId}/${thread.id}`)}
        className={cn(
          "w-full text-left rounded-xl border transition-colors group overflow-hidden",
          selected
            ? "bg-[var(--bg-active)] border-[var(--app-accent)]"
            : "bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--app-accent)] hover:bg-[var(--bg-hover)]"
        )}
      >
        <div className="p-3.5">
          <div className="flex items-start gap-3">
            <Avatar className="w-10 h-10 shrink-0">
              <AvatarImage src={thread.owner?.avatar} />
              <AvatarFallback className="bg-[var(--app-accent)] text-white text-xs">
                {(thread.owner?.displayName || thread.owner?.username || "?").charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "font-semibold text-[var(--text-primary)] truncate group-hover:text-[var(--app-accent)]",
                        selected && "text-[var(--app-accent)]"
                      )}
                    >
                      {thread.name}
                    </span>
                    {thread.type === "private_thread" && (
                      <Lock className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                    )}
                    {thread.archived && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-active)] text-[var(--text-muted)] shrink-0">
                        {gt("Archived")}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] truncate mt-0.5">
                    {truncatePreview(thread.firstMessagePreview)}
                  </p>
                </div>
              </div>

              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-[var(--text-muted)]">
                <span className="truncate font-medium text-[var(--text-secondary)]">
                  {thread.owner?.displayName || thread.owner?.username || gt("Unknown")}
                </span>
                <span>·</span>
                <span>{formatRelativeTime(thread.createdAt)}</span>
                {hasReactions && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1 text-[var(--app-accent)]">
                      <Heart className="w-3.5 h-3.5 fill-current" />
                      {thread.reactionCount}
                    </span>
                  </>
                )}
                {hasMessages && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {thread.messageCount}
                    </span>
                  </>
                )}
              </div>

              {thread.appliedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {thread.appliedTags.map(
                    (tid) =>
                      tagName(tid) && (
                        <span
                          key={tid}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--app-accent)]/15 text-[var(--app-accent)]"
                        >
                          {tagName(tid)}
                        </span>
                      )
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  };

  const PostList = () => (
    <div className="flex-1 flex flex-col min-w-0 h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border-subtle)] shrink-0 space-y-3">
        <div className="flex items-center gap-2">
          {isTickets ? (
            <Ticket className="w-5 h-5 text-[var(--text-muted)]" />
          ) : (
            <MessagesSquare className="w-5 h-5 text-[var(--text-muted)]" />
          )}
          <span className="font-semibold text-[var(--text-primary)] truncate">
            {displayChannelName}
          </span>
          <span className="text-xs text-[var(--text-muted)] ml-auto">
            {filteredAndSortedThreads.length}{" "}
            {filteredAndSortedThreads.length === 1 ? gt("post") : gt("posts")}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={gt("Search posts")}
              className="pl-9 h-9 bg-[var(--bg-card)] border-[var(--border-subtle)] text-sm"
            />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 h-9 rounded-md text-xs font-medium text-[var(--text-muted)] bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors shrink-0">
                <ArrowUpDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{gt("Sort & View")}</span>
                <span className="sm:hidden">{gt("Sort")}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)] min-w-[180px]"
            >
              <div className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {gt("Sort by")}
              </div>
              <DropdownMenuItem
                onClick={() => setSortBy("latest_activity")}
                className="text-sm"
              >
                <span className="w-4 h-4 mr-2 flex items-center justify-center">
                  {sortBy === "latest_activity" && <Check className="w-4 h-4" />}
                </span>
                {gt("Latest Activity")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSortBy("creation_date")}
                className="text-sm"
              >
                <span className="w-4 h-4 mr-2 flex items-center justify-center">
                  {sortBy === "creation_date" && <Check className="w-4 h-4" />}
                </span>
                {gt("Creation Date")}
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />

              <div className="px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                {gt("View")}
              </div>
              <DropdownMenuItem
                onClick={() => setViewMode("list")}
                className="text-sm"
              >
                <span className="w-4 h-4 mr-2 flex items-center justify-center">
                  {viewMode === "list" && <Check className="w-4 h-4" />}
                </span>
                <List className="w-4 h-4 mr-2" />
                {gt("List")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setViewMode("gallery")}
                className="text-sm"
              >
                <span className="w-4 h-4 mr-2 flex items-center justify-center">
                  {viewMode === "gallery" && <Check className="w-4 h-4" />}
                </span>
                <LayoutGrid className="w-4 h-4 mr-2" />
                {gt("Gallery")}
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />

              <DropdownMenuCheckboxItem
                checked={showArchived}
                onCheckedChange={(checked) => setShowArchived(Boolean(checked))}
                className="text-sm"
              >
                <Archive className="w-4 h-4 mr-2" />
                {gt("Show Archived")}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            onClick={() => setCreateOpen(true)}
            className="h-9 bg-[var(--app-accent)] hover:opacity-90 text-white text-sm gap-1.5 px-3 shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">
              {isTickets ? gt("New Ticket") : gt("New Post")}
            </span>
          </Button>
        </div>
      </div>

      {isTickets && (
        <div className="px-4 py-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-card)] border-b border-[var(--border-subtle)] flex items-center gap-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {gt("Tickets are private — each is visible only to its creator and support staff.")}
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">
              <Loader size={24} />
            </div>
          ) : filteredAndSortedThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[var(--text-muted)]">
              {isTickets ? (
                <Ticket className="w-10 h-10 mb-3 opacity-40" />
              ) : (
                <MessagesSquare className="w-10 h-10 mb-3 opacity-40" />
              )}
              <p className="text-sm">
                {showArchived
                  ? gt("No archived threads.")
                  : isTickets
                  ? gt("No tickets yet. Open one to get started.")
                  : searchQuery
                  ? gt("No posts match your search.")
                  : gt("No posts yet. Be the first to post!")}
              </p>
            </div>
          ) : (
            filteredAndSortedThreads.map((thread) => <PostCard key={thread.id} thread={thread} />)
          )}
        </div>
      </ScrollArea>
    </div>
  );

  // Mobile: when a thread is open, show the chat with a back button to the forum list.
  if (selectedThreadId && isMobile) {
    return (
      <div className="flex-1 flex flex-col h-full bg-[var(--bg-primary)] min-w-0">
        <div className="flex items-center gap-2 px-4 h-12 border-b border-[var(--border-subtle)] shrink-0">
          <button
            onClick={() => router.push(`/channels/${serverId}/${channelId}`)}
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"
            aria-label={gt("Back to forum")}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium text-[var(--text-primary)] truncate">
            {gt("Back to {name}", { name: displayChannelName })}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <ChatArea onToggleMembers={() => {}} showMembers={false} />
        </div>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent className="bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg">
            <DialogHeader>
              <DialogTitle>{isTickets ? gt("Open a Ticket") : gt("Create Post")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Input
                autoFocus
                value={postTitle}
                onChange={(e) => setPostTitle(e.target.value.slice(0, 100))}
                placeholder={isTickets ? gt("Ticket subject") : gt("Post title")}
                className="bg-[var(--bg-app)] border-[var(--border-subtle)]"
              />
              <textarea
                value={postBody}
                onChange={(e) => setPostBody(e.target.value.slice(0, 4000))}
                placeholder={isTickets ? gt("Describe your issue…") : gt("What's on your mind?")}
                rows={6}
                className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] p-3 resize-none focus:outline-none focus:border-[var(--app-accent)]"
              />
              {availableTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {availableTags.map((tag) => {
                    const on = postTags.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        onClick={() =>
                          setPostTags((prev) => (on ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]))
                        }
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                          on
                            ? "bg-[var(--app-accent)]/15 border-[var(--app-accent)] text-[var(--app-accent)]"
                            : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
                        }`}
                      >
                        {tag.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" onClick={() => setCreateOpen(false)}>
                {gt("Cancel")}
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!postTitle.trim() || !postBody.trim() || creating}
                className="bg-[var(--app-accent)] hover:opacity-90 text-white gap-1.5"
              >
                {creating && <Loader size={16} />}
                {isTickets ? gt("Open Ticket") : gt("Post")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="flex-1 flex h-full bg-[var(--bg-primary)] min-w-0">
      {showSplit ? (
        <>
          <div className="w-[320px] lg:w-[400px] flex flex-col border-r border-[var(--border-subtle)] shrink-0">
            <PostList />
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <ChatArea onToggleMembers={() => {}} showMembers={false} />
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
          <PostList />
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="bg-[var(--bg-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] max-w-lg">
          <DialogHeader>
            <DialogTitle>{isTickets ? gt("Open a Ticket") : gt("Create Post")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              autoFocus
              value={postTitle}
              onChange={(e) => setPostTitle(e.target.value.slice(0, 100))}
              placeholder={isTickets ? gt("Ticket subject") : gt("Post title")}
              className="bg-[var(--bg-app)] border-[var(--border-subtle)]"
            />
            <textarea
              value={postBody}
              onChange={(e) => setPostBody(e.target.value.slice(0, 4000))}
              placeholder={isTickets ? gt("Describe your issue…") : gt("What's on your mind?")}
              rows={6}
              className="w-full rounded-lg bg-[var(--bg-app)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] p-3 resize-none focus:outline-none focus:border-[var(--app-accent)]"
            />
            {availableTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {availableTags.map((tag) => {
                  const on = postTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() =>
                        setPostTags((prev) => (on ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]))
                      }
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        on
                          ? "bg-[var(--app-accent)]/15 border-[var(--app-accent)] text-[var(--app-accent)]"
                          : "border-[var(--border-subtle)] text-[var(--text-muted)] hover:border-[var(--text-muted)]"
                      }`}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {gt("Cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!postTitle.trim() || !postBody.trim() || creating}
              className="bg-[var(--app-accent)] hover:opacity-90 text-white gap-1.5"
            >
              {creating && <Loader size={16} />}
              {isTickets ? gt("Open Ticket") : gt("Post")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
