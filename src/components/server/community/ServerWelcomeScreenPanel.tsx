"use client";

import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { T, useGT } from "gt-next";
import { ArrowDown, ArrowUp, Hash, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Loader } from "@/components/ui/Loader";
import { useServer } from "@/contexts/ServerContext";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { invalidateServerOnboarding } from "@/hooks/useServerOnboarding";
import {
  WELCOME_CHANNELS_MAX,
  WELCOME_CHANNEL_DESCRIPTION_MAX,
  WELCOME_CHANNEL_TYPES,
  WELCOME_DESCRIPTION_MAX,
} from "@/lib/servers/community";

interface DraftChannel {
  channelId: string;
  description: string;
  emojiName: string;
}

interface Draft {
  enabled: boolean;
  description: string;
  welcomeChannels: DraftChannel[];
}

const EMPTY: Draft = { enabled: false, description: "", welcomeChannels: [] };

type Loaded = { serverId: string; draft: Draft; saved: string } | null;

function fromApi(raw: unknown): Draft {
  const w = (raw && typeof raw === "object" ? raw : {}) as {
    enabled?: boolean;
    description?: string;
    welcomeChannels?: Array<{ channelId: string; description?: string; emojiName?: string | null }>;
  };
  return {
    enabled: Boolean(w.enabled),
    description: decodeHtmlEntities(w.description ?? ""),
    welcomeChannels: (w.welcomeChannels ?? []).map((c) => ({
      channelId: c.channelId,
      description: decodeHtmlEntities(c.description ?? ""),
      emojiName: c.emojiName ?? "",
    })),
  };
}

const fieldCls = "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";

/** Server Settings → Welcome Screen (Discord): description + up to 5 recommended channels. */
export default function ServerWelcomeScreenPanel({ serverId }: { serverId: string }) {
  const gt = useGT();
  const { channels } = useServer();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/welcome-screen`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const draft = data ? fromApi(data.welcomeScreen) : EMPTY;
        setLoaded({ serverId, draft, saved: JSON.stringify(draft) });
      })
      .catch(() => active && setLoaded({ serverId, draft: EMPTY, saved: JSON.stringify(EMPTY) }));
    return () => {
      active = false;
    };
  }, [serverId]);

  const eligible = useMemo(
    () => channels.filter((c) => WELCOME_CHANNEL_TYPES.has(String(c.type))),
    [channels],
  );

  if (!loaded || loaded.serverId !== serverId) {
    return <div className="flex items-center justify-center py-12"><Loader size={32} /></div>;
  }
  const draft = loaded.draft;
  const dirty = JSON.stringify(draft) !== loaded.saved;
  const setDraft = (next: Draft) => setLoaded({ ...loaded, draft: next });
  const updateChannel = (index: number, patch: Partial<DraftChannel>) =>
    setDraft({ ...draft, welcomeChannels: draft.welcomeChannels.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  const move = (index: number, delta: number) => {
    const list = [...draft.welcomeChannels];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setDraft({ ...draft, welcomeChannels: list });
  };
  const used = new Set(draft.welcomeChannels.map((c) => c.channelId));
  const firstFree = eligible.find((c) => !used.has(c.id));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/welcome-screen`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: draft.enabled,
          description: draft.description,
          welcomeChannels: draft.welcomeChannels.map((c) => ({
            channelId: c.channelId,
            description: c.description,
            emojiName: c.emojiName.trim() || null,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "save failed");
      const next = fromApi(data?.welcomeScreen);
      setLoaded({ serverId, draft: next, saved: JSON.stringify(next) });
      invalidateServerOnboarding(serverId);
      toast.success(gt("Welcome screen saved"));
    } catch {
      toast.error(gt("Could not save the welcome screen"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1"><T>Welcome Screen</T></h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <T>Greet new members with a description of your server and point them to the channels they should check out first.</T>
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] cursor-pointer">
        <span>
          <span className="block text-sm font-medium text-[var(--text-primary)]"><T>Show the welcome screen</T></span>
          <span className="block text-xs text-[var(--text-muted)] mt-1"><T>New members see it when they first open the server.</T></span>
        </span>
        <ToggleSwitch
          checked={draft.enabled}
          onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
          aria-label={gt("Show the welcome screen")}
        />
      </label>

      <div>
        <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">
          <T>Server description</T>
        </label>
        <textarea
          value={draft.description}
          maxLength={WELCOME_DESCRIPTION_MAX}
          rows={3}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder={gt("What is this server about?")}
          className={`${fieldCls} resize-none`}
        />
        <p className="text-xs text-[var(--text-muted)] text-right mt-1">{draft.description.length}/{WELCOME_DESCRIPTION_MAX}</p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs font-bold uppercase text-[var(--text-secondary)]">
            <T>Recommended channels</T>
          </label>
          <span className="text-xs text-[var(--text-muted)]">{draft.welcomeChannels.length}/{WELCOME_CHANNELS_MAX}</span>
        </div>
        {draft.welcomeChannels.length === 0 && (
          <p className="text-sm text-[var(--text-muted)]"><T>Add up to five channels new members should visit first.</T></p>
        )}
        {draft.welcomeChannels.map((wc, index) => (
          <div key={`${wc.channelId}-${index}`} className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center gap-2">
              <input
                value={wc.emojiName}
                onChange={(e) => updateChannel(index, { emojiName: e.target.value.slice(0, 16) })}
                placeholder="😀"
                aria-label={gt("Emoji")}
                className={cn(fieldCls, "w-14 text-center shrink-0")}
              />
              <div className="relative flex-1 min-w-0">
                <Hash className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <select
                  value={wc.channelId}
                  onChange={(e) => updateChannel(index, { channelId: e.target.value })}
                  aria-label={gt("Channel")}
                  className={cn(fieldCls, "pl-8 h-10")}
                >
                  {eligible
                    .filter((c) => c.id === wc.channelId || !used.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
              </div>
              <div className="flex shrink-0">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={gt("Move up")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === draft.welcomeChannels.length - 1} aria-label={gt("Move down")} className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30">
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDraft({ ...draft, welcomeChannels: draft.welcomeChannels.filter((_, i) => i !== index) })}
                  aria-label={gt("Remove")}
                  className="p-2 rounded text-[var(--text-muted)] hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <input
              value={wc.description}
              maxLength={WELCOME_CHANNEL_DESCRIPTION_MAX}
              onChange={(e) => updateChannel(index, { description: e.target.value })}
              placeholder={gt("Describe what to do here")}
              className={fieldCls}
            />
          </div>
        ))}
        {draft.welcomeChannels.length < WELCOME_CHANNELS_MAX && firstFree && (
          <button
            type="button"
            onClick={() => setDraft({ ...draft, welcomeChannels: [...draft.welcomeChannels, { channelId: firstFree.id, description: "", emojiName: "" }] })}
            className="w-full h-10 rounded-lg border border-dashed border-[var(--border-subtle)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)] flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <T>Add a channel</T>
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
