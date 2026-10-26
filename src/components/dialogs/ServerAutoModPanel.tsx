"use client";

// Server settings > AutoMod (Discord-style). Lazy-loaded by
// ServerSettingsDialog. Four filters: custom keywords (up to 6 rules),
// mention spam, suspected spam and links; each rule picks its actions
// (block + custom response, alert channel, timeout) and exempt roles /
// channels. Rules are validated again server side (src/lib/automod/rules.ts).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { AtSign, Link2, MessageSquareWarning, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useServer } from "@/contexts/ServerContext";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import {
  AUTOMOD_LIMITS,
  AUTOMOD_TIMEOUT_CHOICES,
  type AutoModAction,
  type AutoModRule,
  type AutoModTriggerType,
} from "@/lib/automod/rules";

interface PanelRole {
  id: string;
  name: string;
}

/** Editable form state for one rule (lists as newline / comma text). */
interface Draft {
  id: string | null;
  triggerType: AutoModTriggerType;
  name: string;
  enabled: boolean;
  keywords: string;
  allowList: string;
  mentionLimit: number;
  invitesOnly: boolean;
  allowedDomains: string;
  block: boolean;
  customMessage: string;
  alert: boolean;
  alertChannelId: string;
  timeout: boolean;
  timeoutSeconds: number;
  exemptRoles: string[];
  exemptChannels: string[];
}

const ALERT_CHANNEL_TYPES = new Set(["text", "announcement"]);
const inputCls =
  "w-full px-3 py-2 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";
const labelCls = "block text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1";

