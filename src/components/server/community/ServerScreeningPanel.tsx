"use client";

import { useEffect, useState } from "react";
import { T, useGT } from "gt-next";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Loader } from "@/components/ui/Loader";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { invalidateServerOnboarding } from "@/hooks/useServerOnboarding";
import { SCREENING_DESCRIPTION_MAX, SCREENING_RULE_MAX, SCREENING_RULES_MAX } from "@/lib/servers/community";

interface Draft {
  enabled: boolean;
  description: string;
  rules: string[];
}

const EMPTY: Draft = { enabled: false, description: "", rules: [] };

type Loaded = { serverId: string; draft: Draft; saved: string } | null;

function fromApi(raw: unknown): Draft {
  const s = (raw && typeof raw === "object" ? raw : {}) as { enabled?: boolean; description?: string; rules?: string[] };
  return {
    enabled: Boolean(s.enabled),
    description: decodeHtmlEntities(s.description ?? ""),
    rules: (s.rules ?? []).map((r) => decodeHtmlEntities(r)),
  };
}

const fieldCls = "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";

/** Server Settings → Rules Screening (Discord): new members accept the rules before they can talk. */
export default function ServerScreeningPanel({ serverId }: { serverId: string }) {
  const gt = useGT();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [saving, setSaving] = useState(false);

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
    return <div className="flex items-center justify-center py-12"><Loader size={32} /></div>;
  }
  const draft = loaded.draft;
  const dirty = JSON.stringify(draft) !== loaded.saved;
  const setDraft = (next: Draft) => setLoaded({ ...loaded, draft: next });
  const setRule = (index: number, value: string) =>
    setDraft({ ...draft, rules: draft.rules.map((r, i) => (i === index ? value : r)) });
  const move = (index: number, delta: number) => {
    const list = [...draft.rules];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setDraft({ ...draft, rules: list });
  };
  const hasRule = draft.rules.some((r) => r.trim().length > 0);

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
          rules: draft.rules.map((r) => r.trim()).filter(Boolean),
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1"><T>Rules Screening</T></h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <T>New members must read and accept your server rules before they can send messages, react or join voice.</T>
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
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
              <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={gt("Move up")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                <ArrowUp className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => move(index, 1)} disabled={index === draft.rules.length - 1} aria-label={gt("Move down")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
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
            className="w-full h-10 rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)] flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <T>Add a rule</T>
          </button>
        )}
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2 pt-2 pb-[env(safe-area-inset-bottom)] bg-[var(--bg-app)]">
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
    </div>
  );
}
