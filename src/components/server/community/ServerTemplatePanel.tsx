"use client";

import { useEffect, useState } from "react";
import { T, useGT } from "gt-next";
import { Copy, LayoutTemplate, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { TEMPLATE_DESCRIPTION_MAX, TEMPLATE_NAME_MAX } from "@/lib/servers/community";

export interface ServerTemplateInfo {
  code: string;
  name: string;
  description: string | null;
  usageCount: number;
  isDirty: boolean | null;
  updatedAt: string;
  creator: { username: string; displayName?: string | null } | null;
  summary: { categories: number; textChannels: number; voiceChannels: number; roles: number } | null;
}

type Loaded = { serverId: string; template: ServerTemplateInfo | null } | null;

const fieldCls = "w-full px-3 py-2 rounded-md bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--app-accent)]";

export function templateLink(code: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://serika.chat";
  return `${origin}/template/${code}`;
}

/** Server Settings → Server Template (Discord): a shareable snapshot of channels, roles and settings. */
export default function ServerTemplatePanel({ serverId, serverName }: { serverId: string; serverName: string }) {
  const gt = useGT();
  const confirm = useConfirm();
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch(`/api/servers/${serverId}/template`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active) return;
        const template = (data?.template ?? null) as ServerTemplateInfo | null;
        setLoaded({ serverId, template });
        setName(template ? decodeHtmlEntities(template.name) : "");
        setDescription(template ? decodeHtmlEntities(template.description ?? "") : "");
      })
      .catch(() => active && setLoaded({ serverId, template: null }));
    return () => {
      active = false;
    };
  }, [serverId]);

  if (!loaded || loaded.serverId !== serverId) {
    return <div className="flex items-center justify-center py-12"><Loader size={32} /></div>;
  }
  const template = loaded.template;

  const call = async (method: string, path: string, body?: unknown): Promise<ServerTemplateInfo | null | false> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/template${path}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Something went wrong"));
        return false;
      }
      const next = (data?.template ?? null) as ServerTemplateInfo | null;
      setLoaded({ serverId, template: next });
      if (next) {
        setName(decodeHtmlEntities(next.name));
        setDescription(decodeHtmlEntities(next.description ?? ""));
      }
      return next;
    } catch {
      toast.error(gt("Something went wrong"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!template) return;
    try {
      await navigator.clipboard.writeText(templateLink(template.code));
      toast.success(gt("Template link copied"));
    } catch {
      toast.error(gt("Could not copy the link"));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: gt("Delete template"),
      description: gt("The template link will stop working. Servers already made from it are not affected."),
      confirmLabel: gt("Delete"),
    });
    if (!ok) return;
    if ((await call("DELETE", "")) !== false) {
      setLoaded({ serverId, template: null });
      setName("");
      setDescription("");
      toast.success(gt("Template deleted"));
    }
  };

  const metaDirty = template
    ? name.trim() !== decodeHtmlEntities(template.name) || description.trim() !== decodeHtmlEntities(template.description ?? "")
    : false;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-[var(--text-primary)] mb-1"><T>Server Template</T></h2>
        <p className="text-sm text-[var(--text-secondary)]">
          <T>A template copies this server&apos;s channels, categories, roles, permissions and settings so anyone can start a server just like it. Messages and members are never copied.</T>
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2"><T>Template title</T></label>
          <input
            value={name}
            maxLength={TEMPLATE_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            placeholder={serverName}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="block text-xs font-bold uppercase text-[var(--text-secondary)] mb-2"><T>Template description</T></label>
          <textarea
            value={description}
            maxLength={TEMPLATE_DESCRIPTION_MAX}
            rows={2}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={gt("What is this template for?")}
            className={`${fieldCls} resize-none`}
          />
        </div>
      </div>

      {!template ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void call("POST", "", { name: name.trim() || serverName, description: description.trim() || undefined }).then((t) => t && toast.success(gt("Template created")))}
          className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-2"
        >
          <LayoutTemplate className="w-4 h-4" />
          <T>Generate Template</T>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="p-4 rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
            <label className="block text-xs font-bold uppercase text-[var(--text-secondary)]"><T>Template link</T></label>
            <div className="flex gap-2">
              <input readOnly value={templateLink(template.code)} onFocus={(e) => e.currentTarget.select()} className={`${fieldCls} flex-1 min-w-0 font-mono`} />
              <button
                type="button"
                onClick={() => void copyLink()}
                className="h-10 px-3 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 inline-flex items-center gap-2 shrink-0"
              >
                <Copy className="w-4 h-4" />
                <span className="hidden sm:inline"><T>Copy</T></span>
              </button>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              {gt("Used {count} times", { count: template.usageCount })}
              {template.summary
                ? ` · ${gt("{categories} categories, {text} text, {voice} voice channels, {roles} roles", {
                    categories: template.summary.categories,
                    text: template.summary.textChannels,
                    voice: template.summary.voiceChannels,
                    roles: template.summary.roles,
                  })}`
                : ""}
            </p>
            {template.isDirty && (
              <p className="text-sm text-[var(--text-secondary)]">
                <T>This server has changed since the template was last synced.</T>
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !template.isDirty}
              onClick={() => void call("PUT", "/sync").then((t) => t && toast.success(gt("Template synced")))}
              className="h-10 px-4 rounded-md bg-[var(--bg-card)] border border-[var(--border-subtle)] text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-40 inline-flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              <T>Sync Template</T>
            </button>
            <button
              type="button"
              disabled={busy || !metaDirty || !name.trim()}
              onClick={() => void call("PATCH", "", { name: name.trim(), description: description.trim() }).then((t) => t && toast.success(gt("Template saved")))}
              className="h-10 px-4 rounded-md bg-[var(--app-accent)] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40"
            >
              <T>Save Changes</T>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="h-10 px-4 rounded-md text-sm text-red-500 hover:bg-red-500/10 disabled:opacity-40 inline-flex items-center gap-2 sm:ml-auto"
            >
              <Trash2 className="w-4 h-4" />
              <T>Delete Template</T>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
