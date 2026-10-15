"use client";

import { useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  AlertOctagon,
  Ban,
  CheckCircle2,
  FileWarning,
  Fingerprint,
  Flag,
  Gavel,
  Inbox,
  MessageSquareOff,
  ScanSearch,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { PhotoDnaMatchFlag } from "@/lib/safety/photoDna";
import { sendJson } from "../useJsonQuery";
import { CopyButton, ImageDropZone, LoadingBlock, cardClass, formatBytes } from "./shared";

export interface TrustSafetyStats {
  openIncidents: number;
  csam30d: number;
  scam30d: number;
  openAppeals: number;
  activeRestrictions: number;
  activeStrikes: number;
  hashes: number;
  suspended: number;
  photoDnaEnabled: number;
  /** Reported messages with an open report (the Reports tab). */
  openMessageReports?: number;
}

type PhotoDnaOutcome =
  | { status: "match"; trackingId: string | null; flags: PhotoDnaMatchFlag[]; isTestSource: boolean }
  | { status: "clean"; trackingId: string | null }
  | { status: "error"; code: number | null; description: string };

interface ScanTestResult {
  hash: string | null;
  scamMatch: { id: string; label: string; distance: number } | null;
  photoDna: PhotoDnaOutcome | null;
  photoDnaEnabled: boolean;
}

export type OverviewTarget = "incidents" | "reports" | "appeals" | "accounts" | "hashes";

function StatCard({
  label,
  value,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone: "red" | "amber" | "accent" | "muted";
  onClick?: () => void;
}) {
  const toneClass =
    tone === "red"
      ? "bg-red-500/10 text-red-500"
      : tone === "amber"
        ? "bg-amber-500/10 text-amber-500"
        : tone === "accent"
          ? "bg-[var(--app-accent)]/10 text-[var(--app-accent)]"
          : "bg-[var(--bg-app)] text-[var(--text-secondary)]";
  const inner = (
    <>
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", toneClass)}>{icon}</span>
      <span className="mt-3 block text-2xl font-bold tabular-nums text-[var(--text-primary)]">{value.toLocaleString()}</span>
      <span className="block text-xs font-medium text-[var(--text-secondary)]">{label}</span>
    </>
  );
  if (!onClick) return <div className={cn(cardClass, "p-4")}>{inner}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(cardClass, "p-4 text-left transition-colors hover:border-[var(--app-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]")}
    >
      {inner}
    </button>
  );
}

function ScanTestTool({ photoDnaEnabled }: { photoDnaEnabled: boolean }) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ fileName: string; size: number; data: ScanTestResult } | null>(null);

  const scan = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const data = await sendJson<ScanTestResult>("/api/admin/trust-safety/scan-test", { method: "POST", body: form });
      setResult({ fileName: file.name, size: file.size, data });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Scan failed"));
    } finally {
      setBusy(false);
    }
  };

  const pdna = result?.data.photoDna ?? null;

  return (
    <section className={cn(cardClass, "p-4 sm:p-5")} aria-labelledby="ts-scan-test">
      <div className="mb-3 flex items-start gap-3">
        <ScanSearch className="mt-0.5 h-5 w-5 shrink-0 text-[var(--app-accent)]" aria-hidden />
        <div>
          <h3 id="ts-scan-test" className="text-sm font-semibold text-[var(--text-primary)]">{gt("Test scan")}</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {gt("Runs an image through both scanners exactly like an upload would. This is a dry run: nothing is stored, recorded or punished, and the image is never shown.")}
          </p>
        </div>
      </div>
      <ImageDropZone onFile={(f) => void scan(f)} busy={busy} title={gt("Drop an image to scan")} hint={gt("JPEG, PNG, GIF, WebP · up to 20 MB")} compact />

      {result && (
        <div className="mt-4 space-y-3" aria-live="polite">
          <p className="truncate text-xs text-[var(--text-muted)]">
            {result.fileName} · {formatBytes(result.size)}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-[var(--bg-app)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Perceptual hash")}</p>
              {result.data.hash ? (
                <p className="mt-1 flex items-center gap-1 font-mono text-sm text-[var(--text-primary)]">
                  <span className="break-all">{result.data.hash}</span>
                  <CopyButton value={result.data.hash} label={gt("Copy hash")} />
                </p>
              ) : (
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{gt("Could not be computed")}</p>
              )}
            </div>
            <div className={cn("rounded-lg p-3", result.data.scamMatch ? "bg-amber-500/10" : "bg-[var(--bg-app)]")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Scam hash list")}</p>
              {result.data.scamMatch ? (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-amber-500">
                    <AlertOctagon className="h-4 w-4" aria-hidden />
                    {gt("Match")}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {gt("{label} · {distance} bits apart", { label: result.data.scamMatch.label, distance: result.data.scamMatch.distance })}
                  </p>
                </>
              ) : (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {gt("No match")}
                </p>
              )}
            </div>
            <div className={cn("rounded-lg p-3", pdna?.status === "match" ? "bg-red-500/10" : "bg-[var(--bg-app)]")}>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("PhotoDNA")}</p>
              {!result.data.photoDnaEnabled || !pdna ? (
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{gt("Not configured")}</p>
              ) : pdna.status === "match" ? (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-bold text-red-500">
                    <ShieldAlert className="h-4 w-4" aria-hidden />
                    {pdna.isTestSource ? gt("Match (test image)") : gt("Match")}
                  </p>
                  {pdna.trackingId && <p className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{pdna.trackingId}</p>}
                  {pdna.flags.map((f, i) => (
                    <p key={i} className="text-xs text-[var(--text-secondary)]">
                      {f.source}
                      {f.violations.length > 0 ? ` · ${f.violations.join(", ")}` : ""}
                      {f.matchDistance != null ? ` · ${gt("distance {d}", { d: f.matchDistance })}` : ""}
                    </p>
                  ))}
                </>
              ) : pdna.status === "clean" ? (
                <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {gt("Clean")}
                </p>
              ) : (
                <>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-500">
                    <XCircle className="h-4 w-4" aria-hidden />
                    {gt("Error")}
                  </p>
                  <p className="break-words text-xs text-[var(--text-secondary)]">
                    {pdna.code != null ? `${pdna.code}: ` : ""}
                    {pdna.description}
                  </p>
                </>
              )}
            </div>
          </div>
          {!photoDnaEnabled && (
            <p className="text-xs text-[var(--text-muted)]">{gt("Set PHOTODNA_KEY on the server to enable CSAM scanning.")}</p>
          )}
        </div>
      )}
    </section>
  );
}

