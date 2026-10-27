"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { T, useGT } from "gt-next";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ClipboardList, Eye, Folder, Hash, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Loader } from "@/components/ui/Loader";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useServer } from "@/contexts/ServerContext";
import { cdnImage } from "@/lib/utils";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import {
  invalidateServerOnboarding,
  type ApplicationQuestionType,
  type ApplicationQuestionView,
} from "@/hooks/useServerOnboarding";
import {
  ACCESSIBLE_CHANNELS_MAX,
  APPLICATION_CHOICES_MAX,
  APPLICATION_CHOICE_MAX,
  APPLICATION_LABEL_MAX,
  APPLICATION_QUESTIONS_MAX,
  SCREENING_DESCRIPTION_MAX,
  SCREENING_RULE_MAX,
  SCREENING_RULES_MAX,
} from "@/lib/servers/community";

// The admin preview of the join flow loads on first open.
const JoinPreviewDialog = dynamic(() => import("@/components/server/community/JoinPreviewDialog"), { ssr: false });

interface Draft {
  enabled: boolean;
  description: string;
  rules: string[];
  restrictChannels: boolean;
  accessibleChannelIds: string[];
  manualApproval: boolean;
  questions: ApplicationQuestionView[];
}

const EMPTY: Draft = {
  enabled: false,
  description: "",
  rules: [],
  restrictChannels: false,
  accessibleChannelIds: [],
  manualApproval: false,
  questions: [],
};

type Loaded = { serverId: string; draft: Draft; saved: string } | null;

interface PendingMember {
  user: { id: string; username: string | null; displayName: string | null; avatar: string | null; createdAt: string | null };
  joinedAt: string | null;
  hasRole: boolean;
  applicationId: string | null;
}

type PendingState = { serverId: string; members: PendingMember[] } | null;

function fromApi(raw: unknown): Draft {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<Draft>;
  return {
    enabled: Boolean(s.enabled),
    description: decodeHtmlEntities(s.description ?? ""),
    rules: (s.rules ?? []).map((r) => decodeHtmlEntities(r)),
    restrictChannels: Boolean(s.restrictChannels),
    accessibleChannelIds: Array.isArray(s.accessibleChannelIds) ? [...s.accessibleChannelIds] : [],
    manualApproval: Boolean(s.manualApproval),
    questions: (s.questions ?? []).map((q) => ({
      id: q.id,
      type: q.type === "paragraph" || q.type === "choice" ? q.type : "short",
      label: decodeHtmlEntities(q.label ?? ""),
      required: q.required !== false,
      choices: (q.choices ?? []).map((c) => decodeHtmlEntities(c)),
    })),
  };
}

/** What the server keeps: unlabeled questions and multiple choice with under two answers are dropped. */
function savableQuestions(questions: ApplicationQuestionView[]): ApplicationQuestionView[] {
  return questions
    .map((q) => ({ ...q, label: q.label.trim(), choices: q.type === "choice" ? q.choices.map((c) => c.trim()).filter(Boolean) : [] }))
    .filter((q) => q.label && (q.type !== "choice" || q.choices.length >= 2));
}

