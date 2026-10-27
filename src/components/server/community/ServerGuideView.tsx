"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { T, useGT } from "gt-next";
import {
  BookMarked,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Crown,
  MessageCircle,
  PartyPopper,
  Tags,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  useServerOnboarding,
  type GuideResourceView,
  type GuideTodoKind,
  type GuideTodoView,
  type ServerOnboarding,
} from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cdnImage, cn } from "@/lib/utils";
import {
  EmojiOrIcon,
  ServerBannerArt,
  ServerConnectionsList,
  ServerIconTile,
  ServerStats,
  useEstablishedLabel,
} from "./serverProfileBits";
import { useServerOptional } from "@/contexts/ServerContext";

export interface ServerGuideViewProps {
  serverId: string;
  data: ServerOnboarding;
  /** Admin preview: to-dos tick locally, nothing is saved, links go nowhere. */
  preview?: boolean;
  /** Open a channel (defaults to routing to it; preview: no-op unless given). */
  onNavigate?: (channelId: string) => void;
  /** "Pick your roles" to-do; defaults to opening Channels & Roles. */
  onOpenQuestions?: () => void;
}

function TodoGlyph({ kind }: { kind: GuideTodoKind }) {
  const cls = "w-5 h-5 text-[var(--app-accent)]";
  if (kind === "read") return <BookOpen className={cls} />;
  if (kind === "chat") return <MessageCircle className={cls} />;
  if (kind === "roles") return <Tags className={cls} />;
  return <UserRound className={cls} />;
}

const cardCls = "rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)]";
const rowFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60";

/**
 * Discord's Server Guide: banner + name, a welcome note from the owner, the
 * new member to-dos, resource links and the server's profile card.
 */