function splitList(text: string): string[] {
  return text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

function toDraft(rule: AutoModRule): Draft {
  const find = <T extends AutoModAction["type"]>(t: T) =>
    rule.actions.find((a) => a.type === t) as Extract<AutoModAction, { type: T }> | undefined;
  const block = find("block_message");
  const alert = find("send_alert");
  const timeout = find("timeout");
  const m = rule.triggerMetadata || {};
  return {
    id: rule.id,
    triggerType: rule.triggerType,
    name: rule.name,
    enabled: rule.enabled,
    keywords: (m.keywordFilter || []).join(", "),
    allowList: (m.allowList || []).join(", "),
    mentionLimit: m.mentionTotalLimit ?? 5,
    invitesOnly: Boolean(m.invitesOnly),
    allowedDomains: (m.allowedDomains || []).join(", "),
    block: Boolean(block),
    customMessage: block?.customMessage || "",
    alert: Boolean(alert),
    alertChannelId: alert?.channelId || "",
    timeout: Boolean(timeout),
    timeoutSeconds: timeout?.durationSeconds ?? 60,
    exemptRoles: rule.exemptRoles,
    exemptChannels: rule.exemptChannels,
  };
}

function newDraft(triggerType: AutoModTriggerType, name: string): Draft {
  return {
    id: null,
    triggerType,
    name,
    enabled: true,
    keywords: "",
    allowList: "",
    mentionLimit: 5,
    invitesOnly: false,
    allowedDomains: "",
    block: true,
    customMessage: "",
    alert: false,
    alertChannelId: "",
    timeout: false,
    timeoutSeconds: 60,
    exemptRoles: [],
    exemptChannels: [],
  };
}

function toPayload(d: Draft) {
  const actions: AutoModAction[] = [];
  if (d.block) actions.push({ type: "block_message", customMessage: d.customMessage.trim() || null });
  if (d.alert) actions.push({ type: "send_alert", channelId: d.alertChannelId });
  if (d.timeout && d.triggerType !== "spam") actions.push({ type: "timeout", durationSeconds: d.timeoutSeconds });
  const triggerMetadata =
    d.triggerType === "keyword"
      ? { keywordFilter: splitList(d.keywords), allowList: splitList(d.allowList) }
      : d.triggerType === "mention_spam"
        ? { mentionTotalLimit: d.mentionLimit }
        : d.triggerType === "links"
          ? { invitesOnly: d.invitesOnly, allowedDomains: splitList(d.allowedDomains) }
          : {};
  return {
    name: d.name,
    enabled: d.enabled,
    triggerType: d.triggerType,
    triggerMetadata,
    actions,
    exemptRoles: d.exemptRoles,
    exemptChannels: d.exemptChannels,
  };
}

// Last rules per server: reopening the tab shows them at once while it refreshes.
const rulesCache = new Map<string, AutoModRule[]>();

export function ServerAutoModPanel({ serverId, roles }: { serverId: string; roles: PanelRole[] }) {
  const gt = useGT();
  const confirm = useConfirm();
  const { channels } = useServer();
  const [rules, setRulesState] = useState<AutoModRule[]>(() => rulesCache.get(serverId) ?? []);
  const [loading, setLoading] = useState(() => !rulesCache.has(serverId));
  const setRules = useCallback(
    (next: AutoModRule[] | ((list: AutoModRule[]) => AutoModRule[])) =>
      setRulesState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        rulesCache.set(serverId, value);
        return value;
      }),
    [serverId],
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/servers/${serverId}/auto-moderation/rules`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error || "Failed to load AutoMod rules");
        return (data?.rules || []) as AutoModRule[];
      })
      .then((list) => {
        if (cancelled) return;
        setRules(list);
        setError(null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, setRules]);

  const serverChannels = useMemo(
    () => channels.filter((c) => c.serverId === serverId && c.type !== "category"),
    [channels, serverId],
  );
  const alertChannels = useMemo(() => serverChannels.filter((c) => ALERT_CHANNEL_TYPES.has(String(c.type))), [serverChannels]);
  const assignableRoles = useMemo(() => roles.filter((r) => r.name !== "@everyone"), [roles]);

  const sections = useMemo(
    () => [
      {
        type: "keyword" as const,
        title: gt("Block Custom Words"),
        description: gt("Block messages containing specific words or phrases. Use * as a wildcard: cat* matches catch, *cat* matches bobcats."),
        defaultName: gt("Custom Words"),
        icon: MessageSquareWarning,
      },
      {
        type: "mention_spam" as const,
        title: gt("Block Mention Spam"),
        description: gt("Block messages that mention too many different users or roles at once."),
        defaultName: gt("Mention Spam"),
        icon: AtSign,
      },
      {
        type: "spam" as const,
        title: gt("Block Suspected Spam"),
        description: gt("Block repeated messages, walls of repeated characters and other content that looks like spam."),
        defaultName: gt("Suspected Spam"),
        icon: ShieldAlert,
      },
      {
        type: "links" as const,
        title: gt("Block Links"),
        description: gt("Block links in messages, or only server invites. Allowed domains always pass."),
        defaultName: gt("Links"),
        icon: Link2,
      },
    ],
    [gt],
  );

  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d)), []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (draft.alert && !draft.alertChannelId) {
      toast.error(gt("Pick a channel for alerts"));
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/servers/${serverId}/auto-moderation/rules/${draft.id}` : `/api/servers/${serverId}/auto-moderation/rules`,
        { method: draft.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toPayload(draft)) },
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.rule) throw new Error(data?.error || gt("Could not save the rule"));
      const saved = data.rule as AutoModRule;
      setRules((list) => (list.some((r) => r.id === saved.id) ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]));
      setDraft(null);
      toast.success(gt("AutoMod rule saved"));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [draft, serverId, gt, setRules]);

  const remove = useCallback(
    async (rule: AutoModRule) => {
      const ok = await confirm({
        title: gt("Delete AutoMod rule?"),
        description: gt("Messages will no longer be checked by {name}.", { name: rule.name }),
        confirmLabel: gt("Delete"),
      });
      if (!ok) return;
      const res = await fetch(`/api/servers/${serverId}/auto-moderation/rules/${rule.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(gt("Could not delete the rule"));
        return;
      }
      setRules((list) => list.filter((r) => r.id !== rule.id));
      setDraft((d) => (d?.id === rule.id ? null : d));
    },
    [confirm, gt, serverId, setRules],
  );

  const toggleEnabled = useCallback(
    async (rule: AutoModRule, enabled: boolean) => {
      setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
      const res = await fetch(`/api/servers/${serverId}/auto-moderation/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).catch(() => null);
      if (!res?.ok) {
        setRules((list) => list.map((r) => (r.id === rule.id ? { ...r, enabled: rule.enabled } : r)));
        toast.error(gt("Could not update the rule"));
      }
    },
    [gt, serverId, setRules],
  );

  const header = (
    <SettingsPageHeader
      title={gt("AutoMod")}
      description={
        <>
          {gt("AutoMod checks messages as they are sent and acts on them for you. Server owners, admins and members with Manage Server are never affected.")}
          {error && <span className="mt-2 block text-red-500">{error}</span>}
        </>
      }
      className="mb-0"
    />
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {header}
        <SettingsSkeleton variant="list" count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {sections.map((section) => {
        const Icon = section.icon;
        const sectionRules = rules.filter((r) => r.triggerType === section.type);
        const max = AUTOMOD_LIMITS.perType[section.type];
        const canAdd = sectionRules.length < max && !(draft && !draft.id && draft.triggerType === section.type);
        return (
          <div key={section.type} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--app-accent)]">
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-[var(--text-primary)]">{section.title}</div>
                <p className="text-sm text-[var(--text-secondary)]">{section.description}</p>
              </div>
              {canAdd && (
                <SettingsButton
                  variant={sectionRules.length ? "secondary" : "primary"}
                  onClick={() => setDraft(newDraft(section.type, sectionRules.length ? `${section.defaultName} ${sectionRules.length + 1}` : section.defaultName))}
                >
                  <Plus />
                  {sectionRules.length ? gt("Create Rule") : gt("Set Up")}
                </SettingsButton>
              )}
            </div>

            {sectionRules.map((rule) =>
              draft?.id === rule.id ? null : (
                <div key={rule.id} className="flex items-center gap-3 border-t border-[var(--border-subtle)] px-4 py-3 transition-colors [@media(hover:hover)]:hover:bg-[var(--bg-hover)]/60">
                  <button type="button" onClick={() => setDraft(toDraft(rule))} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-sm font-medium text-[var(--text-primary)]">{rule.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {rule.actions.length === 1 ? gt("1 action") : gt("{count} actions", { count: rule.actions.length })}
                    </div>
                  </button>
                  <ToggleSwitch size="sm" checked={rule.enabled} onCheckedChange={(v) => void toggleEnabled(rule, v)} aria-label={gt("Enable rule")} />
                  <button
                    type="button"
                    onClick={() => void remove(rule)}
                    className="rounded p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]"
                    aria-label={gt("Delete rule")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ),
            )}

            {draft && draft.triggerType === section.type && (
              <div className="space-y-4 border-t border-[var(--border-subtle)] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex-1">
                    <span className={labelCls}>{gt("Rule name")}</span>
                    <input className={inputCls} value={draft.name} maxLength={AUTOMOD_LIMITS.nameLength} onChange={(e) => update({ name: e.target.value })} />
                  </label>
                  <div className="flex items-center gap-2 pb-2 text-sm text-[var(--text-secondary)]">
                    <ToggleSwitch size="sm" checked={draft.enabled} onCheckedChange={(v) => update({ enabled: v })} aria-label={gt("Enable rule")} />
                    {gt("Enabled")}
                  </div>
                </div>

                {draft.triggerType === "keyword" && (
                  <>
                    <label className="block">
                      <span className={labelCls}>{gt("Blocked words")}</span>
                      <textarea
                        className={`${inputCls} min-h-[84px]`}
                        value={draft.keywords}
                        placeholder={gt("Separate words with commas or new lines")}
                        onChange={(e) => update({ keywords: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <span className={labelCls}>{gt("Allowed words")}</span>
                      <textarea
                        className={`${inputCls} min-h-[60px]`}
                        value={draft.allowList}
                        placeholder={gt("Words that should never be blocked, even if they match")}
                        onChange={(e) => update({ allowList: e.target.value })}
                      />
                    </label>
                  </>
                )}

                {draft.triggerType === "mention_spam" && (
                  <label className="block">
                    <span className={labelCls}>{gt("Unique mentions per message")}</span>
                    <input
                      type="number"
                      className={`${inputCls} max-w-[140px]`}
                      min={AUTOMOD_LIMITS.mentionLimitMin}
                      max={AUTOMOD_LIMITS.mentionLimitMax}
                      value={draft.mentionLimit}
                      onChange={(e) => update({ mentionLimit: Number(e.target.value) || AUTOMOD_LIMITS.mentionLimitMin })}
                    />
                  </label>
                )}

                {draft.triggerType === "links" && (
                  <>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                      <ToggleSwitch size="sm" checked={draft.invitesOnly} onCheckedChange={(v) => update({ invitesOnly: v })} aria-label={gt("Only block server invites")} />
                      {gt("Only block server invites")}
                    </div>
                    <label className="block">
                      <span className={labelCls}>{gt("Allowed domains")}</span>
                      <textarea
                        className={`${inputCls} min-h-[60px]`}
                        value={draft.allowedDomains}
                        placeholder="youtube.com, serika.chat"
                        onChange={(e) => update({ allowedDomains: e.target.value })}
                      />
                    </label>
                  </>
                )}

                <div className="space-y-3">
                  <span className={labelCls}>{gt("Actions")}</span>
                  <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                    <input type="checkbox" className="mt-0.5 accent-[var(--app-accent)]" checked={draft.block} onChange={(e) => update({ block: e.target.checked })} />
                    <span>
                      {gt("Block message")}
                      <span className="block text-xs text-[var(--text-muted)]">{gt("The message is not sent. The sender sees the response below.")}</span>
                    </span>
                  </label>
                  {draft.block && (
                    <input
                      className={`${inputCls} ml-6 max-w-[calc(100%-1.5rem)]`}
                      value={draft.customMessage}
                      maxLength={AUTOMOD_LIMITS.customMessageLength}
                      placeholder={gt("Custom response (optional)")}
                      onChange={(e) => update({ customMessage: e.target.value })}
                    />
                  )}
                  <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                    <input type="checkbox" className="mt-0.5 accent-[var(--app-accent)]" checked={draft.alert} onChange={(e) => update({ alert: e.target.checked })} />
                    <span>
                      {gt("Send alert to a channel")}
                      <span className="block text-xs text-[var(--text-muted)]">{gt("Moderators see the flagged message and the rule that caught it.")}</span>
                    </span>
                  </label>
                  {draft.alert && (
                    <select className={`${inputCls} ml-6 max-w-[calc(100%-1.5rem)]`} value={draft.alertChannelId} onChange={(e) => update({ alertChannelId: e.target.value })}>
                      <option value="">{gt("Select a channel")}</option>
                      {alertChannels.map((c) => (
                        <option key={c.id} value={c.id}>
                          #{c.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {draft.triggerType !== "spam" && (
                    <>
                      <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                        <input type="checkbox" className="mt-0.5 accent-[var(--app-accent)]" checked={draft.timeout} onChange={(e) => update({ timeout: e.target.checked })} />
                        <span>
                          {gt("Time out member")}
                          <span className="block text-xs text-[var(--text-muted)]">{gt("The member cannot send messages or react until the timeout ends.")}</span>
                        </span>
                      </label>
                      {draft.timeout && (
                        <select
                          className={`${inputCls} ml-6 max-w-[calc(100%-1.5rem)]`}
                          value={draft.timeoutSeconds}
                          onChange={(e) => update({ timeoutSeconds: Number(e.target.value) })}
                        >
                          {AUTOMOD_TIMEOUT_CHOICES.map((s) => (
                            <option key={s} value={s}>
                              {s === 60
                                ? gt("60 seconds")
                                : s === 300
                                  ? gt("5 minutes")
                                  : s === 600
                                    ? gt("10 minutes")
                                    : s === 3600
                                      ? gt("1 hour")
                                      : s === 86_400
                                        ? gt("1 day")
                                        : gt("1 week")}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ExemptPicker
                    label={gt("Exempt roles")}
                    empty={gt("No roles")}
                    items={assignableRoles.map((r) => ({ id: r.id, label: r.name }))}
                    selected={draft.exemptRoles}
                    max={AUTOMOD_LIMITS.exemptRoles}
                    onChange={(exemptRoles) => update({ exemptRoles })}
                  />
                  <ExemptPicker
                    label={gt("Exempt channels")}
                    empty={gt("No channels")}
                    items={serverChannels.map((c) => ({ id: c.id, label: `#${c.name}` }))}
                    selected={draft.exemptChannels}
                    max={AUTOMOD_LIMITS.exemptChannels}
                    onChange={(exemptChannels) => update({ exemptChannels })}
                  />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                  <SettingsButton variant="ghost" onClick={() => setDraft(null)}>
                    {gt("Cancel")}
                  </SettingsButton>
                  <SettingsButton
                    variant="primary"
                    disabled={saving || (!draft.block && !draft.alert && !draft.timeout)}
                    onClick={() => void save()}
                  >
                    {saving ? gt("Saving...") : gt("Save Rule")}
                  </SettingsButton>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ExemptPicker({
  label,
  empty,
  items,
  selected,
  max,
  onChange,
}: {
  label: string;
  empty: string;
  items: { id: string; label: string }[];
  selected: string[];
  max: number;
  onChange: (next: string[]) => void;
}) {
  const chosen = new Set(selected);
  return (
    <div>
      <span className={labelCls}>{label}</span>
      <div className="max-h-40 overflow-y-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-card)] p-1">
        {items.length === 0 && <div className="px-2 py-1.5 text-sm text-[var(--text-muted)]">{empty}</div>}
        {items.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]">
            <input
              type="checkbox"
              className="accent-[var(--app-accent)]"
              checked={chosen.has(item.id)}
              disabled={!chosen.has(item.id) && selected.length >= max}
              onChange={(e) => onChange(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))}
            />
            <span className="truncate">{item.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
