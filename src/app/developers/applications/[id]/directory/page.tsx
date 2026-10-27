"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import { AlertTriangle, BadgeCheck, Check, Circle, ExternalLink, ImagePlus, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useGT, useLocale } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { AppDirectoryCard, formatCount } from "@/components/apps/AppDirectoryCard";
import { APP_CATEGORIES, appCategoryLabel, LISTING_LIMITS, type AppCategory } from "@/lib/appDirectory/listing";
import { cdnImage, cn } from "@/lib/utils";

// Developer portal → App Directory Page: the listing shown on /bots and in
// Server Settings → App Discovery, its status, and verification progress.
// API: GET/PATCH /api/developers/applications/:id/directory, POST .../cover,
// POST .../verification. Rules: src/lib/appDirectory/listing.ts.

type State = "draft" | "listed" | "delisted" | "hidden";
type Problem = "no_bot" | "not_public" | "missing_description" | "missing_category";

interface DirectoryData {
  listing: {
    name: string;
    listed: boolean;
    shortDescription: string;
    longDescription: string;
    categories: AppCategory[];
    tags: string[];
    website: string | null;
    supportUrl: string | null;
    termsOfServiceUrl: string | null;
    privacyPolicyUrl: string | null;
    coverImage: string | null;
    icon: string | null;
  };
  status: {
    state: State;
    problems: Problem[];
    delistedReason: string | null;
    featured: boolean;
    hasBot: boolean;
    botPublic: boolean;
    publicPath: string;
  };
  verification: {
    status: "none" | "pending" | "approved" | "rejected";
    verified: boolean;
    serverCount: number;
    threshold: number;
    requirements: { id: "bot" | "servers"; met: boolean; current?: number; required?: number }[];
    note: string | null;
    requestedAt: string | null;
    reviewedAt: string | null;
    reapplyAfter: string | null;
  };
  canEdit: boolean;
}

interface Form {
  shortDescription: string;
  longDescription: string;
  categories: AppCategory[];
  tags: string[];
  website: string;
  supportUrl: string;
  termsOfServiceUrl: string;
  privacyPolicyUrl: string;
}

const LABEL = "block text-xs font-semibold text-[#888] uppercase tracking-wide mb-2";
const INPUT = "w-full bg-white/[0.03] border border-white/[0.08] rounded-md px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:border-[#8B5CF6]/50 disabled:opacity-60";
const CARD = "rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5";
const PREVIEW_TOKENS = {
  "--app-surface": "rgba(255, 255, 255, 0.03)",
  "--app-surface-alt": "rgba(255, 255, 255, 0.07)",
  "--app-border": "rgba(255, 255, 255, 0.08)",
  "--app-text": "rgba(255, 255, 255, 0.95)",
  "--app-muted": "rgba(255, 255, 255, 0.55)",
} as CSSProperties;

function toForm(d: DirectoryData): Form {
  return {
    shortDescription: d.listing.shortDescription,
    longDescription: d.listing.longDescription,
    categories: d.listing.categories,
    tags: d.listing.tags,
    website: d.listing.website ?? "",
    supportUrl: d.listing.supportUrl ?? "",
    termsOfServiceUrl: d.listing.termsOfServiceUrl ?? "",
    privacyPolicyUrl: d.listing.privacyPolicyUrl ?? "",
  };
}