export function ServerGuideView({ serverId, data, preview = false, onNavigate, onOpenQuestions }: ServerGuideViewProps) {
  const gt = useGT();
  const router = useRouter();
  const { completeTodo } = useServerOnboarding(preview ? null : serverId);
  const [previewDone, setPreviewDone] = useState<string[]>([]);
  const established = useEstablishedLabel(data.server.createdAt);
  const uid = useId();
  const serverCtx = useServerOptional();
  const channelName = (channelId: string | null): string | null => {
    if (!channelId) return null;
    const channel = serverCtx?.channels?.find((c) => c.id === channelId && c.serverId === serverId);
    return channel ? decodeHtmlEntities(channel.name) : null;
  };

  const guide = data.guide;
  const server = data.server;
  const serverName = decodeHtmlEntities(server.name);
  const todos = guide?.todos ?? [];
  const resources = guide?.resources ?? [];
  const done = preview ? previewDone : data.member.todosDone;
  const doneCount = todos.filter((t) => done.includes(t.id)).length;
  const allDone = todos.length > 0 && doneCount === todos.length;
  const owner = data.owner;
  const ownerName = owner ? decodeHtmlEntities(owner.displayName || owner.username) : null;
  const welcomeMessage = guide?.welcomeMessage ? decodeHtmlEntities(guide.welcomeMessage) : "";
  const description = server.description ? decodeHtmlEntities(server.description) : "";

  const navigate = (channelId: string | null) => {
    if (!channelId) return;
    if (onNavigate) onNavigate(channelId);
    else if (!preview) router.push(`/channels/${serverId}/${channelId}`);
  };

  const markDone = (todoId: string) => {
    if (preview) setPreviewDone((prev) => (prev.includes(todoId) ? prev : [...prev, todoId]));
    else void completeTodo(todoId);
  };

  const runTodo = (todo: GuideTodoView) => {
    markDone(todo.id);
    if (todo.kind === "read" || todo.kind === "chat") {
      navigate(todo.channelId);
    } else if (todo.kind === "roles") {
      if (onOpenQuestions) onOpenQuestions();
      // Discord sends "Pick your roles" to Channels & Roles.
      else if (!preview && data.onboarding?.questions.length) router.push(`/channels/${serverId}/customize`);
    } else if (todo.kind === "profile" && !preview) {
      window.dispatchEvent(new CustomEvent("openUserSettings", { detail: { tab: "profiles" } }));
    }
  };

  const openResource = (resource: GuideResourceView) => navigate(resource.channelId);

  const invite = () => {
    if (preview) return;
    window.dispatchEvent(new CustomEvent("openInviteDialog", { detail: { serverId } }));
  };

  const sectionTitle = "text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]";

  return (
    <div className="@container w-full">
      <div className="mx-auto w-full max-w-[1120px] px-4 @2xl:px-6 pt-4 @2xl:pt-6 pb-14">
        {/* Banner with the server icon overlapping its bottom-left corner */}
        <div className="relative">
          <ServerBannerArt banner={server.banner} className="h-32 @2xl:h-44 @4xl:h-52 rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          </ServerBannerArt>
          <div className="absolute left-4 @2xl:left-6 -bottom-9 z-10 rounded-[24px] bg-[var(--bg-app)] p-1.5">
            <ServerIconTile name={server.name} icon={server.icon} className="w-[72px] h-[72px] @2xl:w-20 @2xl:h-20 rounded-[18px] text-xl" />
          </div>
        </div>

        {/* Name + invite */}
        <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="min-w-0 flex-1 text-2xl @2xl:text-[28px] font-extrabold leading-tight tracking-tight text-[var(--text-primary)] break-words">
            {serverName}
          </h1>
          <button
            type="button"
            onClick={invite}
            aria-disabled={preview || undefined}
            className={cn(
              "shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--app-surface-alt)] text-sm font-semibold text-[var(--text-primary)] transition-[background-color,transform] duration-150",
              preview ? "cursor-default" : "hover:bg-[var(--bg-hover)] active:scale-[0.98]",
              rowFocus,
            )}
          >
            <UserPlus className="w-4 h-4" aria-hidden />
            <T>Invite</T>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_300px] @5xl:grid-cols-[minmax(0,1fr)_320px]">
          {/* ── Main column ─────────────────────────────────────────── */}
          <div className="min-w-0 space-y-8">
            {/* Welcome note from the owner: a message card with an accent ring */}
            <section aria-labelledby={`${uid}-guide-welcome`}>
              <h2 id={`${uid}-guide-welcome`} className="sr-only">
                {gt("Welcome to {server}!", { server: serverName })}
              </h2>
              <div className="rounded-2xl bg-gradient-to-br from-[var(--app-accent)] via-[color-mix(in_srgb,var(--app-accent)_35%,transparent)] to-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] p-px shadow-[0_12px_32px_-20px_var(--app-accent)]">
                <div className="flex gap-3.5 rounded-[15px] bg-[var(--bg-card)] p-4 @2xl:p-5">
                  <div className="w-11 h-11 rounded-full overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center text-sm font-semibold text-[var(--text-primary)] shrink-0">
                    {owner?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cdnImage(owner.avatar)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span aria-hidden>{(ownerName ?? serverName).charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate text-[15px] font-semibold text-[var(--text-primary)]">{ownerName ?? serverName}</span>
                      {owner && <Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-label={gt("Server owner")} />}
                    </div>
                    <p className="mt-1 text-[15px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
                      {welcomeMessage || gt("We're glad you're here. Here's how to get started.")}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* New member to-dos ("Get Started") */}
            {todos.length > 0 && (
              <section aria-labelledby={`${uid}-guide-todos`}>
                <div className="mb-2.5 flex items-end justify-between gap-3 px-1">
                  <h2 id={`${uid}-guide-todos`} className="text-base font-bold text-[var(--text-primary)]">
                    <T>Get Started</T>
                  </h2>
                  <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                    {gt("{done} of {total} complete", { done: doneCount, total: todos.length })}
                  </span>
                </div>
                <div
                  className="mb-3 h-1 overflow-hidden rounded-full bg-[var(--app-surface-alt)]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={todos.length}
                  aria-valuenow={doneCount}
                  aria-label={gt("To-do progress")}
                >
                  <div
                    className={cn("h-full rounded-full transition-[width] duration-500 ease-out", allDone ? "bg-emerald-500" : "bg-[var(--app-accent)]")}
                    style={{ width: `${(doneCount / todos.length) * 100}%` }}
                  />
                </div>
                <ul className="space-y-2">
                  {todos.map((todo) => {
                    const isDone = done.includes(todo.id);
                    const where = channelName(todo.channelId);
                    return (
                      <li key={todo.id}>
                        <button
                          type="button"
                          onClick={() => runTodo(todo)}
                          className={cn(
                            cardCls,
                            "group w-full flex items-center gap-3.5 rounded-xl px-3.5 py-3 text-left transition-[background-color,border-color] duration-150",
                            "hover:bg-[var(--bg-hover)] hover:border-[color-mix(in_srgb,var(--app-accent)_35%,var(--border-subtle))]",
                            rowFocus,
                          )}
                        >
                          <span
                            className={cn(
                              "w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0 bg-[var(--app-surface-alt)] transition-opacity",
                              isDone && "opacity-60",
                            )}
                            aria-hidden
                          >
                            <EmojiOrIcon emoji={todo.emoji} fallback={<TodoGlyph kind={todo.kind} />} />
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className={cn("block text-sm font-semibold break-words", isDone ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]")}>
                              {decodeHtmlEntities(todo.title)}
                            </span>
                            {(where || todo.description) && (
                              <span className="block mt-0.5 text-xs text-[var(--text-muted)] break-words line-clamp-2">
                                {where ? `#${where}` : decodeHtmlEntities(todo.description)}
                              </span>
                            )}
                          </span>
                          {isDone ? (
                            <span
                              className="w-[22px] h-[22px] rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-200 motion-reduce:animate-none"
                              aria-label={gt("Done")}
                            >
                              <Check className="w-3.5 h-3.5" strokeWidth={3} />
                            </span>
                          ) : (
                            <span
                              className="w-[22px] h-[22px] rounded-full border-2 border-[var(--text-muted)]/60 shrink-0 transition-colors group-hover:border-[var(--app-accent)]"
                              aria-hidden
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {allDone && (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-500">
                    <PartyPopper className="w-4 h-4 shrink-0" aria-hidden />
                    <T>You&apos;ve finished all your to-dos. Welcome aboard!</T>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* ── Sidebar: server profile, resources, connections ────── */}
          <aside className="min-w-0 space-y-4 @3xl:sticky @3xl:top-4" aria-label={gt("Server profile")}>
            <div className={cn(cardCls, "overflow-hidden rounded-xl")}>
              <ServerBannerArt banner={server.banner} className="h-[72px]" />
              <div className="px-4 pb-4">
                <div className="relative z-10 -mt-8 mb-2 w-fit rounded-[18px] bg-[var(--bg-card)] p-1">
                  <ServerIconTile name={server.name} icon={server.icon} className="w-14 h-14 rounded-[14px] text-base" />
                </div>
                <h2 className="text-base font-bold text-[var(--text-primary)] break-words">{serverName}</h2>
                <ServerStats online={server.onlineCount} members={server.memberCount} className="mt-1 text-xs gap-x-3" />
                {established && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                    {established}
                  </div>
                )}
                {description && (
                  <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words line-clamp-6">{description}</p>
                )}
              </div>
            </div>

            {resources.length > 0 && (
              <section className={cn(cardCls, "rounded-xl p-2")} aria-labelledby={`${uid}-guide-resources`}>
                <h2 id={`${uid}-guide-resources`} className={cn(sectionTitle, "px-2 pt-1.5 pb-1")}>
                  <T>Resources</T>
                </h2>
                <ul>
                  {resources.map((resource) => {
                    const clickable = Boolean(resource.channelId) && (!preview || Boolean(onNavigate));
                    return (
                      <li key={resource.id}>
                        <button
                          type="button"
                          onClick={() => openResource(resource)}
                          aria-disabled={!clickable || undefined}
                          title={resource.description ? decodeHtmlEntities(resource.description) : undefined}
                          className={cn(
                            "group w-full flex items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                            clickable ? "hover:bg-[var(--bg-hover)]" : "cursor-default",
                            rowFocus,
                          )}
                        >
                          <span className="w-8 h-8 rounded-lg bg-[var(--app-surface-alt)] flex items-center justify-center text-base shrink-0" aria-hidden>
                            <EmojiOrIcon emoji={resource.emoji} fallback={<BookMarked className="w-4 h-4 text-[var(--app-accent)]" />} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]">
                            {decodeHtmlEntities(resource.title)}
                          </span>
                          {clickable && (
                            <ChevronRight className="w-4 h-4 shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5" aria-hidden />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {data.connections.length > 0 && (
              <section className={cn(cardCls, "rounded-xl p-2")} aria-labelledby={`${uid}-guide-connections`}>
                <h2 id={`${uid}-guide-connections`} className={cn(sectionTitle, "px-2 pt-1.5 pb-1")}>
                  <T>Connections</T>
                </h2>
                <ServerConnectionsList connections={data.connections} />
              </section>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

export default ServerGuideView;