export function OverviewTab({ stats, onNavigate }: { stats: TrustSafetyStats | null; onNavigate: (tab: OverviewTarget) => void }) {
  const gt = useGT();
  if (!stats) return <LoadingBlock />;
  const photoDnaEnabled = Boolean(stats.photoDnaEnabled);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
            photoDnaEnabled ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", photoDnaEnabled ? "bg-emerald-500" : "bg-amber-500")} aria-hidden />
          {photoDnaEnabled ? gt("PhotoDNA scanning enabled") : gt("PhotoDNA scanning disabled")}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{gt("Image uploads are checked against PhotoDNA (CSAM) and the scam hash list.")}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={gt("Open incidents")} value={stats.openIncidents} icon={<Inbox className="h-5 w-5" aria-hidden />} tone={stats.openIncidents > 0 ? "red" : "muted"} onClick={() => onNavigate("incidents")} />
        <StatCard label={gt("CSAM matches (30 days)")} value={stats.csam30d} icon={<ShieldAlert className="h-5 w-5" aria-hidden />} tone={stats.csam30d > 0 ? "red" : "muted"} onClick={() => onNavigate("incidents")} />
        <StatCard label={gt("Scam matches (30 days)")} value={stats.scam30d} icon={<FileWarning className="h-5 w-5" aria-hidden />} tone={stats.scam30d > 0 ? "amber" : "muted"} onClick={() => onNavigate("incidents")} />
        <StatCard label={gt("Open message reports")} value={stats.openMessageReports ?? 0} icon={<Flag className="h-5 w-5" aria-hidden />} tone={(stats.openMessageReports ?? 0) > 0 ? "red" : "muted"} onClick={() => onNavigate("reports")} />
        <StatCard label={gt("Open appeals")} value={stats.openAppeals} icon={<Gavel className="h-5 w-5" aria-hidden />} tone={stats.openAppeals > 0 ? "accent" : "muted"} onClick={() => onNavigate("appeals")} />
        <StatCard label={gt("Active restrictions")} value={stats.activeRestrictions} icon={<MessageSquareOff className="h-5 w-5" aria-hidden />} tone="muted" onClick={() => onNavigate("accounts")} />
        <StatCard label={gt("Active strikes")} value={stats.activeStrikes} icon={<Gavel className="h-5 w-5" aria-hidden />} tone="muted" onClick={() => onNavigate("accounts")} />
        <StatCard label={gt("Suspended accounts")} value={stats.suspended} icon={<Ban className="h-5 w-5" aria-hidden />} tone="muted" onClick={() => onNavigate("accounts")} />
        <StatCard label={gt("Scam hashes")} value={stats.hashes} icon={<Fingerprint className="h-5 w-5" aria-hidden />} tone="muted" onClick={() => onNavigate("hashes")} />
      </div>

      <ScanTestTool photoDnaEnabled={photoDnaEnabled} />
    </div>
  );
}
