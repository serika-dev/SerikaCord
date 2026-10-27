"use client";

/**
 * Discord's "Channels & Roles" page (/channels/:serverId/customize):
 *
 *   Customize        the server's onboarding questions as option tiles; a
 *                    click saves at once (optimistic, rolled back with a toast
 *                    when the server refuses) and the roles follow the picks.
 *                    Beside them "My Profile": how you look in this server.
 *   Browse Channels  every channel you can see, by category, to jump into.
 *
 * Picks go through the same endpoint as the join flow
 * (POST /api/servers/:id/onboarding/responses via useServerOnboarding).
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useGT } from "gt-next";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding, type OnboardingQuestionView, type ServerOnboarding } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import {
  browseChannelCount,
  groupBrowseChannels,
  type BrowseSection,
  toggleOnboardingPick,
  unansweredRequired,
  visibleMemberRoles,
} from "@/lib/servers/serverPages";
import { cdnImage, cn } from "@/lib/utils";
import { ChannelGlyph, EmojiOrIcon, onOptionKeyDown } from "./serverProfileBits";

// Bios are markdown; the renderer is part of the chat chunk, so load it on demand.
const MarkdownRenderer = dynamic(() => import("@/components/chat/MarkdownRenderer").then((m) => m.MarkdownRenderer), {
  ssr: false,
  loading: () => <span className="block h-4 w-2/3 rounded bg-[var(--bg-hover)] animate-pulse" />,
});

type Tab = "customize" | "browse";

/** Coalesce quick clicks into one save (the endpoint is rate limited). */
const SAVE_DELAY_MS = 450;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60";

