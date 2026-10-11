"use client";

import { useState } from "react";
import { T, useGT } from "gt-next";
import { FolderOpen, Hash, LayoutTemplate, Shield, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { parseTemplateCode } from "@/lib/servers/community";
import type { ServerTemplateInfo } from "./ServerTemplatePanel";

type Preview = ServerTemplateInfo & { sourceServer?: { name: string } | null };

const fieldCls = "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";

/**
 * "Start from a template" (Discord): paste a template link or code, preview
 * what it creates, name the server and create it. Used by CreateServerDialog
 * and the /template/[code] page.
 */
export default function CreateFromTemplate({
  initialCode = "",
  onBack,
  onCreated,
}: {
  initialCode?: string;
  onBack?: () => void;
  /** Called with the new server id; defaults to a full navigation into it. */
  onCreated?: (serverId: string) => void | Promise<void>;
}) {
  const gt = useGT();
  const [input, setInput] = useState(initialCode);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [autoLoaded, setAutoLoaded] = useState(false);

  const lookup = async (raw: string) => {
    const code = parseTemplateCode(raw);
    if (!code) {
      setError(gt("That doesn't look like a template link or code."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/server-templates/${code}`, { credentials: "include" });
      const data = await res.json().catch(() => null);
      if (res.status === 401) {
        setError(gt("Log in to use this template."));
        return;
      }
      if (!res.ok || !data?.template) {
        setError(gt("That template doesn't exist or was deleted."));
        return;
      }
      const t = data.template as Preview;
      setPreview(t);
      setName(decodeHtmlEntities(t.name));
    } catch {
      setError(gt("Could not load the template."));
    } finally {
      setBusy(false);
    }
  };

  // A template link opens straight on its preview (render-time, not an effect).
  if (initialCode && !autoLoaded) {
    setAutoLoaded(true);
    void lookup(initialCode);
  }

  const create = async () => {
    if (!preview || name.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/server-templates/${preview.code}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.server?.id) {
        setError(data?.error || gt("Failed to create server"));
        return;
      }
      toast.success(gt("Server created!"));
      if (onCreated) await onCreated(String(data.server.id));
      else window.location.assign(`/channels/${data.server.id}`);
    } catch {
      setError(gt("Failed to create server"));
    } finally {
      setBusy(false);
    }
  };

  const s = preview?.summary;
  return (
    <div className="p-4 space-y-4">
      {error && (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-red-500 text-sm">{error}</div>
      )}

      {!preview ? (
        <div>
          <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2">
            <T>Template link or code</T>
          </label>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void lookup(input)}
            placeholder="https://serika.chat/template/abc123XYZ789"
            className={fieldCls}
            autoFocus
          />
        </div>
      ) : (
        <>
          <div className="p-3 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
            <div className="flex items-center gap-2">
              <LayoutTemplate className="w-5 h-5 text-[var(--app-accent)] shrink-0" />
              <span className="font-semibold text-[var(--text-primary)] truncate">{decodeHtmlEntities(preview.name)}</span>
            </div>
            {preview.description && (
              <p className="text-sm text-[var(--text-secondary)]">{decodeHtmlEntities(preview.description)}</p>
            )}
            {s && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1"><FolderOpen className="w-3.5 h-3.5" />{s.categories}</span>
                <span className="inline-flex items-center gap-1"><Hash className="w-3.5 h-3.5" />{s.textChannels}</span>
                <span className="inline-flex items-center gap-1"><Volume2 className="w-3.5 h-3.5" />{s.voiceChannels}</span>
                <span className="inline-flex items-center gap-1"><Shield className="w-3.5 h-3.5" />{s.roles}</span>
              </div>
            )}
            <p className="text-xs text-[var(--text-muted)]">{gt("Used {count} times", { count: preview.usageCount })}</p>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2"><T>Server name</T></label>
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={fieldCls} autoFocus />
          </div>
        </>
      )}

      <div className="flex justify-between gap-2 pt-2">
        {onBack || preview ? (
          <button
            type="button"
            onClick={() => (preview ? setPreview(null) : onBack?.())}
            className="h-10 px-4 rounded-md text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          >
            <T>Back</T>
          </button>
        ) : <span />}
        {preview ? (
          <button
            type="button"
            disabled={busy || name.trim().length < 2}
            onClick={() => void create()}
            className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {busy ? gt("Creating...") : gt("Create")}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={() => void lookup(input)}
            className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {busy ? gt("Loading...") : gt("Continue")}
          </button>
        )}
      </div>
    </div>
  );
}
