"use client";

import { useGT } from "gt-next";
import { Loader2, Newspaper, Sparkles } from "lucide-react";
import { ChatGtProvider } from "@/components/chat/ChatGtContext";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { AdminChangelogAnnouncement } from "@/lib/changelogAnnouncements";

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: AdminChangelogAnnouncement[];
  selectedId: string | null;
  onSelect?: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  preview?: boolean;
}

export function ChangelogDialog({ open, onOpenChange, entries, selectedId, onSelect, loading, error, onRetry, preview }: ChangelogDialogProps) {
  const gt = useGT();
  const entry = entries.find((item) => item.id === selectedId) ?? entries[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden border-[var(--app-border)] bg-[var(--app-surface)] p-0 text-[var(--app-text)] sm:max-w-2xl">
        <div className="relative shrink-0 overflow-hidden border-b border-[var(--app-border)] px-6 pb-6 pt-8 sm:px-8">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full bg-[var(--app-accent)] opacity-[0.08]" />
          <div aria-hidden className="pointer-events-none absolute -right-4 top-8 rotate-12 text-[var(--app-accent)] opacity-[0.12]">
            <Newspaper className="h-32 w-32" />
          </div>
          <div className="relative">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[var(--app-accent)]">
              <Sparkles className="h-4 w-4" aria-hidden />
              {preview ? gt("Changelog preview") : gt("What's new in SerikaCord")}
            </div>
            <DialogTitle className="pr-4 text-2xl font-bold leading-tight sm:text-3xl">
              {entry?.title || gt("What's new")}
            </DialogTitle>
            <DialogDescription className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
              {entry?.version && <span className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-0.5 font-mono text-xs text-[var(--app-text)]">{entry.version}</span>}
              {entry?.publishedAt
                ? <time dateTime={entry.publishedAt}>{new Date(entry.publishedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</time>
                : preview ? gt("Only you can see this preview.") : gt("The latest improvements, fixes, and updates.")}
            </DialogDescription>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8" aria-busy={loading}>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[var(--app-muted)]" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden />{gt("Loading updates…")}</div>
          ) : error ? (
            <div className="space-y-4 py-8 text-center" role="alert">
              <p className="text-[var(--app-muted)]">{error}</p>
              {onRetry && <Button variant="outline" onClick={onRetry}>{gt("Try again")}</Button>}
            </div>
          ) : entry ? (
            <article key={entry.id} className="text-[15px] leading-7 [&_.md-heading]:mb-3 [&_.md-heading]:mt-6 [&_.md-heading]:text-[var(--app-accent)] [&_.md-list]:my-3 [&_.md-list-item]:my-1">
              <ChatGtProvider><MarkdownRenderer content={entry.body} /></ChatGtProvider>
            </article>
          ) : (
            <div className="py-10 text-center text-[var(--app-muted)]">
              <Newspaper className="mx-auto mb-3 h-9 w-9 opacity-60" aria-hidden />
              <p className="font-semibold text-[var(--app-text)]">{gt("No updates just yet")}</p>
              <p className="mt-1 text-sm">{gt("Check back here for news from the SerikaCord team.")}</p>
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--app-border)] bg-[var(--app-bg)] px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          {!preview && entries.length > 1 && onSelect ? (
            <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-[var(--app-muted)]">
              <span className="shrink-0">{gt("Past updates")}</span>
              <select value={entry?.id ?? ""} onChange={(event) => onSelect(event.target.value)} className="min-w-0 max-w-full rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-2 text-sm text-[var(--app-text)] focus:outline-[var(--app-accent)]">
                {entries.map((item) => <option key={item.id} value={item.id}>{item.version ? `${item.version} · ${item.title}` : item.title}</option>)}
              </select>
            </label>
          ) : <p className="text-xs text-[var(--app-muted)]">{preview ? gt("This preview does not publish your update.") : gt("Thanks for being part of SerikaCord.")}</p>}
          <Button className="bg-[var(--app-accent)] text-[var(--text-on-accent)] hover:bg-[var(--app-accent)] hover:opacity-90 max-sm:w-full" onClick={() => onOpenChange(false)}>
            {preview ? gt("Back to editor") : gt("Got it")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