export default function DirectoryPage() {
  const gt = useGT();
  const locale = useLocale();
  const params = useParams();
  const appId = params.id as string;
  const [data, setData] = useState<DirectoryData | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [newTag, setNewTag] = useState("");
  const coverInput = useRef<HTMLInputElement>(null);

  const apply = useCallback((d: DirectoryData) => {
    setData(d);
    setForm(toForm(d));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/developers/applications/${appId}/directory`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || gt("Failed to load the directory listing"));
      apply(body as DirectoryData);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : gt("Failed to load the directory listing"));
    }
  }, [appId, apply, gt]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, success: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/directory`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(resBody.error || gt("Failed to save changes"));
        return false;
      }
      apply(resBody as DirectoryData);
      toast.success(success);
      return true;
    } catch {
      toast.error(gt("Failed to save changes"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = () => {
    if (!form) return;
    void patch({
      shortDescription: form.shortDescription,
      longDescription: form.longDescription,
      categories: form.categories,
      tags: form.tags,
      website: form.website.trim() || null,
      supportUrl: form.supportUrl.trim() || null,
      termsOfServiceUrl: form.termsOfServiceUrl.trim() || null,
      privacyPolicyUrl: form.privacyPolicyUrl.trim() || null,
    }, gt("Directory page saved"));
  };

  const toggleListed = (listed: boolean) => {
    if (!form) return;
    // Publishing also saves the current form, so the listing goes live as shown.
    void patch(listed ? {
      listed: true,
      shortDescription: form.shortDescription,
      longDescription: form.longDescription,
      categories: form.categories,
      tags: form.tags,
      website: form.website.trim() || null,
      supportUrl: form.supportUrl.trim() || null,
      termsOfServiceUrl: form.termsOfServiceUrl.trim() || null,
      privacyPolicyUrl: form.privacyPolicyUrl.trim() || null,
    } : { listed: false }, listed ? gt("Your app is now listed") : gt("Your app was removed from the directory"));
  };

  const uploadCover = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/developers/applications/${appId}/cover`, { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || gt("Failed to upload cover image"));
      toast.success(gt("Cover image updated"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to upload cover image"));
    } finally {
      setUploading(false);
    }
  };

  const applyForVerification = async () => {
    setApplying(true);
    try {
      const res = await fetch(`/api/developers/applications/${appId}/verification`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || gt("Failed to apply for verification"));
      toast.success(gt("Verification request sent"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : gt("Failed to apply for verification"));
    } finally {
      setApplying(false);
    }
  };

  if (loadError && !data) {
    return <p className="py-20 text-center text-sm text-red-400">{loadError}</p>;
  }
  if (!data || !form) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader size={24} className="size-6" />
      </div>
    );
  }

  const { status, verification, canEdit } = data;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const toggleCategory = (c: AppCategory) => {
    if (form.categories.includes(c)) set("categories", form.categories.filter((x) => x !== c));
    else if (form.categories.length < LISTING_LIMITS.categories) set("categories", [...form.categories, c]);
  };
  const addTag = () => {
    const t = newTag.trim().replace(/\s+/g, " ").slice(0, LISTING_LIMITS.tagLength);
    if (t && !form.tags.some((x) => x.toLowerCase() === t.toLowerCase()) && form.tags.length < LISTING_LIMITS.tags) {
      set("tags", [...form.tags, t]);
      setNewTag("");
    }
  };

  const stateLabel = status.state === "listed" ? gt("Listed") : status.state === "delisted" ? gt("Delisted by staff") : status.state === "hidden" ? gt("Listed, but hidden") : gt("Draft");
  const stateTone = status.state === "listed" ? "bg-green-500/15 text-green-400" : status.state === "delisted" ? "bg-red-500/15 text-red-400" : status.state === "hidden" ? "bg-yellow-500/15 text-yellow-400" : "bg-white/[0.06] text-[#aaa]";
  const problemText = (p: Problem) => {
    switch (p) {
      case "no_bot": return gt("Enable the bot on the Bot page.");
      case "not_public": return gt("Turn on Public Bot on the Bot page so anyone can add it.");
      case "missing_description": return gt("Write a short description.");
      case "missing_category": return gt("Pick at least one category.");
    }
  };
  const verificationLabel = verification.verified
    ? gt("Verified")
    : verification.status === "pending" ? gt("Pending review")
    : verification.status === "rejected" ? gt("Not approved")
    : gt("Not verified");
  const serversMet = verification.serverCount >= verification.threshold;
  const listedOn = status.state === "listed" || status.state === "hidden" || (status.state === "delisted" && data.listing.listed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-2">{gt("App Directory Page")}</h1>
        <p className="text-sm text-[#888]">
          {gt("How your app appears in the public bot library (/bots) and in App Discovery inside server settings.")}
        </p>
      </div>

      {/* Listing status */}
      <section className={CARD} aria-labelledby="listing-status-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="listing-status-title" className="text-sm font-semibold">{gt("Listing status")}</h2>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", stateTone)}>{stateLabel}</span>
              {status.featured && <span className="rounded-full bg-[#8B5CF6]/15 px-2 py-0.5 text-[11px] font-semibold text-[#a78bfa]">{gt("Staff pick")}</span>}
            </div>
            <p className="mt-1.5 text-sm text-[#888]">
              {status.state === "listed" && gt("Anyone can find your app in the bot library and add it to their servers.")}
              {status.state === "draft" && gt("Your app is not in the directory. Fill in the listing and turn on listing to publish it.")}
              {status.state === "hidden" && gt("Your listing is on, but nobody can find the app until the problems below are fixed.")}
              {status.state === "delisted" && gt("Staff removed your app from the directory. Fix the issue below and contact support to have it relisted.")}
            </p>
            {status.state === "delisted" && status.delistedReason && (
              <p className="mt-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <span className="font-semibold">{gt("Reason:")}</span> {status.delistedReason}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {(status.state === "listed" || status.state === "hidden") && (
              <a href={status.publicPath} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-[#a78bfa] hover:underline">
                {gt("View public page")}
                <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
            <label className="flex items-center gap-2 text-sm">
              <span>{gt("List in directory")}</span>
              <ToggleSwitch
                checked={listedOn}
                onCheckedChange={(v: boolean) => toggleListed(v)}
                disabled={!canEdit || saving || status.state === "delisted"}
              />
            </label>
          </div>
        </div>
        {status.problems.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {status.problems.map((p) => (
              <li key={p} className="flex items-start gap-2 text-sm text-yellow-300/90">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {problemText(p)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Verification progress */}
      <section className={CARD} aria-labelledby="verification-title">
        <div className="flex flex-wrap items-center gap-2">
          <BadgeCheck className="size-4 text-[#8B5CF6]" aria-hidden />
          <h2 id="verification-title" className="text-sm font-semibold">{gt("Verification")}</h2>
          <span className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            verification.verified ? "bg-green-500/15 text-green-400" : verification.status === "pending" ? "bg-yellow-500/15 text-yellow-400" : verification.status === "rejected" ? "bg-red-500/15 text-red-400" : "bg-white/[0.06] text-[#aaa]",
          )}>
            {verificationLabel}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-[#888]">
          {gt("Verified apps get a badge in the directory, and their owner gets the Verified Bot Developer badge.")}
        </p>
        <ul className="mt-4 space-y-3">
          {verification.requirements.map((r) => (
            <li key={r.id} className="flex items-start gap-3">
              {r.met ? <Check className="mt-0.5 size-4 shrink-0 text-green-400" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-[#555]" aria-hidden />}
              <div className="min-w-0 flex-1">
                {r.id === "bot" ? (
                  <p className="text-sm">{gt("The app has a bot user")}</p>
                ) : (
                  <>
                    <p className="text-sm">{gt("The bot is in at least {count} servers", { count: verification.threshold })}</p>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#6366f1] transition-all" style={{ width: `${Math.min(verification.serverCount / verification.threshold, 1) * 100}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-[#888]">{formatCount(verification.serverCount, locale)}/{verification.threshold}</span>
                    </div>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        {verification.status === "rejected" && verification.note && (
          <p className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <span className="font-semibold">{gt("Staff note:")}</span> {verification.note}
          </p>
        )}
        {!verification.verified && verification.status === "none" && verification.note && (
          <p className="mt-4 rounded-md border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200">
            <span className="font-semibold">{gt("Staff note:")}</span> {verification.note}
          </p>
        )}
        <div className="mt-4">
          {verification.verified ? null : verification.status === "pending" ? (
            <p className="text-xs text-[#888]">
              {verification.requestedAt
                ? gt("Requested {date}. Staff will review it soon.", { date: new Date(verification.requestedAt).toLocaleDateString(locale) })
                : gt("Your request is waiting for staff review.")}
            </p>
          ) : verification.reapplyAfter ? (
            <p className="text-xs text-[#888]">
              {gt("You can apply again on {date}.", { date: new Date(verification.reapplyAfter).toLocaleDateString(locale) })}
            </p>
          ) : serversMet && status.hasBot ? (
            <button
              type="button"
              onClick={() => void applyForVerification()}
              disabled={applying || !canEdit}
              className="rounded-lg bg-[#8B5CF6] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#7C3AED] disabled:opacity-40"
            >
              {applying ? <Loader size={16} className="size-4" /> : verification.status === "rejected" ? gt("Apply again") : gt("Apply for Verification")}
            </button>
          ) : (
            <p className="text-xs text-[#666]">{gt("Meet every requirement above to apply.")}</p>
          )}
        </div>
      </section>

      {/* Listing fields */}
      <section className="space-y-6" aria-labelledby="listing-title">
        <h2 id="listing-title" className="text-sm font-semibold">{gt("Listing")}</h2>

        <div>
          <label className={LABEL} htmlFor="dir-short">{gt("Short Description")}</label>
          <input
            id="dir-short"
            type="text"
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            maxLength={LISTING_LIMITS.shortDescription}
            disabled={!canEdit}
            className={INPUT}
            placeholder={gt("A brief one-liner about your app")}
          />
          <p className="mt-1.5 text-xs text-[#666]">{form.shortDescription.length}/{LISTING_LIMITS.shortDescription}</p>
        </div>

        <div>
          <label className={LABEL} htmlFor="dir-long">{gt("Long Description")}</label>
          <textarea
            id="dir-long"
            value={form.longDescription}
            onChange={(e) => set("longDescription", e.target.value)}
            maxLength={LISTING_LIMITS.longDescription}
            rows={10}
            disabled={!canEdit}
            className={cn(INPUT, "resize-y font-mono text-[13px]")}
            placeholder={gt("Describe what your app does, its main commands and how to get started. Markdown is supported.")}
          />
          <p className="mt-1.5 text-xs text-[#666]">{form.longDescription.length}/{LISTING_LIMITS.longDescription}</p>
        </div>

        <fieldset>
          <legend className={LABEL}>{gt("Categories (up to {count})", { count: LISTING_LIMITS.categories })}</legend>
          <div className="flex flex-wrap gap-2">
            {APP_CATEGORIES.map((c) => {
              const on = form.categories.includes(c);
              const full = !on && form.categories.length >= LISTING_LIMITS.categories;
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit || full}
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40",
                    on ? "border-[#8B5CF6] bg-[#8B5CF6]/20 text-white" : "border-white/[0.1] text-[#aaa] hover:border-white/[0.2] hover:text-white",
                  )}
                >
                  {appCategoryLabel(c, gt)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label className={LABEL} htmlFor="dir-tag">{gt("Tags (up to {count})", { count: LISTING_LIMITS.tags })}</label>
          <div className="flex flex-wrap items-center gap-2">
            {form.tags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs">
                {t}
                {canEdit && (
                  <button type="button" onClick={() => set("tags", form.tags.filter((x) => x !== t))} aria-label={gt("Remove tag {tag}", { tag: t })} className="text-[#888] hover:text-white">
                    <X className="size-3" aria-hidden />
                  </button>
                )}
              </span>
            ))}
            {canEdit && form.tags.length < LISTING_LIMITS.tags && (
              <input
                id="dir-tag"
                type="text"
                value={newTag}
                maxLength={LISTING_LIMITS.tagLength}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder={gt("Add a tag")}
                className={cn(INPUT, "w-40 py-1.5")}
              />
            )}
          </div>
        </div>

        <div>
          <span className={LABEL}>{gt("Cover Image")}</span>
          <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
            {data.listing.coverImage ? (
              // eslint-disable-next-line @next/next/no-img-element -- CDN cover preview
              <img src={cdnImage(data.listing.coverImage)} alt="" className="aspect-[3/1] w-full object-cover" />
            ) : (
              <div className="flex aspect-[3/1] w-full items-center justify-center text-sm text-[#555]">{gt("No cover image")}</div>
            )}
          </div>
          {canEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                ref={coverInput}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void uploadCover(f);
                }}
              />
              <button type="button" onClick={() => coverInput.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] px-3 py-1.5 text-xs hover:bg-white/[0.04] disabled:opacity-40">
                {uploading ? <Loader size={14} className="size-3.5" /> : <ImagePlus className="size-3.5" aria-hidden />}
                {gt("Upload cover")}
              </button>
              {data.listing.coverImage && (
                <button type="button" onClick={() => void patch({ coverImage: null }, gt("Cover image removed"))} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.1] px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40">
                  <Trash2 className="size-3.5" aria-hidden />
                  {gt("Remove")}
                </button>
              )}
              <span className="text-xs text-[#666]">{gt("Wide images work best (3:1, at least 1500×500).")}</span>
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <UrlField id="dir-support" label={gt("Support Server")} value={form.supportUrl} onChange={(v) => set("supportUrl", v)} placeholder="https://serika.chat/invite/..." disabled={!canEdit} />
          <UrlField id="dir-website" label={gt("Website")} value={form.website} onChange={(v) => set("website", v)} placeholder="https://..." disabled={!canEdit} />
          <UrlField id="dir-terms" label={gt("Terms of Service URL")} value={form.termsOfServiceUrl} onChange={(v) => set("termsOfServiceUrl", v)} placeholder="https://..." disabled={!canEdit} />
          <UrlField id="dir-privacy" label={gt("Privacy Policy URL")} value={form.privacyPolicyUrl} onChange={(v) => set("privacyPolicyUrl", v)} placeholder="https://..." disabled={!canEdit} />
        </div>
      </section>

      {/* Preview */}
      <section className={CARD} aria-labelledby="preview-title">
        <h2 id="preview-title" className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#888]">{gt("Card preview")}</h2>
        {/* The portal is always dark: give the shared card dark tokens here. */}
        <div className="max-w-sm" style={PREVIEW_TOKENS}>
          <AppDirectoryCard
            app={{
              id: appId,
              name: data.listing.name,
              icon: data.listing.icon,
              shortDescription: form.shortDescription,
              categories: form.categories,
              tags: form.tags,
              verified: verification.verified,
              serverCount: verification.serverCount,
            }}
            labels={{
              verified: gt("Verified app"),
              noDescription: gt("No description yet."),
              servers: verification.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(verification.serverCount, locale) }),
              categories: form.categories.map((c) => appCategoryLabel(c, gt)),
            }}
          />
        </div>
      </section>

      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-[#8B5CF6] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#7C3AED] disabled:opacity-40"
          >
            {saving ? <Loader size={24} className="size-4" /> : <Save className="size-4" />}
            {gt("Save Changes")}
          </button>
        </div>
      )}
    </div>
  );
}

function UrlField({ id, label, value, onChange, placeholder, disabled }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean }) {
  return (
    <div>
      <label className={LABEL} htmlFor={id}>{label}</label>
      <input id={id} type="url" inputMode="url" value={value} onChange={(e) => onChange(e.target.value)} maxLength={LISTING_LIMITS.url} placeholder={placeholder} disabled={disabled} className={INPUT} />
    </div>
  );
}