export function ChannelsRolesView({ serverId, data }: { serverId: string; data: ServerOnboarding }) {
  const gt = useGT();
  const questions = useMemo(() => data.onboarding?.questions ?? [], [data.onboarding]);
  const hasQuestions = questions.length > 0;
  const [picked, setPicked] = useState<Tab>("customize");
  const tab: Tab = hasQuestions ? picked : "browse";
  const tabsId = useId();

  const { channels, channelsServerId } = useServer();
  const sections = useMemo(
    () => (channelsServerId === serverId ? groupBrowseChannels(channels) : []),
    [channels, channelsServerId, serverId],
  );
  const channelCount = browseChannelCount(sections);

  const tabs: Array<{ id: Tab; label: string; count?: number }> = [
    ...(hasQuestions ? [{ id: "customize" as const, label: gt("Customize") }] : []),
    { id: "browse", label: gt("Browse Channels"), count: channelCount },
  ];

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const index = tabs.findIndex((t) => t.id === tab);
    const next = tabs[(index + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    if (!next) return;
    e.preventDefault();
    setPicked(next.id);
    document.getElementById(`${tabsId}-${next.id}`)?.focus();
  };

  return (
    <div className="@container w-full">
      <div className="mx-auto w-full max-w-[1240px] px-4 @2xl:px-8 pb-14">
        <div
          role="tablist"
          aria-label={gt("Channels & Roles")}
          onKeyDown={onTabKeyDown}
          className="flex gap-6 border-b border-[var(--border-subtle)] pt-3 @2xl:pt-5"
        >
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                id={`${tabsId}-${t.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`${tabsId}-${t.id}-panel`}
                tabIndex={active ? 0 : -1}
                onClick={() => setPicked(t.id)}
                className={cn(
                  "relative -mb-px flex items-center gap-2 border-b-2 pb-3 pt-1 text-[15px] font-semibold transition-colors",
                  focusRing,
                  active
                    ? "border-[var(--app-accent)] text-[var(--app-accent)]"
                    : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] font-bold leading-none tabular-nums text-[var(--text-primary)]">
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div id={`${tabsId}-${tab}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="pt-6 @2xl:pt-8">
          {tab === "customize" ? (
            <div className="grid grid-cols-1 gap-8 @4xl:grid-cols-[minmax(0,1fr)_340px]">
              <CustomizeQuestions serverId={serverId} data={data} questions={questions} />
              <MyServerProfile serverId={serverId} version={data.member.optionIds.join(",")} />
            </div>
          ) : (
            <BrowseChannels serverId={serverId} sections={sections} loading={channelsServerId !== serverId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Customize ────────────────────────────────────────────────────────────────

function CustomizeQuestions({ serverId, data, questions }: { serverId: string; data: ServerOnboarding; questions: OnboardingQuestionView[] }) {
  const gt = useGT();
  const { submitOnboarding } = useServerOnboarding(serverId);
  const { fetchChannels, fetchMembers } = useServer();
  // Unsaved picks (null: show what the server has).
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const selected = draft ?? data.member.optionIds;
  const missing = useMemo(() => (draft ? unansweredRequired(questions, draft) : []), [draft, questions]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string[] | null>(null);
  const clicks = useRef(0);

  const save = useCallback(async (picks: string[], at: number) => {
    pending.current = null;
    setSaving(true);
    const res = await submitOnboarding(picks);
    setSaving(false);
    // A newer click came in meanwhile: its picks (and their save) decide what sticks.
    if (clicks.current !== at) return;
    setDraft(null); // on success the shared store now holds `picks`; on failure this rolls back
    if (!res.ok) {
      toast.error(res.error || gt("Couldn't save your choice. Try again."));
      return;
    }
    // Roles (and with them, channel access and name colour) follow the picks.
    void fetchChannels(serverId);
    void fetchMembers(serverId);
  }, [submitOnboarding, fetchChannels, fetchMembers, serverId, gt]);

  // Leaving the page with a queued save sends it right away.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) void submitOnboarding(pending.current);
  }, [submitOnboarding]);

  const toggle = (question: OnboardingQuestionView, optionId: string) => {
    const { next, blocked } = toggleOnboardingPick(question, selected, optionId);
    if (blocked) {
      toast.message(gt("This question needs an answer."));
      return;
    }
    clicks.current += 1;
    const at = clicks.current;
    setDraft(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // The server only takes a complete set: wait until every required question has a pick.
    if (unansweredRequired(questions, next).length > 0) {
      pending.current = null;
      return;
    }
    pending.current = next;
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(next, at);
    }, SAVE_DELAY_MS);
  };

  return (
    <div className="min-w-0">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{gt("Customization Questions")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{gt("Answer questions to get access to more channels and roles.")}</p>
        {data.member.screeningBlocked && (
          <p className="mt-2 text-sm text-[var(--text-muted)]">{gt("Your picks are saved. The roles they give arrive once you're let into the server.")}</p>
        )}
      </div>
      <div className="space-y-5" aria-busy={saving || undefined}>
        {questions.map((question) => (
          <QuestionCard
            key={question.id}
            question={question}
            selected={selected}
            needsAnswer={missing.includes(question.id)}
            onToggle={(optionId) => toggle(question, optionId)}
          />
        ))}
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  selected,
  needsAnswer,
  onToggle,
}: {
  question: OnboardingQuestionView;
  selected: readonly string[];
  needsAnswer: boolean;
  onToggle: (optionId: string) => void;
}) {
  const gt = useGT();
  const uid = useId();
  const title = decodeHtmlEntities(question.title);
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={cn(
        "rounded-xl border bg-[var(--bg-card)] p-4 @2xl:p-5",
        needsAnswer ? "border-red-500/60" : "border-[var(--border-subtle)]",
      )}
    >
      <h3 id={`${uid}-title`} className="text-base font-semibold text-[var(--text-primary)] break-words">
        {title}
        {question.required && (
          <span className="ml-1 text-red-500" title={gt("Required")} aria-label={gt("Required")}>*</span>
        )}
      </h3>
      {question.description && (
        <p className="mt-1 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">{decodeHtmlEntities(question.description)}</p>
      )}
      <div
        role={question.multiple ? "group" : "radiogroup"}
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-hint`}
        aria-required={question.required || undefined}
        onKeyDown={onOptionKeyDown}
        className="mt-4 grid grid-cols-1 gap-3 @xl:grid-cols-2"
      >
        {question.options.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              data-option
              role={question.multiple ? "checkbox" : "radio"}
              aria-checked={isOn}
              onClick={() => onToggle(option.id)}
              className={cn(
                "relative flex min-h-[64px] items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors duration-150 motion-reduce:transition-none",
                focusRing,
                isOn
                  ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_12%,var(--bg-card))]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-app)] hover:border-[color-mix(in_srgb,var(--app-accent)_45%,var(--border-subtle))] hover:bg-[var(--bg-hover)]",
              )}
            >
              {option.emoji && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-2xl" aria-hidden>
                  <EmojiOrIcon emoji={option.emoji} fallback={null} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium text-[var(--text-primary)] break-words">{decodeHtmlEntities(option.title)}</span>
                {option.description && (
                  <span className="mt-0.5 block text-[13px] text-[var(--text-secondary)] break-words line-clamp-2">{decodeHtmlEntities(option.description)}</span>
                )}
              </span>
              {isOn && (
                <span
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-accent)] text-[var(--text-on-accent)] ring-2 ring-[var(--bg-card)]"
                  aria-hidden
                >
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p id={`${uid}-hint`} className={cn("mt-3 text-xs", needsAnswer ? "font-medium text-red-500" : "text-[var(--text-muted)]")} role={needsAnswer ? "alert" : undefined}>
        {needsAnswer
          ? gt("Pick an answer here to save your choices.")
          : question.multiple
            ? gt("Choose all that apply.")
            : gt("Choose one.")}
      </p>
    </section>
  );
}

// ── My Profile ───────────────────────────────────────────────────────────────

interface MyMember {
  id: string;
  username: string;
  displayName?: string | null;
  avatar?: string | null;
  bio?: string | null;
  roles?: Array<{ id: string; name: string; color?: string; position?: number; isDefault?: boolean }>;
}

/** How you look in this server: avatar, name, bio and your roles (refetched when your picks change). */
function MyServerProfile({ serverId, version }: { serverId: string; version: string }) {
  const gt = useGT();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [member, setMember] = useState<{ key: string; data: MyMember } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const key = `${serverId}:${userId}`;
    fetch(`/api/servers/${serverId}/members/${userId}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: MyMember | null) => {
        if (alive && body?.id) setMember({ key, data: body });
      })
      .catch(() => { /* keep the last copy */ });
    return () => { alive = false; };
  }, [serverId, userId, version]);

  const me = member && member.key === `${serverId}:${userId}` ? member.data : null;
  const name = me?.displayName || user?.displayName || user?.username || "";
  const avatar = me?.avatar ?? user?.avatar ?? null;
  const bio = me?.bio ?? user?.bio ?? null;
  const roles = visibleMemberRoles(me?.roles ?? []);

  return (
    <aside className="min-w-0">
      <div className="mb-5">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{gt("My Profile")}</h2>
        <p className="mt-0.5 text-sm text-[var(--text-secondary)]">{gt("This is how you'll look to others!")}</p>
      </div>
      <div className="@4xl:sticky @4xl:top-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5">
        <Avatar className="h-20 w-20">
          <AvatarImage src={cdnImage(avatar || undefined)} alt="" />
          <AvatarFallback className="bg-[var(--app-accent)] text-2xl text-[var(--text-on-accent)]">{(name || "?").charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
        <p className="mt-3 text-xl font-bold text-[var(--text-primary)] break-words">{name}</p>
        {user?.username && <p className="text-sm text-[var(--text-secondary)]">{user.username}</p>}
        {bio && (
          <div className="mt-3 text-sm text-[var(--text-primary)] break-words">
            <MarkdownRenderer content={bio} />
          </div>
        )}
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{gt("Roles")}</h3>
          {!me ? (
            <div className="flex flex-wrap gap-1.5" aria-hidden>
              <span className="h-6 w-20 rounded-md bg-[var(--bg-hover)] animate-pulse" />
              <span className="h-6 w-14 rounded-md bg-[var(--bg-hover)] animate-pulse" />
            </div>
          ) : roles.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{gt("No roles yet.")}</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {roles.map((role) => (
                <li
                  key={role.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2 py-1 text-xs font-medium text-[var(--text-primary)]"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: role.color || "var(--text-muted)" }} aria-hidden />
                  <span className="truncate">{decodeHtmlEntities(role.name)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

// ── Browse Channels ──────────────────────────────────────────────────────────

type BrowseChannel = ReturnType<typeof useServer>["channels"][number];

function BrowseChannels({
  serverId,
  sections,
  loading,
}: {
  serverId: string;
  sections: BrowseSection<BrowseChannel>[];
  loading: boolean;
}) {
  const gt = useGT();
  if (loading) {
    return (
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-14 rounded-lg bg-[var(--bg-card)] animate-pulse" />
        ))}
      </div>
    );
  }
  if (sections.length === 0) {
    return <p className="py-10 text-center text-sm text-[var(--text-secondary)]">{gt("There are no channels you can see yet.")}</p>;
  }
  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.category?.id ?? "uncategorized"} aria-label={section.category ? decodeHtmlEntities(section.category.name) : gt("Channels")}>
          {section.category && (
            <h3 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)] break-words">
              {decodeHtmlEntities(section.category.name)}
            </h3>
          )}
          <ul className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] divide-y divide-[var(--border-subtle)]">
            {section.channels.map((channel) => (
              <li key={channel.id}>
                <Link
                  href={`/channels/${serverId}/${channel.id}`}
                  prefetch={false}
                  className={cn("flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--bg-hover)]", "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]/60")}
                >
                  <ChannelGlyph type={channel.type} className="h-5 w-5 text-[var(--text-muted)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-[var(--text-primary)]">{decodeHtmlEntities(channel.name)}</span>
                    {channel.topic && (
                      <span className="block truncate text-[13px] text-[var(--text-secondary)]">{decodeHtmlEntities(channel.topic)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-[var(--app-accent)]">{gt("View")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
