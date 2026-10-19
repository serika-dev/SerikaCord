"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { T, useGT } from "gt-next";
import { AlertTriangle, ArrowDown, ArrowUp, Eye, Lock, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Loader } from "@/components/ui/Loader";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useServer } from "@/contexts/ServerContext";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import {
  invalidateServerOnboarding,
  type GuideResourceView,
  type GuideTodoKind,
  type GuideTodoView,
  type OnboardingOptionView,
  type OnboardingQuestionView,
  type ServerGuideView,
} from "@/hooks/useServerOnboarding";
import {
  GUIDE_RESOURCES_MAX,
  GUIDE_TODOS_MAX,
  GUIDE_WELCOME_MAX,
  ONBOARDING_DESCRIPTION_MAX,
  ONBOARDING_OPTIONS_MAX,
  ONBOARDING_QUESTIONS_MAX,
  ONBOARDING_ROLES_PER_OPTION,
  ONBOARDING_TITLE_MAX,
  incompleteOnboardingQuestions,
} from "@/lib/servers/onboarding";

// The admin preview of the join flow loads on first open.
const JoinPreviewDialog = dynamic(() => import("@/components/server/community/JoinPreviewDialog"), { ssr: false });

type Gt = ReturnType<typeof useGT>;

/** A role as the settings dialog knows it. */
export interface OnboardingRoleOption {
  id: string;
  name: string;
  color: string;
  position: number;
  isDefault?: boolean;
  managed?: boolean;
}

interface Draft {
  enabled: boolean;
  questions: OnboardingQuestionView[];
  guide: ServerGuideView;
}

type Loaded = { serverId: string; draft: Draft; saved: string; assignable: string[] } | null;

type PreviewAt = "invite" | "flow" | "guide";

const fieldCls = "w-full h-10 px-3 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";
const iconBtn = "w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-30 disabled:hover:bg-transparent";
const addBtn = "w-full h-10 rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)] flex items-center justify-center gap-2";
const cardCls = "rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] p-3 sm:p-4 space-y-3";
const labelCls = "block text-xs font-bold uppercase text-[var(--text-secondary)] mb-1.5";

function text(value: unknown): string {
  return typeof value === "string" ? decodeHtmlEntities(value) : "";
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value ? decodeHtmlEntities(value) : null;
}