/** A short id the server keeps as-is (matches /^[A-Za-z0-9_-]{1,40}$/). */
function newId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rand}`;
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const fieldCls = "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";
const iconBtn = "w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent";
const addBtn = "w-full h-10 rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)] flex items-center justify-center gap-2";
const toggleRow = "flex items-center justify-between gap-4 p-4 rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer";
const sectionTitle = "text-lg font-bold text-[var(--text-primary)]";

// ─── Channel picker ─────────────────────────────────────────────────────────

interface ChannelLite {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId?: string;
}

const PICKABLE_TYPES = new Set(["text", "announcement", "forum", "voice", "stage"]);

function AccessibleChannelsPicker({
  value,
  channels,
  onChange,
}: {
  value: string[];
  channels: ChannelLite[];
  onChange: (ids: string[]) => void;
}) {
  const gt = useGT();
  const byId = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);
  const tree = useMemo(() => {
    const byPos = (a: ChannelLite, b: ChannelLite) => a.position - b.position;
    const categories = channels.filter((c) => c.type === "category").sort(byPos);
    const categoryIds = new Set(categories.map((c) => c.id));
    const eligible = channels.filter((c) => PICKABLE_TYPES.has(c.type));
    return {
      loose: eligible.filter((c) => !c.parentId || !categoryIds.has(c.parentId)).sort(byPos),
      groups: categories.map((category) => ({
        category,
        channels: eligible.filter((c) => c.parentId === category.id).sort(byPos),
      })),
    };
  }, [channels]);
  const picked = new Set(value);
  const full = value.length >= ACCESSIBLE_CHANNELS_MAX;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Visible while waiting</T></span>
        <span className="text-xs text-[var(--text-muted)]">{value.length}/{ACCESSIBLE_CHANNELS_MAX}</span>
      </div>
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const ch = byId.get(id);
            const isCategory = ch?.type === "category";
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 h-8 pl-2.5 pr-1 rounded-full bg-[var(--bg-app)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] max-w-full"
              >
                {isCategory ? <Folder className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" /> : <Hash className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />}
                <span className={isCategory ? "truncate uppercase font-semibold" : "truncate"}>{ch?.name ?? gt("Unknown channel")}</span>
                <button
                  type="button"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                  aria-label={gt("Remove {name}", { name: ch?.name ?? id })}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)]"><T>No channels picked: waiting members only see the rules.</T></p>
      )}
      <select
        value=""
        disabled={full}
        onChange={(e) => {
          if (e.target.value) onChange([...value, e.target.value]);
        }}
        aria-label={gt("Add a channel or category")}
        className={`${fieldCls} h-10 disabled:opacity-50`}
      >
        <option value="">{full ? gt("Limit reached") : gt("Add a channel or category")}</option>
        {tree.loose.map((c) => (
          <option key={c.id} value={c.id} disabled={picked.has(c.id)}>#{c.name}</option>
        ))}
        {tree.groups.map((g) => (
          <optgroup key={g.category.id} label={g.category.name}>
            <option value={g.category.id} disabled={picked.has(g.category.id)}>
              {gt("Whole category: {name}", { name: g.category.name })}
            </option>
            {g.channels.map((c) => (
              <option key={c.id} value={c.id} disabled={picked.has(c.id) || picked.has(g.category.id)}>#{c.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <p className="text-xs text-[var(--text-muted)]">
        <T>Tip: pick an Info category so new members can read it before accepting. Picking a category includes every channel in it.</T>
      </p>
    </div>
  );
}

// ─── Application questions ──────────────────────────────────────────────────

function AppQuestionCard({
  question,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  question: ApplicationQuestionView;
  index: number;
  count: number;
  onChange: (question: ApplicationQuestionView) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const filledChoices = question.choices.filter((c) => c.trim()).length;
  return (
    <div className="rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)] p-3 sm:p-4 space-y-3">
      <div className="flex items-center gap-2">
        <select
          value={question.type}
          onChange={(e) => {
            const type = e.target.value as ApplicationQuestionType;
            onChange({ ...question, type, choices: type === "choice" && question.choices.length === 0 ? ["", ""] : question.choices });
          }}
          aria-label={gt("Answer type")}
          className={`${fieldCls} h-10 flex-1 min-w-0`}
        >
          <option value="short">{gt("Short answer")}</option>
          <option value="paragraph">{gt("Paragraph")}</option>
          <option value="choice">{gt("Multiple choice")}</option>
        </select>
        <div className="flex shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={gt("Move up")} className={iconBtn}>
            <ArrowUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={gt("Move down")} className={iconBtn}>
            <ArrowDown className="w-4 h-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={gt("Delete question")} className={`${iconBtn} hover:text-red-500`}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <input
        value={question.label}
        maxLength={APPLICATION_LABEL_MAX}
        onChange={(e) => onChange({ ...question, label: e.target.value })}
        placeholder={gt("How did you find this server?")}
        aria-label={gt("Question")}
        className={`${fieldCls} h-10`}
      />
      <label className="flex items-center justify-between sm:justify-start gap-3 min-h-10 cursor-pointer">
        <span className="text-sm text-[var(--text-primary)]"><T>Required</T></span>
        <ToggleSwitch
          size="sm"
          checked={question.required}
          onCheckedChange={(checked) => onChange({ ...question, required: checked })}
          aria-label={gt("Required")}
        />
      </label>
      {question.type === "choice" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Choices</T></span>
            <span className="text-xs text-[var(--text-muted)]">{question.choices.length}/{APPLICATION_CHOICES_MAX}</span>
          </div>
          {question.choices.map((choice, ci) => (
            <div key={ci} className="flex items-center gap-2">
              <span className="w-4 h-4 shrink-0 rounded-full border-2 border-[var(--text-muted)]" aria-hidden />
              <input
                value={choice}
                maxLength={APPLICATION_CHOICE_MAX}
                onChange={(e) => onChange({ ...question, choices: question.choices.map((c, i) => (i === ci ? e.target.value : c)) })}
                placeholder={gt("Choice {n}", { n: ci + 1 })}
                aria-label={gt("Choice {n}", { n: ci + 1 })}
                className={`${fieldCls} h-10 flex-1 min-w-0`}
              />
              <button
                type="button"
                onClick={() => onChange({ ...question, choices: question.choices.filter((_, i) => i !== ci) })}
                aria-label={gt("Remove choice")}
                className={`${iconBtn} hover:text-red-500`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {question.choices.length < APPLICATION_CHOICES_MAX && (
            <button
              type="button"
              onClick={() => onChange({ ...question, choices: [...question.choices, ""] })}
              className={addBtn}
            >
              <Plus className="w-4 h-4" />
              <T>Add a choice</T>
            </button>
          )}
          {filledChoices < 2 && (
            <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <T>Add at least two choices, or this question won&apos;t be saved.</T>
            </p>
          )}
        </div>
      )}
      {!question.label.trim() && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <T>Write the question, or it won&apos;t be saved.</T>
        </p>
      )}
    </div>
  );
}

// ─── Waiting members ────────────────────────────────────────────────────────

function WaitingMembers({
  serverId,
  manualApproval,
  onOpenApplications,
}: {
  serverId: string;
  manualApproval: boolean;
  onOpenApplications?: () => void;
}) {
  const gt = useGT();
  const [state, setState] = useState<PendingState>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPending = useCallback(async (): Promise<PendingMember[]> => {
    const res = await fetch(`/api/servers/${serverId}/screening/pending`, { credentials: "include" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.members) ? (data.members as PendingMember[]) : [];
  }, [serverId]);

  useEffect(() => {
    let active = true;
    fetchPending()
      .then((members) => active && setState({ serverId, members }))
      .catch(() => active && setState({ serverId, members: [] }));
    return () => {
      active = false;
    };
  }, [serverId, fetchPending]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setState({ serverId, members: await fetchPending() });
    } catch {
      // keep the current list
    } finally {
      setRefreshing(false);
    }
  };

  const approve = async (member: PendingMember) => {
    setApproving(member.user.id);
    try {
      const res = await fetch(`/api/servers/${serverId}/screening/approve/${encodeURIComponent(member.user.id)}`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "approve failed");
      setState((s) => (s ? { ...s, members: s.members.filter((m) => m.user.id !== member.user.id) } : s));
      toast.success(gt("{name} can now talk in the server", { name: member.user.displayName || member.user.username || gt("Member") }));
    } catch {
      toast.error(gt("Could not let this member in"));
    } finally {
      setApproving(null);
    }
  };

  const members = state && state.serverId === serverId ? state.members : null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className={sectionTitle}><T>Waiting members</T></h3>
          <p className="text-sm text-[var(--text-secondary)]">
            {manualApproval
              ? gt("Members who joined but haven't been let in yet. Approving lets them talk right away.")
              : gt("Members who joined but haven't accepted the rules yet. Approving skips the rules for them.")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshing}
          aria-label={gt("Refresh")}
          className={`${iconBtn} shrink-0`}
        >
          <RefreshCw className={refreshing ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
        </button>
      </div>
      {onOpenApplications && (
        <button
          type="button"
          onClick={onOpenApplications}
          className="h-10 px-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] inline-flex items-center gap-2"
        >
          <ClipboardList className="w-4 h-4" />
          <T>Open Member Applications</T>
        </button>
      )}
      {members === null ? (
        <div className="flex items-center justify-center py-6"><Loader size={24} /></div>
      ) : members.length === 0 ? (
        <p className="py-6 text-center text-sm text-[var(--text-muted)] rounded-lg border border-dashed border-[var(--border-subtle)]">
          <T>Nobody is waiting right now.</T>
        </p>
      ) : (
        <ul className="space-y-2">
          {members.map((m) => {
            const name = m.user.displayName || m.user.username || gt("Unknown user");
            return (
              <li
                key={m.user.id}
                className="flex flex-wrap items-center gap-3 p-3 rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)]"
              >
                <Avatar className="w-10 h-10">
                  <AvatarImage src={cdnImage(m.user.avatar)} />
                  <AvatarFallback className="bg-[var(--app-accent)] text-white">{name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{name}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {m.user.username ? `@${m.user.username}` : null}
                    {m.joinedAt ? ` · ${gt("Joined {time}", { time: new Date(m.joinedAt).toLocaleString() })}` : null}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {m.applicationId && (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--app-accent)]/15 text-[var(--app-accent)]">
                        <T>Application submitted</T>
                      </span>
                    )}
                    {m.hasRole && (
                      <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                        <T>Has a role</T>
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void approve(m)}
                  disabled={approving !== null}
                  className="h-10 px-4 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 max-sm:w-full max-sm:justify-center"
                >
                  {approving === m.user.id ? <Loader size={16} /> : <Check className="w-4 h-4" />}
                  <T>Approve</T>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

/**
 * Server Settings → Rules Screening (Discord): new members accept the rules
 * before they can talk, optionally only see some channels meanwhile, and with
 * manual approval answer questions a moderator reviews.
 */
export default function ServerScreeningPanel({
  serverId,
  onOpenApplications,
}: {
  serverId: string;
  /** Switches the settings dialog to Member Applications. */
  onOpenApplications?: () => void;
}) {
  const gt = useGT();
  const { channels } = useServer();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/screening`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const draft = data ? fromApi(data.screening) : EMPTY;
        setLoaded({ serverId, draft, saved: JSON.stringify(draft) });
      })
      .catch(() => active && setLoaded({ serverId, draft: EMPTY, saved: JSON.stringify(EMPTY) }));
    return () => {
      active = false;
    };
  }, [serverId]);

  if (!loaded || loaded.serverId !== serverId) {
    return (
      <div aria-hidden className="space-y-6">
        <div className="space-y-2 max-md:hidden">
          <span className="block h-5 w-40 animate-pulse rounded bg-[var(--bg-hover)]" />
          <span className="block h-3.5 w-72 max-w-full animate-pulse rounded bg-[var(--bg-hover)]" />
        </div>
        <SettingsSkeleton variant="rows" count={5} />
      </div>
    );
  }
  const draft = loaded.draft;
  const dirty = JSON.stringify(draft) !== loaded.saved;
  const setDraft = (next: Draft) => setLoaded({ ...loaded, draft: next });
  const setRule = (index: number, value: string) =>
    setDraft({ ...draft, rules: draft.rules.map((r, i) => (i === index ? value : r)) });
  const hasRule = draft.rules.some((r) => r.trim().length > 0);
  const validRules = draft.rules.map((r) => r.trim()).filter(Boolean);
  const validQuestions = savableQuestions(draft.questions);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/screening`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          description: draft.description,
          rules: validRules,
          restrictChannels: draft.restrictChannels,
          accessibleChannelIds: draft.accessibleChannelIds,
          manualApproval: draft.manualApproval,
          questions: validQuestions,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "save failed");
      const next = fromApi(data?.screening);
      setLoaded({ serverId, draft: next, saved: JSON.stringify(next) });
      invalidateServerOnboarding(serverId);
      toast.success(gt("Rules screening saved"));
    } catch {
      toast.error(gt("Could not save rules screening"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold leading-tight text-[var(--text-primary)] mb-1 max-md:hidden"><T>Rules Screening</T></h2>
            <p className="text-sm text-[var(--text-secondary)]">
              <T>New members must read and accept your server rules before they can send messages, react or join voice.</T>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="h-10 px-4 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            <T>Preview</T>
          </button>
        </div>

        <label className={toggleRow}>
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]"><T>Require members to accept the rules</T></span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">
              <T>Applies to people who join while it is on. Members with a role are never blocked.</T>
            </span>
          </span>
          <ToggleSwitch
            checked={draft.enabled}
            disabled={!hasRule}
            onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            aria-label={gt("Require members to accept the rules")}
          />
        </label>
        {!hasRule && (
          <p className="text-xs text-[var(--text-muted)] -mt-4"><T>Add at least one rule to turn screening on.</T></p>
        )}

        <div>
          <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">
            <T>Introduction</T>
          </label>
          <textarea
            value={draft.description}
            maxLength={SCREENING_DESCRIPTION_MAX}
            rows={2}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            placeholder={gt("A short note shown above the rules")}
            className={`${fieldCls} resize-none`}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Server rules</T></label>
            <span className="text-xs text-[var(--text-muted)]">{draft.rules.length}/{SCREENING_RULES_MAX}</span>
          </div>
          {draft.rules.map((rule, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="w-6 pt-2 text-sm font-semibold text-[var(--text-muted)] text-right shrink-0">{index + 1}.</span>
              <textarea
                value={rule}
                maxLength={SCREENING_RULE_MAX}
                rows={1}
                onChange={(e) => setRule(index, e.target.value)}
                placeholder={gt("Be respectful to everyone")}
                aria-label={gt("Rule")}
                className={`${fieldCls} resize-y min-h-10 flex-1 min-w-0`}
              />
              <div className="flex shrink-0">
                <button type="button" onClick={() => setDraft({ ...draft, rules: move(draft.rules, index, -1) })} disabled={index === 0} aria-label={gt("Move up")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setDraft({ ...draft, rules: move(draft.rules, index, 1) })} disabled={index === draft.rules.length - 1} aria-label={gt("Move down")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const rules = draft.rules.filter((_, i) => i !== index);
                    setDraft({ ...draft, rules, enabled: draft.enabled && rules.some((r) => r.trim()) });
                  }}
                  aria-label={gt("Remove")}
                  className="p-2 rounded text-[var(--text-muted)] hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {draft.rules.length < SCREENING_RULES_MAX && (
            <button
              type="button"
              onClick={() => setDraft({ ...draft, rules: [...draft.rules, ""] })}
              className={addBtn}
            >
              <Plus className="w-4 h-4" />
              <T>Add a rule</T>
            </button>
          )}
        </div>
      </div>

      {!draft.enabled && (draft.restrictChannels || draft.manualApproval) && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)] -mb-4">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <T>The options below only take effect while rules screening is on.</T>
        </p>
      )}

      {/* Channel access while pending */}
      <section className="space-y-3 pt-6 border-t border-[var(--border-subtle)]">
        <div>
          <h3 className={sectionTitle}><T>Channel access while pending</T></h3>
          <p className="text-sm text-[var(--text-secondary)]">
            <T>Choose what new members can see before they&apos;re let in.</T>
          </p>
        </div>
        <label className={toggleRow}>
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]"><T>Hide channels until members are let in</T></span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">
              <T>Waiting members only see the channels and categories you pick. Everything else appears once they&apos;re in.</T>
            </span>
          </span>
          <ToggleSwitch
            checked={draft.restrictChannels}
            onCheckedChange={(checked) => setDraft({ ...draft, restrictChannels: checked })}
            aria-label={gt("Hide channels until members are let in")}
          />
        </label>
        {draft.restrictChannels && (
          <div className="p-3 sm:p-4 rounded-lg bg-[var(--bg-app)] max-md:bg-[var(--bg-card)] border border-[var(--border-subtle)]">
            <AccessibleChannelsPicker
              value={draft.accessibleChannelIds}
              channels={channels as ChannelLite[]}
              onChange={(accessibleChannelIds) => setDraft({ ...draft, accessibleChannelIds })}
            />
          </div>
        )}
      </section>

      {/* Manual approval */}
      <section className="space-y-3 pt-6 border-t border-[var(--border-subtle)]">
        <div>
          <h3 className={sectionTitle}><T>Manual approval</T></h3>
          <p className="text-sm text-[var(--text-secondary)]">
            <T>Review every new member yourself before they can talk.</T>
          </p>
        </div>
        <label className={toggleRow}>
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]"><T>A moderator must approve each member</T></span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">
              <T>After accepting the rules, members wait until someone approves them. Their answers show up in Member Applications.</T>
            </span>
          </span>
          <ToggleSwitch
            checked={draft.manualApproval}
            onCheckedChange={(checked) => setDraft({ ...draft, manualApproval: checked })}
            aria-label={gt("A moderator must approve each member")}
          />
        </label>
        {draft.manualApproval && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Application questions</T></span>
              <span className="text-xs text-[var(--text-muted)]">{draft.questions.length}/{APPLICATION_QUESTIONS_MAX}</span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              <T>Optional. Members answer these along with accepting the rules.</T>
            </p>
            {draft.questions.map((question, qi) => (
              <AppQuestionCard
                key={question.id}
                question={question}
                index={qi}
                count={draft.questions.length}
                onChange={(next) => setDraft({ ...draft, questions: draft.questions.map((q, i) => (i === qi ? next : q)) })}
                onMove={(delta) => setDraft({ ...draft, questions: move(draft.questions, qi, delta) })}
                onRemove={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== qi) })}
              />
            ))}
            {draft.questions.length < APPLICATION_QUESTIONS_MAX && (
              <button
                type="button"
                onClick={() => setDraft({
                  ...draft,
                  questions: [...draft.questions, { id: newId("a_"), type: "short", label: "", required: true, choices: [] }],
                })}
                className={addBtn}
              >
                <Plus className="w-4 h-4" />
                <T>Add a question</T>
              </button>
            )}
          </div>
        )}
      </section>

      <div className="pt-6 border-t border-[var(--border-subtle)]">
        <WaitingMembers serverId={serverId} manualApproval={draft.manualApproval} onOpenApplications={onOpenApplications} />
      </div>

      <div className="theme-solid sticky bottom-0 flex justify-end gap-2 pt-2 pb-[env(safe-area-inset-bottom)] bg-[var(--bg-card)] max-md:bg-[var(--bg-app)]">
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => setDraft(JSON.parse(loaded.saved) as Draft)}
          className="h-10 px-4 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40"
        >
          <T>Reset</T>
        </button>
        <button
          type="button"
          disabled={!dirty || saving}
          onClick={() => void save()}
          className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          {saving ? gt("Saving...") : gt("Save Changes")}
        </button>
      </div>

      <MountWhenOpened open={previewOpen}>
        <JoinPreviewDialog
          serverId={serverId}
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          startAt="flow"
          overrides={{
            screening: {
              description: draft.description.trim(),
              rules: validRules,
              manualApproval: draft.manualApproval,
              questions: draft.manualApproval ? validQuestions : [],
              restrictChannels: draft.restrictChannels,
            },
          }}
        />
      </MountWhenOpened>
    </div>
  );
}
