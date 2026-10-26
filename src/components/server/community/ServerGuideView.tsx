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
      {/* Full-width banner fading into the page */}
      <ServerBannerArt
        banner={server.banner}
        className="h-36 @2xl:h-52 @4xl:h-60 [mask-image:linear-gradient(to_bottom,black_45%,transparent)]"
      />

      <div className="relative mx-auto w-full max-w-[880px] px-4 @2xl:px-8 pb-14">
        {/* Identity: icon overlapping the banner, name, stats, invite */}
        <div className="-mt-12 @2xl:-mt-14 flex flex-col gap-3 @xl:flex-row @xl:items-end @xl:gap-5">
          <div className="relative z-10 w-fit shrink-0 rounded-[28px] bg-[var(--bg-app)] p-1.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.5)]">
            <ServerIconTile name={server.name} icon={server.icon} className="w-20 h-20 @2xl:w-24 @2xl:h-24 rounded-[22px] text-2xl" />
          </div>
          <div className="min-w-0 flex-1 @xl:pb-1.5">
            <h1 className="text-2xl @2xl:text-[28px] font-extrabold leading-tight tracking-tight text-[var(--text-primary)] break-words">
              {serverName}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              <ServerStats online={server.onlineCount} members={server.memberCount} className="text-xs @2xl:text-sm" />
              {established && (
                <span className="inline-flex items-center gap-1.5 text-xs @2xl:text-sm text-[var(--text-muted)]">
                  <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                  {established}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={invite}
            aria-disabled={preview || undefined}
            className={cn(
              "w-fit shrink-0 inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent)] text-sm font-semibold shadow-sm transition-[filter,transform] duration-150 @xl:mb-1.5",
              preview ? "cursor-default" : "hover:brightness-110 active:scale-[0.98]",
              rowFocus,
            )}
          >
            <UserPlus className="w-4 h-4" aria-hidden />
            <T>Invite</T>
          </button>
        </div>

        {description && (
          <p className="mt-4 max-w-[680px] text-[15px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {description}
          </p>
        )}

        {/* Welcome note from the owner, shown like a message */}
        <section className="mt-9" aria-labelledby={`${uid}-guide-welcome`}>
          <h2 id={`${uid}-guide-welcome`} className="text-xl @2xl:text-2xl font-bold tracking-tight text-[var(--text-primary)] break-words">
            {gt("Welcome to {server}!", { server: serverName })}
          </h2>
          <div className="mt-4 flex gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center text-sm font-semibold text-[var(--text-primary)] shrink-0">
              {owner?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cdnImage(owner.avatar)} alt="" className="w-full h-full object-cover" />
              ) : (
                <span aria-hidden>{(ownerName ?? serverName).charAt(0).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{ownerName ?? serverName}</span>
                {owner && <Crown className="w-3.5 h-3.5 shrink-0 text-amber-500" aria-hidden />}
                <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-[var(--app-surface-alt)] text-[var(--text-muted)]">
                  {owner ? <T>Server owner</T> : <T>Server</T>}
                </span>
              </div>
              <div className="mt-1.5 w-fit max-w-full rounded-2xl rounded-tl-md border border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 py-3 text-[15px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap break-words">
                {welcomeMessage || gt("We're glad you're here. Here's how to get started.")}
              </div>
            </div>
          </div>
        </section>

        {/* New member to-dos */}
        {todos.length > 0 && (
          <section className="mt-10" aria-labelledby={`${uid}-guide-todos`}>
            <div className="flex items-end justify-between gap-3">
              <h2 id={`${uid}-guide-todos`} className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
                <T>New Member To-Dos</T>
              </h2>
              <span className="text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                {gt("{done} of {total} complete", { done: doneCount, total: todos.length })}
              </span>
            </div>
            <div
              className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-alt)]"
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
            <ul className="mt-3 grid grid-cols-1 gap-3 @2xl:grid-cols-2">
              {todos.map((todo) => {
                const isDone = done.includes(todo.id);
                return (
                  <li key={todo.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => runTodo(todo)}
                      className={cn(
                        cardCls,
                        "group h-full w-full flex items-center gap-3.5 rounded-xl px-4 py-3.5 text-left transition-[background-color,border-color,transform] duration-150",
                        "hover:bg-[var(--bg-hover)] hover:border-[color-mix(in_srgb,var(--app-accent)_40%,var(--border-subtle))] active:scale-[0.99]",
                        rowFocus,
                      )}
                    >
                      <span
                        className={cn(
                          "w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 transition-opacity",
                          "bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)]",
                          isDone && "opacity-60",
                        )}
                        aria-hidden
                      >
                        <EmojiOrIcon emoji={todo.emoji} fallback={<TodoGlyph kind={todo.kind} />} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={cn("block text-sm font-semibold break-words", isDone ? "text-[var(--text-muted)] line-through decoration-[var(--text-muted)]/50" : "text-[var(--text-primary)]")}>
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
                        <span
                          className="w-6 h-6 rounded-full border-2 border-[var(--border-strong,var(--border-subtle))] shrink-0 flex items-center justify-center transition-colors group-hover:border-[var(--app-accent)]"
                          aria-hidden
                        >
                          <ChevronRight className="w-3.5 h-3.5 text-[var(--app-accent)] opacity-0 transition-opacity group-hover:opacity-100" />
                        </span>
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

        {/* Resources */}
        {resources.length > 0 && (
          <section className="mt-10" aria-labelledby={`${uid}-guide-resources`}>
            <h2 id={`${uid}-guide-resources`} className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
              <T>Resources</T>
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 @xl:grid-cols-2 @4xl:grid-cols-3">
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
                      "group relative flex flex-col items-start gap-3 rounded-xl p-4 text-left transition-[background-color,border-color] duration-150",
                      clickable ? "hover:bg-[var(--bg-hover)] hover:border-[color-mix(in_srgb,var(--app-accent)_40%,var(--border-subtle))]" : "cursor-default",
                      rowFocus,
                    )}
                  >
                    <span className="w-10 h-10 rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] flex items-center justify-center text-lg shrink-0" aria-hidden>
                      <EmojiOrIcon emoji={resource.emoji} fallback={<BookMarked className="w-5 h-5 text-[var(--app-accent)]" />} />
                    </span>
                    <span className="w-full min-w-0">
                      <span className="block pr-5 text-sm font-semibold text-[var(--text-primary)] break-words">{decodeHtmlEntities(resource.title)}</span>
                      {resource.description && (
                        <span className="block mt-0.5 text-xs text-[var(--text-muted)] break-words line-clamp-3">
                          {decodeHtmlEntities(resource.description)}
                        </span>
                      )}
                    </span>
                    {clickable && (
                      <ChevronRight
                        className="absolute right-3.5 top-4 w-4 h-4 text-[var(--text-muted)] transition-[transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-[var(--text-primary)]"
                        aria-hidden
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {/* The server's linked accounts */}
        {data.connections.length > 0 && (
          <section className="mt-10" aria-labelledby={`${uid}-guide-connections`}>
            <h2 id={`${uid}-guide-connections`} className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
              <T>Connections</T>
            </h2>
            <div className={cn(cardCls, "mt-3 rounded-xl p-2")}>
              <ServerConnectionsList connections={data.connections} />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default ServerGuideView;
