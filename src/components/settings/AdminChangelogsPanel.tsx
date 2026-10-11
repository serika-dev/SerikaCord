"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useGT } from "gt-next";
import { Eye, FileText, Globe, Loader2, Plus, Save, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MountWhenOpened } from "@/components/ui/MountWhenOpened";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { CHANGELOG_LIMITS, type AdminChangelogAnnouncement } from "@/lib/changelogAnnouncements";
import { cn } from "@/lib/utils";

const ChangelogDialog = dynamic(() => import("@/components/changelog/ChangelogDialog").then((module) => module.ChangelogDialog), { ssr: false });

interface EditorFields {
  title: string;
  version: string;
  body: string;
}

const EMPTY_EDITOR: EditorFields = { title: "", version: "", body: "" };
const inputClass = "w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2.5 text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted)] focus:border-[var(--app-accent)] focus:outline-none disabled:opacity-70";

export function AdminChangelogsPanel({ canManage, canPublish }: { canManage: boolean; canPublish: boolean }) {
  const gt = useGT();
  const confirm = useConfirm();
  const fieldId = useId();
  const [entries, setEntries] = useState<AdminChangelogAnnouncement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fields, setFields] = useState<EditorFields>(EMPTY_EDITOR);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const alive = useRef(false);
  const selected = entries.find((entry) => entry.id === selectedId);
  const published = Boolean(selected?.publishedAt);
  const editable = canManage && !published;
  const dirty = fields.title !== (selected?.title ?? "") || fields.version !== (selected?.version ?? "") || fields.body !== (selected?.body ?? "");
  const valid = Boolean(fields.title.trim() && fields.body.trim());

  const choose = (entry?: AdminChangelogAnnouncement) => {
    setSelectedId(entry?.id ?? null);
    setFields(entry ? { title: entry.title, version: entry.version ?? "", body: entry.body } : EMPTY_EDITOR);
  };

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/changelogs", { credentials: "include" });
      if (!response.ok) throw new Error("Load failed");
      const data: { entries: AdminChangelogAnnouncement[] } = await response.json();
      if (!alive.current) return;
      setEntries(data.entries);
      const first = data.entries[0];
      setSelectedId(first?.id ?? null);
      setFields(first ? { title: first.title, version: first.version ?? "", body: first.body } : EMPTY_EDITOR);
      setLoadError(null);
    } catch {
      if (alive.current) setLoadError(gt("We couldn't load changelogs. Check your connection and permissions, then try again."));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [gt]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  const switchEntry = async (entry?: AdminChangelogAnnouncement) => {
    if (busy || entry?.id === selectedId) return;
    if (dirty && !(await confirm({
      title: gt("Discard unsaved changes?"),
      description: gt("Your changes to this changelog have not been saved."),
      confirmLabel: gt("Discard changes"),
    }))) return;
    choose(entry);
  };

  const applyEntry = (entry: AdminChangelogAnnouncement) => {
    setEntries((previous) => [entry, ...previous.filter((item) => item.id !== entry.id)]);
    choose(entry);
  };

  const save = async () => {
    if (!editable || !valid || busy) return;
    setBusy(true);
    try {
      const response = await fetch(selectedId ? `/api/admin/changelogs/${selectedId}` : "/api/admin/changelogs", {
        method: selectedId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: fields.title.trim(), version: fields.version.trim() || null, body: fields.body.trim() }),
      });
      if (!response.ok) {
        if (response.status === 409) toast.error(gt("This changelog is already published. Reload it and unpublish it before editing."));
        else toast.error(gt("Couldn't save your draft. Your changes are still in the editor."));
        return;
      }
      const data: { entry: AdminChangelogAnnouncement } = await response.json();
      if (!alive.current) return;
      applyEntry(data.entry);
      toast.success(gt("Draft saved. It is not visible to users yet."));
    } catch {
      if (alive.current) toast.error(gt("Couldn't save your draft. Your changes are still in the editor."));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const setPublication = async () => {
    if (!selected || !canPublish || busy || dirty) return;
    if (!(await confirm({
      title: published ? gt("Unpublish this update?") : gt("Publish this update?"),
      description: published
        ? gt("This update will disappear from the changelog. You can edit it as a draft and publish it again.")
        : gt("This update will become visible to everyone. People will see a What's new popup when they next open or return to the app."),
      confirmLabel: published ? gt("Unpublish") : gt("Publish to everyone"),
      destructive: false,
    }))) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/changelogs/${selected.id}/${published ? "unpublish" : "publish"}`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Publication failed");
      const data: { entry: AdminChangelogAnnouncement } = await response.json();
      if (!alive.current) return;
      applyEntry(data.entry);
      toast.success(published ? gt("Update unpublished. It is now a draft.") : gt("Update published."));
    } catch {
      if (alive.current) toast.error(gt("Couldn't change publication status. Please try again."));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const previewEntry: AdminChangelogAnnouncement = {
    ...selected,
    id: selected?.id ?? "preview",
    title: fields.title.trim() || gt("Your update title"),
    version: fields.version.trim() || null,
    body: fields.body.trim() || gt("Write an update to see it here."),
    createdAt: selected?.createdAt ?? "",
    updatedAt: selected?.updatedAt ?? "",
    publishedAt: selected?.publishedAt ?? null,
  };

  return (
    <div className="space-y-5 text-[var(--app-text)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">{gt("Changelog")}</h2>
          <p className="mt-1 max-w-xl text-sm text-[var(--app-muted)]">{gt("Keep everyone in the loop. Write a draft, preview the popup, and publish when it's ready.")}</p>
        </div>
        {canManage && <Button variant="outline" disabled={busy || loading || Boolean(loadError)} onClick={() => { void switchEntry(); }}><Plus aria-hidden />{gt("New draft")}</Button>}
      </div>

      {loading ? <div className="flex items-center gap-2 py-8 text-sm text-[var(--app-muted)]" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{gt("Loading changelogs…")}</div> : loadError ? (
        <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-5" role="alert">
          <p className="text-sm text-[var(--app-muted)]">{loadError}</p>
          <Button variant="outline" className="mt-4" onClick={() => { setLoading(true); void load(); }}>{gt("Try again")}</Button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
          <nav aria-label={gt("Changelog entries")} className="flex max-h-64 gap-2 overflow-auto rounded-xl border border-[var(--app-border)] bg-[var(--app-bg)] p-2 xl:max-h-[640px] xl:flex-col">
            {entries.length === 0 ? <p className="p-3 text-sm text-[var(--app-muted)]">{gt("Your first update starts here.")}</p> : entries.map((entry) => (
              <button key={entry.id} type="button" disabled={busy} aria-current={selectedId === entry.id ? "true" : undefined} onClick={() => { void switchEntry(entry); }} className={cn("w-44 shrink-0 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 xl:w-full", selectedId === entry.id ? "border-[var(--app-accent)] bg-[var(--app-surface)]" : "border-transparent hover:bg-[var(--app-surface)]")}>
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--app-muted)]">
                  {entry.publishedAt ? <Globe className="h-3 w-3 text-[var(--app-accent)]" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
                  {entry.publishedAt ? gt("Published") : gt("Draft")}
                </span>
                <span className="mt-2 block truncate text-sm font-semibold">{entry.title}</span>
                {entry.version && <span className="mt-1 block truncate text-xs text-[var(--app-muted)]">{entry.version}</span>}
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-4 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] pb-4">
              <span className="flex items-center gap-2 text-sm font-semibold">
                {published ? <Globe className="h-4 w-4 text-[var(--app-accent)]" aria-hidden /> : <FileText className="h-4 w-4 text-[var(--app-muted)]" aria-hidden />}
                {published ? gt("Published update") : selected ? gt("Draft update") : gt("New update")}
              </span>
              {dirty && <span className="text-xs text-[var(--app-muted)]">{gt("Unsaved changes")}</span>}
            </div>

            {published && <p className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 text-xs leading-relaxed text-[var(--app-muted)]">{gt("This update is live. Unpublish it before making changes. People who have already read it will not get another popup if you publish it again.")}</p>}
            {!canManage && <p className="text-xs text-[var(--app-muted)]">{gt("Your role can review updates but cannot edit their content.")}</p>}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_130px]">
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-title`} className="text-xs font-semibold">{gt("Title")}</label>
                <input id={`${fieldId}-title`} className={inputClass} value={fields.title} onChange={(event) => setFields({ ...fields, title: event.target.value })} disabled={!editable || busy} maxLength={CHANGELOG_LIMITS.title} placeholder={gt("A little update, a lot to love")} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${fieldId}-version`} className="text-xs font-semibold">{gt("Version (optional)")}</label>
                <input id={`${fieldId}-version`} className={inputClass} value={fields.version} onChange={(event) => setFields({ ...fields, version: event.target.value })} disabled={!editable || busy} maxLength={CHANGELOG_LIMITS.version} placeholder={gt("Release label")} />
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${fieldId}-body`} className="text-xs font-semibold">{gt("What's changed?")}</label>
              <textarea id={`${fieldId}-body`} className={cn(inputClass, "min-h-72 resize-y font-mono leading-relaxed")} value={fields.body} onChange={(event) => setFields({ ...fields, body: event.target.value })} disabled={!editable || busy} maxLength={CHANGELOG_LIMITS.body} aria-describedby={`${fieldId}-help`} placeholder={gt("## New features\n- Tell everyone what's new.\n\n## Improvements\n- Share the little things that make a difference.")} />
              <div id={`${fieldId}-help`} className="flex flex-wrap justify-between gap-2 text-xs text-[var(--app-muted)]">
                <span>{gt("Supports Markdown: headings, lists, links, bold, and code.")}</span>
                <span>{gt("{count} / {limit} characters", { count: fields.body.length, limit: CHANGELOG_LIMITS.body })}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--app-border)] pt-4">
              <Button variant="outline" disabled={busy} onClick={() => setPreview(true)}><Eye aria-hidden />{gt("Preview popup")}</Button>
              {editable && <Button variant="outline" disabled={busy || !valid || (Boolean(selected) && !dirty)} onClick={() => { void save(); }}>{busy ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}{gt("Save draft")}</Button>}
              {canPublish && <Button className="bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:bg-[var(--app-accent)] hover:opacity-90 sm:ml-auto" disabled={busy || !selected || dirty} onClick={() => { void setPublication(); }}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : published ? <Undo2 aria-hidden /> : <Send aria-hidden />}
                {published ? gt("Unpublish") : gt("Publish")}
              </Button>}
            </div>
            {!published && <p className="text-xs text-[var(--app-muted)]">{canPublish ? gt("Save your draft before publishing. Publishing makes the update visible to everyone.") : gt("Save your draft for a staff member with publishing permission to release.")}</p>}
          </div>
        </div>
      )}

      <MountWhenOpened open={preview}>
        <ChangelogDialog open={preview} onOpenChange={setPreview} entries={[previewEntry]} selectedId={previewEntry.id} preview />
      </MountWhenOpened>
    </div>
  );
}
