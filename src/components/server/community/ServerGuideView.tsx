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
import { onboardingHref } from "./joinFlowPlan";

export interface ServerGuideViewProps {
  serverId: string;
  data: ServerOnboarding;
  /** Admin preview: to-dos tick locally, nothing is saved, links go nowhere. */
  preview?: boolean;
  /** Open a channel (defaults to routing to it; preview: no-op unless given). */
  onNavigate?: (channelId: string) => void;
  /** "Pick your roles" to-do; defaults to opening the join flow page at the questions. */
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
      else if (!preview && data.onboarding?.questions.length) router.push(onboardingHref(serverId, "questions"));
    } else if (todo.kind === "profile" && !preview) {
      window.dispatchEvent(new CustomEvent("openUserSettings", { detail: { tab: "profiles" } }));
    }
  };

  const openResource = (resource: GuideResourceView) => navigate(resource.channelId);

  const invite = () => {
    if (preview) return;
    window.dispatchEvent(new CustomEvent("openInviteDialog", { detail: { serverId } }));
  };

  return (
    <div className="@container w-full">
      <div className="mx-auto w-full max-w-[1100px] px-4 sm:px-6 pt-4 sm:pt-6 pb-10">
        {/* Banner with the icon overlapping its bottom-left corner */}
        <div className="relative">
          <ServerBannerArt banner={server.banner} className="h-36 sm:h-48 @4xl:h-60 rounded-2xl">
            <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
          </ServerBannerArt>
          <div className="absolute left-4 sm:left-6 -bottom-10 rounded-[26px] p-1.5 bg-[var(--bg-app)]">
            <ServerIconTile name={server.name} icon={server.icon} className="w-20 h-20 sm:w-24 sm:h-24 rounded-[20px] text-2xl" />
          </div>
        </div>

        <div className="mt-3 flex items-start gap-3 pl-[116px] sm:pl-[144px] min-h-[52px]">
          <h1 className="flex-1 min-w-0 pt-1.5 text-xl sm:text-3xl font-extrabold tracking-tight text-[var(--text-primary)] break-words">
            {serverName}
          </h1>
          <button
            type="button"
            onClick={invite}
            aria-disabled={preview || undefined}
            className={cn(
              "shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold transition-[filter]",
              preview ? "cursor-default" : "hover:brightness-110",
              rowFocus,
            )}
          >
            <UserPlus className="w-4 h-4" aria-hidden />
            <T>Invite</T>
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 @3xl:grid-cols-[minmax(0,1fr)_300px] @5xl:grid-cols-[minmax(0,1fr)_340px] items-start">
          <div className="min-w-0 space-y-6">
            {/* Welcome note from the owner */}
            <section className={cn(cardCls, "p-5")} aria-labelledby={`${uid}-guide-welcome`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center text-sm font-semibold text-[var(--text-primary)] shrink-0">
                  {owner?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cdnImage(owner.avatar)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span aria-hidden>{(ownerName ?? serverName).charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)] min-w-0">
                    <span className="truncate">{ownerName ?? serverName}</span>
                    {owner && <Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden />}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">{owner ? <T>Server owner</T> : <T>Server</T>}</div>
                </div>
              </div>
              <h2 id={`${uid}-guide-welcome`} className="mt-4 text-lg font-bold text-[var(--text-primary)] break-words">
                {gt("Welcome to {server}!", { server: serverName })}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                {welcomeMessage || gt("We're glad you're here. Here's how to get started.")}
              </p>
            </section>

            {/* New member to-dos */}
            {todos.length > 0 && (
              <section aria-labelledby={`${uid}-guide-todos`}>
                <div className="flex items-end justify-between gap-3 mb-2.5 px-1">
                  <h2 id={`${uid}-guide-todos`} className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
                    <T>New Member To-Dos</T>
                  </h2>
                  <span className="text-xs font-medium text-[var(--text-muted)] tabular-nums">
                    {gt("{done} of {total} complete", { done: doneCount, total: todos.length })}
                  </span>
                </div>
                <div className={cn(cardCls, "overflow-hidden")}>
                  <div
                    className="h-1 bg-[var(--app-surface-alt)]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={todos.length}
                    aria-valuenow={doneCount}
                    aria-label={gt("To-do progress")}
                  >
                    <div
                      className="h-full bg-[var(--app-accent)] transition-[width] duration-500 ease-out"
                      style={{ width: `${(doneCount / todos.length) * 100}%` }}
                    />
                  </div>
                  <ul className="divide-y divide-[var(--border-subtle)]">
                    {todos.map((todo) => {
                      const isDone = done.includes(todo.id);
                      return (
                        <li key={todo.id}>
                          <button
                            type="button"
                            onClick={() => runTodo(todo)}
                            className={cn("group w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-[var(--bg-hover)] transition-colors", rowFocus)}
                          >
                            <span className="w-11 h-11 rounded-xl bg-[var(--app-surface-alt)] flex items-center justify-center text-xl shrink-0" aria-hidden>
                              <EmojiOrIcon emoji={todo.emoji} fallback={<TodoGlyph kind={todo.kind} />} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className={cn("block text-sm font-semibold break-words", isDone ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]")}>
                                {decodeHtmlEntities(todo.title)}
                              </span>
                              {todo.description && (
                                <span className="block mt-0.5 text-xs text-[var(--text-muted)] break-words line-clamp-2">
                                  {decodeHtmlEntities(todo.description)}
                                </span>
                              )}
                            </span>
                            {isDone ? (
                              <span
                                className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-in zoom-in-50 duration-200 motion-reduce:animate-none"
                                aria-label={gt("Done")}
                              >
                                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                              </span>
                            ) : (
                              <ChevronRight className="w-5 h-5 text-[var(--text-muted)] shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {allDone && (
                    <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border-subtle)] bg-emerald-500/10 text-sm text-emerald-500">
                      <PartyPopper className="w-4 h-4 shrink-0" aria-hidden />
                      <T>You&apos;ve finished all your to-dos. Welcome aboard!</T>
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* Resources */}
            {resources.length > 0 && (
              <section aria-labelledby={`${uid}-guide-resources`}>
                <h2 id={`${uid}-guide-resources`} className="mb-2.5 px-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">
                  <T>Resources</T>
                </h2>
                <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                  {resources.map((resource) => {
                    const clickable = Boolean(resource.channelId) && (!preview || Boolean(onNavigate));
                    return (
                      <button
                        key={resource.id}
                        type="button"
                        onClick={() => openResource(resource)}
                        aria-disabled={!clickable || undefined}
                        className={cn(
                          cardCls,
                          "group flex items-start gap-3 p-4 text-left transition-colors",
                          clickable ? "hover:bg-[var(--bg-hover)] hover:border-[var(--app-accent)]/40" : "cursor-default",
                          rowFocus,
                        )}
                      >
                        <span className="w-10 h-10 rounded-xl bg-[var(--app-surface-alt)] flex items-center justify-center text-lg shrink-0" aria-hidden>
                          <EmojiOrIcon emoji={resource.emoji} fallback={<BookMarked className="w-5 h-5 text-[var(--app-accent)]" />} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-semibold text-[var(--text-primary)] break-words">{decodeHtmlEntities(resource.title)}</span>
                          {resource.description && (
                            <span className="block mt-0.5 text-xs text-[var(--text-muted)] break-words line-clamp-3">
                              {decodeHtmlEntities(resource.description)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {/* Server profile card */}
          <aside className={cn(cardCls, "overflow-hidden @3xl:sticky @3xl:top-4")} aria-label={gt("Server profile")}>
            <ServerBannerArt banner={server.banner} className="h-20" />
            <div className="px-4 pb-4">
              <div className="-mt-8 mb-2 inline-block rounded-[20px] p-1 bg-[var(--bg-card)]">
                <ServerIconTile name={server.name} icon={server.icon} className="w-16 h-16 rounded-2xl text-lg" />
              </div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] break-words">{serverName}</h2>
              <ServerStats online={server.onlineCount} members={server.memberCount} className="mt-1.5 text-xs" />
              {established && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                  {established}
                </div>
              )}
              {description && (
                <p className="mt-3 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{description}</p>
              )}
              {data.connections.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--border-subtle)]">
                  <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                    <T>Connections</T>
                  </h3>
                  <ServerConnectionsList connections={data.connections} className="-mx-2" />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

    </div>
  );
}

export default ServerGuideView;