/** A short id the server keeps as-is (matches /^[A-Za-z0-9_-]{1,40}$/). */
function newId(prefix: string): string {
  const rand = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}${rand}`;
}

function fromApi(raw: unknown): Draft {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Omit<Draft, "guide">> & { guide?: Partial<ServerGuideView> };
  const g: Partial<ServerGuideView> = o.guide ?? {};
  return {
    enabled: Boolean(o.enabled),
    questions: (o.questions ?? []).map((q) => ({
      id: q.id,
      title: text(q.title),
      description: text(q.description),
      multiple: Boolean(q.multiple),
      required: Boolean(q.required),
      options: (q.options ?? []).map((opt) => ({
        id: opt.id,
        title: text(opt.title),
        description: text(opt.description),
        emoji: optionalText(opt.emoji),
        roleIds: Array.isArray(opt.roleIds) ? [...opt.roleIds] : [],
      })),
    })),
    guide: {
      enabled: Boolean(g.enabled),
      welcomeMessage: text(g.welcomeMessage),
      todos: (g.todos ?? []).map((t) => ({
        id: t.id,
        kind: t.kind,
        title: text(t.title),
        description: text(t.description),
        channelId: t.channelId ?? null,
        emoji: optionalText(t.emoji),
      })),
      resources: (g.resources ?? []).map((r) => ({
        id: r.id,
        title: text(r.title),
        description: text(r.description),
        channelId: r.channelId ?? null,
        emoji: optionalText(r.emoji),
      })),
    },
  };
}

/** What the server keeps: untitled entries and option-less questions are dropped on save. */
/** A question with no text at all (an "Add a question" that was never filled in). */
function isBlankQuestionAt(questions: OnboardingQuestionView[], index: number): boolean {
  const q = questions[index];
  return !q.title.trim() && !q.description.trim() && q.options.every((o) => !o.title.trim() && !o.description.trim());
}

function savableQuestions(questions: OnboardingQuestionView[]): OnboardingQuestionView[] {
  return questions
    .map((q) => ({ ...q, options: q.options.filter((o) => o.title.trim()) }))
    .filter((q) => q.title.trim() && q.options.length > 0);
}

function needsChannel(kind: GuideTodoKind): boolean {
  return kind === "read" || kind === "chat";
}

function savableGuide(guide: ServerGuideView): ServerGuideView {
  return {
    ...guide,
    todos: guide.todos.filter((t) => t.title.trim() && (!needsChannel(t.kind) || t.channelId)),
    resources: guide.resources.filter((r) => r.title.trim()),
  };
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function emojiValue(value: string): string | null {
  return value === "" ? null : value;
}

function todoKindLabel(gt: Gt, kind: GuideTodoKind): string {
  switch (kind) {
    case "read": return gt("Read a channel");
    case "chat": return gt("Say hi in a channel");
    case "roles": return gt("Pick your roles");
    case "profile": return gt("Set up your profile");
  }
}

function todoDefaultTitle(gt: Gt, kind: GuideTodoKind): string {
  switch (kind) {
    case "read": return gt("Read the rules");
    case "chat": return gt("Say hi");
    case "roles": return gt("Pick your roles");
    case "profile": return gt("Set up your profile");
  }
}

function todoKindHint(gt: Gt, kind: GuideTodoKind): string {
  switch (kind) {
    case "read": return gt("Done once they open the channel.");
    case "chat": return gt("Done once they send a message in the channel.");
    case "roles": return gt("Reopens your onboarding questions so they can pick roles.");
    case "profile": return gt("Opens their profile settings.");
  }
}

// ─── Channels ───────────────────────────────────────────────────────────────

interface ChannelLite {
  id: string;
  name: string;
  type: string;
  position: number;
  parentId?: string;
}

interface ChannelGroups {
  loose: ChannelLite[];
  groups: { category: ChannelLite; channels: ChannelLite[] }[];
}

const READABLE_TYPES = new Set(["text", "announcement", "forum", "voice", "stage"]);
const CHAT_TYPES = new Set(["text", "announcement", "voice"]);

function groupChannels(channels: ChannelLite[], types: ReadonlySet<string>): ChannelGroups {
  const byPos = (a: ChannelLite, b: ChannelLite) => a.position - b.position;
  const categories = channels.filter((c) => c.type === "category").sort(byPos);
  const categoryIds = new Set(categories.map((c) => c.id));
  const eligible = channels.filter((c) => types.has(c.type));
  return {
    loose: eligible.filter((c) => !c.parentId || !categoryIds.has(c.parentId)).sort(byPos),
    groups: categories
      .map((category) => ({ category, channels: eligible.filter((c) => c.parentId === category.id).sort(byPos) }))
      .filter((g) => g.channels.length > 0),
  };
}

function ChannelSelect({
  value,
  onChange,
  groups,
  placeholder,
  ariaLabel,
  allowNone,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  groups: ChannelGroups;
  placeholder: string;
  ariaLabel: string;
  allowNone?: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      aria-label={ariaLabel}
      className={fieldCls}
    >
      <option value="" disabled={!allowNone}>{placeholder}</option>
      {groups.loose.map((c) => (
        <option key={c.id} value={c.id}>#{c.name}</option>
      ))}
      {groups.groups.map((g) => (
        <optgroup key={g.category.id} label={g.category.name}>
          {g.channels.map((c) => (
            <option key={c.id} value={c.id}>#{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

// ─── Roles ──────────────────────────────────────────────────────────────────

function roleDot(color: string | null | undefined): string {
  return color && color !== "#000000" ? color : "var(--text-muted)";
}

function RolePicker({
  roleIds,
  roles,
  assignable,
  onChange,
}: {
  roleIds: string[];
  roles: OnboardingRoleOption[];
  assignable: ReadonlySet<string>;
  onChange: (roleIds: string[]) => void;
}) {
  const gt = useGT();
  const full = roleIds.length >= ONBOARDING_ROLES_PER_OPTION;
  const available = roles.filter((r) => assignable.has(r.id) && !roleIds.includes(r.id));
  const locked = roles.filter((r) => !assignable.has(r.id) && !roleIds.includes(r.id));
  return (
    <div className="space-y-2">
      {roleIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {roleIds.map((id) => {
            const role = roles.find((r) => r.id === id);
            const canAssign = assignable.has(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1.5 h-8 pl-2.5 pr-1 rounded-full bg-[var(--bg-card)] border border-[var(--border-subtle)] text-xs text-[var(--text-primary)] max-w-full"
                title={canAssign ? undefined : gt("Set up by someone with a higher role. You can remove it but not add it back.")}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: roleDot(role?.color) }} />
                <span className="truncate">{role?.name ?? gt("Unknown role")}</span>
                {!canAssign && <Lock className="w-3 h-3 shrink-0 text-[var(--text-muted)]" />}
                <button
                  type="button"
                  onClick={() => onChange(roleIds.filter((r) => r !== id))}
                  aria-label={gt("Remove role {name}", { name: role?.name ?? id })}
                  className="w-6 h-6 flex items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <select
        value=""
        disabled={full}
        onChange={(e) => {
          if (e.target.value) onChange([...roleIds, e.target.value]);
        }}
        aria-label={gt("Add a role")}
        className={`${fieldCls} disabled:opacity-50`}
      >
        <option value="">
          {full
            ? gt("Up to {count} roles per option", { count: ONBOARDING_ROLES_PER_OPTION })
            : gt("Give a role when picked (optional)")}
        </option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
        {locked.length > 0 && (
          <optgroup label={gt("Can't be self-assigned")}>
            {locked.map((r) => (
              <option key={r.id} value={r.id} disabled>{r.name}</option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

// ─── Questions ──────────────────────────────────────────────────────────────

function OptionRow({
  option,
  index,
  roles,
  assignable,
  onChange,
  onRemove,
}: {
  option: OnboardingOptionView;
  index: number;
  roles: OnboardingRoleOption[];
  assignable: ReadonlySet<string>;
  onChange: (option: OnboardingOptionView) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  return (
    <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-app)] p-2.5 sm:p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={option.emoji ?? ""}
          maxLength={16}
          onChange={(e) => onChange({ ...option, emoji: emojiValue(e.target.value) })}
          placeholder="🙂"
          aria-label={gt("Option emoji")}
          className={`${fieldCls} w-12 shrink-0 px-0 text-center`}
        />
        <input
          value={option.title}
          maxLength={ONBOARDING_TITLE_MAX}
          onChange={(e) => onChange({ ...option, title: e.target.value })}
          placeholder={gt("Option {n}", { n: index + 1 })}
          aria-label={gt("Option title")}
          className={`${fieldCls} flex-1 min-w-0`}
        />
        <button type="button" onClick={onRemove} aria-label={gt("Remove option")} className={`${iconBtn} hover:text-red-500`}>
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <input
        value={option.description}
        maxLength={ONBOARDING_DESCRIPTION_MAX}
        onChange={(e) => onChange({ ...option, description: e.target.value })}
        placeholder={gt("Description (optional)")}
        aria-label={gt("Option description")}
        className={fieldCls}
      />
      <RolePicker
        roleIds={option.roleIds}
        roles={roles}
        assignable={assignable}
        onChange={(roleIds) => onChange({ ...option, roleIds })}
      />
    </div>
  );
}

function QuestionCard({
  question,
  index,
  count,
  roles,
  assignable,
  onChange,
  onMove,
  onRemove,
}: {
  question: OnboardingQuestionView;
  index: number;
  count: number;
  roles: OnboardingRoleOption[];
  assignable: ReadonlySet<string>;
  onChange: (question: OnboardingQuestionView) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const incomplete = !question.title.trim() || !question.options.some((o) => o.title.trim());
  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase text-[var(--text-muted)]">{gt("Question {n}", { n: index + 1 })}</span>
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
        value={question.title}
        maxLength={ONBOARDING_TITLE_MAX}
        onChange={(e) => onChange({ ...question, title: e.target.value })}
        placeholder={gt("What brings you here?")}
        aria-label={gt("Question title")}
        className={`${fieldCls} font-medium`}
      />
      <input
        value={question.description}
        maxLength={ONBOARDING_DESCRIPTION_MAX}
        onChange={(e) => onChange({ ...question, description: e.target.value })}
        placeholder={gt("Description (optional)")}
        aria-label={gt("Question description")}
        className={fieldCls}
      />
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-6">
        <label className="flex items-center justify-between sm:justify-start gap-3 min-h-10 cursor-pointer">
          <span className="text-sm text-[var(--text-primary)]"><T>Allow multiple answers</T></span>
          <ToggleSwitch
            size="sm"
            checked={question.multiple}
            onCheckedChange={(checked) => onChange({ ...question, multiple: checked })}
            aria-label={gt("Allow multiple answers")}
          />
        </label>
        <label className="flex items-center justify-between sm:justify-start gap-3 min-h-10 cursor-pointer">
          <span className="text-sm text-[var(--text-primary)]"><T>Required</T></span>
          <ToggleSwitch
            size="sm"
            checked={question.required}
            onCheckedChange={(checked) => onChange({ ...question, required: checked })}
            aria-label={gt("Required")}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Options</T></span>
          <span className="text-xs text-[var(--text-muted)]">{question.options.length}/{ONBOARDING_OPTIONS_MAX}</span>
        </div>
        {question.options.map((option, oi) => (
          <OptionRow
            key={option.id}
            option={option}
            index={oi}
            roles={roles}
            assignable={assignable}
            onChange={(next) => onChange({ ...question, options: question.options.map((o, i) => (i === oi ? next : o)) })}
            onRemove={() => onChange({ ...question, options: question.options.filter((_, i) => i !== oi) })}
          />
        ))}
        {question.options.length < ONBOARDING_OPTIONS_MAX && (
          <button
            type="button"
            onClick={() => onChange({
              ...question,
              options: [...question.options, { id: newId("o_"), title: "", description: "", emoji: null, roleIds: [] }],
            })}
            className={addBtn}
          >
            <Plus className="w-4 h-4" />
            <T>Add option</T>
          </button>
        )}
      </div>
      {incomplete && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <T>Give the question a title and at least one option, or it won&apos;t be saved.</T>
        </p>
      )}
    </div>
  );
}

// ─── Server Guide ───────────────────────────────────────────────────────────

function TodoCard({
  todo,
  index,
  count,
  readGroups,
  chatGroups,
  onChange,
  onMove,
  onRemove,
}: {
  todo: GuideTodoView;
  index: number;
  count: number;
  readGroups: ChannelGroups;
  chatGroups: ChannelGroups;
  onChange: (todo: GuideTodoView) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  const kinds: GuideTodoKind[] = ["read", "chat", "roles", "profile"];
  const missingChannel = needsChannel(todo.kind) && !todo.channelId;
  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2">
        <select
          value={todo.kind}
          onChange={(e) => {
            const kind = e.target.value as GuideTodoKind;
            // Swap the suggested title along with the kind unless it was customised.
            const keepTitle = todo.title.trim() && todo.title !== todoDefaultTitle(gt, todo.kind);
            onChange({
              ...todo,
              kind,
              title: keepTitle ? todo.title : todoDefaultTitle(gt, kind),
              channelId: needsChannel(kind) ? todo.channelId : null,
            });
          }}
          aria-label={gt("To-do type")}
          className={`${fieldCls} flex-1 min-w-0`}
        >
          {kinds.map((k) => (
            <option key={k} value={k}>{todoKindLabel(gt, k)}</option>
          ))}
        </select>
        <div className="flex shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={gt("Move up")} className={iconBtn}>
            <ArrowUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={gt("Move down")} className={iconBtn}>
            <ArrowDown className="w-4 h-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={gt("Remove to-do")} className={`${iconBtn} hover:text-red-500`}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)] -mt-1">{todoKindHint(gt, todo.kind)}</p>
      {needsChannel(todo.kind) && (
        <ChannelSelect
          value={todo.channelId}
          onChange={(channelId) => onChange({ ...todo, channelId })}
          groups={todo.kind === "chat" ? chatGroups : readGroups}
          placeholder={gt("Pick a channel")}
          ariaLabel={gt("Channel")}
        />
      )}
      <div className="flex items-center gap-2">
        <input
          value={todo.emoji ?? ""}
          maxLength={16}
          onChange={(e) => onChange({ ...todo, emoji: emojiValue(e.target.value) })}
          placeholder="✅"
          aria-label={gt("To-do emoji")}
          className={`${fieldCls} w-12 shrink-0 px-0 text-center`}
        />
        <input
          value={todo.title}
          maxLength={ONBOARDING_TITLE_MAX}
          onChange={(e) => onChange({ ...todo, title: e.target.value })}
          placeholder={todoDefaultTitle(gt, todo.kind)}
          aria-label={gt("To-do title")}
          className={`${fieldCls} flex-1 min-w-0`}
        />
      </div>
      <input
        value={todo.description}
        maxLength={ONBOARDING_DESCRIPTION_MAX}
        onChange={(e) => onChange({ ...todo, description: e.target.value })}
        placeholder={gt("Description (optional)")}
        aria-label={gt("To-do description")}
        className={fieldCls}
      />
      {(missingChannel || !todo.title.trim()) && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          {missingChannel
            ? gt("Pick a channel, or this to-do won't be saved.")
            : gt("Give the to-do a title, or it won't be saved.")}
        </p>
      )}
    </div>
  );
}

function ResourceCard({
  resource,
  index,
  count,
  groups,
  onChange,
  onMove,
  onRemove,
}: {
  resource: GuideResourceView;
  index: number;
  count: number;
  groups: ChannelGroups;
  onChange: (resource: GuideResourceView) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const gt = useGT();
  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2">
        <input
          value={resource.emoji ?? ""}
          maxLength={16}
          onChange={(e) => onChange({ ...resource, emoji: emojiValue(e.target.value) })}
          placeholder="📌"
          aria-label={gt("Resource emoji")}
          className={`${fieldCls} w-12 shrink-0 px-0 text-center`}
        />
        <input
          value={resource.title}
          maxLength={ONBOARDING_TITLE_MAX}
          onChange={(e) => onChange({ ...resource, title: e.target.value })}
          placeholder={gt("FAQ")}
          aria-label={gt("Resource title")}
          className={`${fieldCls} flex-1 min-w-0`}
        />
        <div className="flex shrink-0">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={gt("Move up")} className={iconBtn}>
            <ArrowUp className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={gt("Move down")} className={iconBtn}>
            <ArrowDown className="w-4 h-4" />
          </button>
          <button type="button" onClick={onRemove} aria-label={gt("Remove resource")} className={`${iconBtn} hover:text-red-500`}>
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      <input
        value={resource.description}
        maxLength={ONBOARDING_DESCRIPTION_MAX}
        onChange={(e) => onChange({ ...resource, description: e.target.value })}
        placeholder={gt("Description (optional)")}
        aria-label={gt("Resource description")}
        className={fieldCls}
      />
      <ChannelSelect
        value={resource.channelId}
        onChange={(channelId) => onChange({ ...resource, channelId })}
        groups={groups}
        placeholder={gt("Links to a channel (optional)")}
        ariaLabel={gt("Resource channel")}
        allowNone
      />
      {!resource.title.trim() && (
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-muted)]">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <T>Give the resource a title, or it won&apos;t be saved.</T>
        </p>
      )}
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

/**
 * Server Settings → Onboarding (Discord): questions whose answers hand out
 * roles, plus the Server Guide (welcome message, new-member to-dos, resources).
 */
export default function ServerOnboardingPanel({ serverId, roles }: { serverId: string; roles: OnboardingRoleOption[] }) {
  const gt = useGT();
  const { channels } = useServer();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ open: boolean; startAt: PreviewAt }>({ open: false, startAt: "invite" });

  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/onboarding/config`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        if (!data) {
          setFailed(true);
          return;
        }
        const draft = fromApi(data.onboarding);
        setLoaded({
          serverId,
          draft,
          saved: JSON.stringify(draft),
          assignable: Array.isArray(data.assignableRoleIds) ? data.assignableRoleIds : [],
        });
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [serverId]);

  const channelList = channels as ChannelLite[];
  const readGroups = useMemo(() => groupChannels(channelList, READABLE_TYPES), [channelList]);
  const chatGroups = useMemo(() => groupChannels(channelList, CHAT_TYPES), [channelList]);
  const sortedRoles = useMemo(
    () => roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position),
    [roles],
  );
  const assignableIds = loaded?.assignable;
  const assignable = useMemo(() => new Set(assignableIds ?? []), [assignableIds]);

  if (failed && !loaded) {
    return (
      <p className="py-12 text-center text-sm text-[var(--text-muted)]">
        <T>Could not load onboarding settings.</T>
      </p>
    );
  }
  if (!loaded || loaded.serverId !== serverId) {
    return <div className="flex items-center justify-center py-12"><Loader size={32} /></div>;
  }

  const draft = loaded.draft;
  const dirty = JSON.stringify(draft) !== loaded.saved;
  const setDraft = (next: Draft) => setLoaded({ ...loaded, draft: next });
  const setGuide = (guide: ServerGuideView) => setDraft({ ...draft, guide });
  const validQuestions = savableQuestions(draft.questions);
  const canEnable = validQuestions.length > 0;
  // Half-finished questions would be dropped on save (CORD-68): block it and
  // say which one. Completely blank questions are left out of the save.
  const incomplete = incompleteOnboardingQuestions(draft.questions);
  const firstIncomplete = incomplete.length > 0 ? incomplete[0] + 1 : null;
  const guide = draft.guide;
  const guideHasContent = guide.welcomeMessage.trim().length > 0 || guide.todos.length > 0 || guide.resources.length > 0;

  const openPreview = (startAt: PreviewAt) => setPreview({ open: true, startAt });

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/onboarding/config`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled && canEnable,
          questions: draft.questions.filter((_, i) => !isBlankQuestionAt(draft.questions, i)),
          guide: draft.guide,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "save failed");
      const next = fromApi(data?.onboarding);
      setLoaded({
        serverId,
        draft: next,
        saved: JSON.stringify(next),
        assignable: Array.isArray(data?.assignableRoleIds) ? data.assignableRoleIds : loaded.assignable,
      });
      invalidateServerOnboarding(serverId);
      toast.success(gt("Onboarding saved"));
    } catch {
      toast.error(gt("Could not save onboarding"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1 max-md:hidden"><T>Onboarding</T></h2>
            <p className="text-sm text-[var(--text-secondary)]">
              <T>Ask new members a few questions when they join. Each answer can give them roles, so they land in the right channels right away.</T>
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPreview("invite")}
            className="h-10 px-4 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            <T>Preview as new member</T>
          </button>
        </div>

        <label className="flex items-center justify-between gap-4 p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]"><T>Ask new members questions</T></span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">
              <T>Shown when someone joins. Members can change their answers later, and their roles follow.</T>
            </span>
          </span>
          <ToggleSwitch
            checked={draft.enabled && canEnable}
            disabled={!canEnable}
            onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            aria-label={gt("Ask new members questions")}
          />
        </label>
        {!canEnable && (
          <p className="text-xs text-[var(--text-muted)] -mt-2"><T>Add a question with at least one option to turn this on.</T></p>
        )}
      </div>

      {/* Questions */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Questions</T></h3>
          <span className="text-xs text-[var(--text-muted)]">{draft.questions.length}/{ONBOARDING_QUESTIONS_MAX}</span>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          <T>Roles with moderation or admin permissions, bot roles and roles above yours can&apos;t be self-assigned, so they aren&apos;t offered.</T>
        </p>
        {draft.questions.map((question, qi) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={qi}
            count={draft.questions.length}
            roles={sortedRoles}
            assignable={assignable}
            onChange={(next) => setDraft({ ...draft, questions: draft.questions.map((q, i) => (i === qi ? next : q)) })}
            onMove={(delta) => setDraft({ ...draft, questions: move(draft.questions, qi, delta) })}
            onRemove={() => setDraft({ ...draft, questions: draft.questions.filter((_, i) => i !== qi) })}
          />
        ))}
        {draft.questions.length < ONBOARDING_QUESTIONS_MAX && (
          <button
            type="button"
            onClick={() => setDraft({
              ...draft,
              questions: [
                ...draft.questions,
                {
                  id: newId("q_"),
                  title: "",
                  description: "",
                  multiple: false,
                  required: false,
                  options: [{ id: newId("o_"), title: "", description: "", emoji: null, roleIds: [] }],
                },
              ],
            })}
            className={addBtn}
          >
            <Plus className="w-4 h-4" />
            <T>Add question</T>
          </button>
        )}
      </section>

      {/* Server Guide */}
      <section className="space-y-4 pt-2 border-t border-[var(--border-subtle)]">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pt-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-[var(--text-primary)] mb-1"><T>Server Guide</T></h3>
            <p className="text-sm text-[var(--text-secondary)]">
              <T>A home page for new members: a welcome message, a short to-do list and links to your most useful channels.</T>
            </p>
          </div>
          <button
            type="button"
            onClick={() => openPreview("guide")}
            className="h-10 px-4 shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] flex items-center justify-center gap-2"
          >
            <Eye className="w-4 h-4" />
            <T>Preview Server Guide</T>
          </button>
        </div>

        <label className="flex items-center justify-between gap-4 p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
          <span>
            <span className="block text-sm font-medium text-[var(--text-primary)]"><T>Show the Server Guide</T></span>
            <span className="block text-xs text-[var(--text-muted)] mt-1">
              <T>New members see it after joining, and anyone can open it from the server menu.</T>
            </span>
          </span>
          <ToggleSwitch
            checked={guide.enabled}
            onCheckedChange={(checked) => setGuide({ ...guide, enabled: checked })}
            aria-label={gt("Show the Server Guide")}
          />
        </label>
        {guide.enabled && !guideHasContent && (
          <p className="text-xs text-[var(--text-muted)] -mt-2">
            <T>Add a welcome message, a to-do or a resource so there is something to show.</T>
          </p>
        )}

        <div>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="guide-welcome" className={labelCls}><T>Welcome message</T></label>
            <span className="text-xs text-[var(--text-muted)] mb-1.5">{guide.welcomeMessage.length}/{GUIDE_WELCOME_MAX}</span>
          </div>
          <textarea
            id="guide-welcome"
            value={guide.welcomeMessage}
            maxLength={GUIDE_WELCOME_MAX}
            rows={3}
            onChange={(e) => setGuide({ ...guide, welcomeMessage: e.target.value })}
            placeholder={gt("Welcome! Here is how to get started.")}
            className={`${fieldCls} h-auto py-2 resize-y`}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>New member to-dos</T></span>
            <span className="text-xs text-[var(--text-muted)]">{guide.todos.length}/{GUIDE_TODOS_MAX}</span>
          </div>
          {guide.todos.map((todo, ti) => (
            <TodoCard
              key={todo.id}
              todo={todo}
              index={ti}
              count={guide.todos.length}
              readGroups={readGroups}
              chatGroups={chatGroups}
              onChange={(next) => setGuide({ ...guide, todos: guide.todos.map((t, i) => (i === ti ? next : t)) })}
              onMove={(delta) => setGuide({ ...guide, todos: move(guide.todos, ti, delta) })}
              onRemove={() => setGuide({ ...guide, todos: guide.todos.filter((_, i) => i !== ti) })}
            />
          ))}
          {guide.todos.length < GUIDE_TODOS_MAX && (
            <button
              type="button"
              onClick={() => setGuide({
                ...guide,
                todos: [
                  ...guide.todos,
                  { id: newId("t_"), kind: "read", title: todoDefaultTitle(gt, "read"), description: "", channelId: null, emoji: null },
                ],
              })}
              className={addBtn}
            >
              <Plus className="w-4 h-4" />
              <T>Add a to-do</T>
            </button>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Resources</T></span>
            <span className="text-xs text-[var(--text-muted)]">{guide.resources.length}/{GUIDE_RESOURCES_MAX}</span>
          </div>
          {guide.resources.map((resource, ri) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              index={ri}
              count={guide.resources.length}
              groups={readGroups}
              onChange={(next) => setGuide({ ...guide, resources: guide.resources.map((r, i) => (i === ri ? next : r)) })}
              onMove={(delta) => setGuide({ ...guide, resources: move(guide.resources, ri, delta) })}
              onRemove={() => setGuide({ ...guide, resources: guide.resources.filter((_, i) => i !== ri) })}
            />
          ))}
          {guide.resources.length < GUIDE_RESOURCES_MAX && (
            <button
              type="button"
              onClick={() => setGuide({
                ...guide,
                resources: [...guide.resources, { id: newId("r_"), title: "", description: "", channelId: null, emoji: null }],
              })}
              className={addBtn}
            >
              <Plus className="w-4 h-4" />
              <T>Add a resource</T>
            </button>
          )}
        </div>
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 pt-2 pb-[env(safe-area-inset-bottom)] bg-[var(--bg-app)]">
        {firstIncomplete !== null && (
          <p role="alert" className="mr-auto flex items-center gap-1.5 text-sm text-red-500">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {gt("Question {number} needs a title and at least one option before you can save.", { number: firstIncomplete })}
          </p>
        )}
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
          disabled={!dirty || saving || firstIncomplete !== null}
          onClick={() => void save()}
          className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          {saving ? gt("Saving...") : gt("Save Changes")}
        </button>
      </div>

      <MountWhenOpened open={preview.open}>
        <JoinPreviewDialog
          serverId={serverId}
          open={preview.open}
          onOpenChange={(open) => setPreview((p) => ({ ...p, open }))}
          startAt={preview.startAt}
          overrides={{
            onboarding: { questions: validQuestions },
            guide: { ...savableGuide(guide), enabled: true },
          }}
        />
      </MountWhenOpened>
    </div>
  );
}

