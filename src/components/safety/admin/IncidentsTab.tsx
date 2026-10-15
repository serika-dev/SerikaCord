"use client";

import { useId, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { ExternalLink, FileImage, Inbox, ShieldAlert } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { cn } from "@/lib/utils";
import { sendJson, useJsonQuery } from "../useJsonQuery";
import { formatDateTime, plain } from "../standingShared";
import {
  CopyButton,
  EmptyState,
  INCIDENT_STATUSES,
  KindBadge,
  LoadingBlock,
  StatusPill,
  TestBadge,
  UserChip,
  actionTakenLabel,
  cardClass,
  formatBytes,
  incidentStatusLabel,
  inputClass,
  labelClass,
  primaryBtn,
  textareaClass,
  type Incident,
  type OpenUser,
} from "./shared";

interface PhotoDnaFlagDetail {
  source?: string;
  violations?: string[];
  matchDistance?: number | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function DetailRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] sm:w-32 sm:pt-0.5">{label}</dt>
      <dd className={cn("min-w-0 break-words text-sm text-[var(--text-primary)]", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

/** What the scanner saw: PhotoDNA tracking info for CSAM, list entry + distance for scams. */
function IncidentDetails({ incident }: { incident: Incident }) {
  const gt = useGT();
  const d = incident.details ?? {};
  if (incident.kind === "csam") {
    const flags = Array.isArray(d.flags) ? (d.flags as PhotoDnaFlagDetail[]) : [];
    return (
      <>
        <DetailRow label={gt("Tracking ID")} mono>
          {str(d.trackingId) ? (
            <span className="inline-flex items-center gap-1">
              <span className="break-all">{str(d.trackingId)}</span>
              <CopyButton value={str(d.trackingId)!} label={gt("Copy tracking ID")} />
            </span>
          ) : (
            "—"
          )}
        </DetailRow>
        <DetailRow label={gt("Match flags")}>
          {flags.length === 0
            ? "—"
            : flags.map((f, i) => (
              <span key={i} className="block">
                {f.source || "?"}
                {f.violations?.length ? ` · ${f.violations.join(", ")}` : ""}
                {f.matchDistance != null ? ` · ${gt("distance {d}", { d: f.matchDistance })}` : ""}
              </span>
            ))}
        </DetailRow>
        {d.testSource === true && <DetailRow label={gt("Source")}>{gt("PhotoDNA test image set")}</DetailRow>}
      </>
    );
  }
  if (incident.kind === "scam_image") {
    return (
      <>
        <DetailRow label={gt("Matched entry")}>{str(d.label) ? plain(str(d.label)) : "—"}</DetailRow>
        <DetailRow label={gt("Distance")}>
          {num(d.distance) != null ? gt("{d} of 64 bits differ", { d: num(d.distance)! }) : "—"}
        </DetailRow>
        <DetailRow label={gt("Upload hash")} mono>{str(d.hash) ?? "—"}</DetailRow>
        <DetailRow label={gt("Listed hash")} mono>{str(d.matchedHash) ?? "—"}</DetailRow>
      </>
    );
  }
  return null;
}

function IncidentCard({ incident, onOpenUser, onChanged }: { incident: Incident; onOpenUser: OpenUser; onChanged: () => void }) {
  const gt = useGT();
  const ids = useId();
  const [status, setStatus] = useState(incident.status);
  const [notes, setNotes] = useState(plain(incident.notes));
  const [ncmec, setNcmec] = useState(plain(incident.ncmecReportId));
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(incident.status === "open");
  const isCsam = incident.kind === "csam";

  const dirty =
    status !== incident.status ||
    notes.trim() !== plain(incident.notes).trim() ||
    (isCsam && ncmec.trim() !== plain(incident.ncmecReportId).trim());

  const save = async () => {
    const body: Record<string, unknown> = {};
    if (status !== incident.status) body.status = status;
    if (notes.trim() !== plain(incident.notes).trim()) body.notes = notes.trim() || null;
    if (isCsam && ncmec.trim() !== plain(incident.ncmecReportId).trim()) {
      body.ncmecReportId = ncmec.trim() || null;
      // Recording a report id closes the incident as reported unless staff chose otherwise.
      if (ncmec.trim() && status === incident.status && incident.status === "open") body.status = "reported";
    }
    setSaving(true);
    try {
      await sendJson(`/api/admin/trust-safety/incidents/${incident.id}`, { method: "PATCH", json: body });
      toast.success(gt("Incident updated"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not update the incident"));
      setSaving(false);
    }
  };

  return (
    <li className={cn(cardClass, "overflow-hidden", isCsam && incident.status === "open" && !incident.isTest && "border-red-500/50")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5">
        <KindBadge kind={incident.kind} />
        {incident.isTest && <TestBadge />}
        <StatusPill status={incident.status} />
        <span className="ml-auto text-xs text-[var(--text-muted)]">{formatDateTime(incident.createdAt)}</span>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <UserChip user={incident.user} userId={incident.userId} onOpen={onOpenUser} />
          <span className="text-xs text-[var(--text-secondary)]">{actionTakenLabel(incident.actionTaken, gt)}</span>
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-app)] px-3 py-2 text-sm">
          <FileImage className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
          <span className="min-w-0 truncate text-[var(--text-primary)]">{plain(incident.fileName) || gt("Unnamed file")}</span>
          <span className="shrink-0 text-xs text-[var(--text-muted)]">
            {[incident.contentType, formatBytes(incident.fileSize), incident.uploadCategory].filter(Boolean).join(" · ")}
          </span>
        </div>

        <dl className="space-y-1.5">
          <DetailRow label="SHA-256" mono>
            {incident.sha256 ? (
              <span className="inline-flex items-center gap-1">
                <span className="break-all">{incident.sha256}</span>
                <CopyButton value={incident.sha256} label={gt("Copy SHA-256")} />
              </span>
            ) : (
              "—"
            )}
          </DetailRow>
          <IncidentDetails incident={incident} />
          {isCsam && incident.ip && (
            <DetailRow label={gt("Uploader IP")} mono>
              {incident.ip}
            </DetailRow>
          )}
          {incident.ncmecReportId && (
            <DetailRow label={gt("NCMEC report")}>
              {plain(incident.ncmecReportId)}
              {incident.ncmecReportedAt ? ` · ${formatDateTime(incident.ncmecReportedAt)}` : ""}
            </DetailRow>
          )}
          {incident.reviewer && (
            <DetailRow label={gt("Reviewed by")}>
              {plain(incident.reviewer.displayName || incident.reviewer.username)}
              {incident.reviewedAt ? ` · ${formatDateTime(incident.reviewedAt)}` : ""}
            </DetailRow>
          )}
        </dl>

        {!expanded ? (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm font-medium text-[var(--app-accent)] hover:underline"
          >
            {gt("Review")}
          </button>
        ) : (
          <div className="space-y-3 rounded-lg border border-[var(--border-subtle)] p-3">
            {isCsam && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-red-500">
                  <ShieldAlert className="h-4 w-4" aria-hidden />
                  {gt("Report confirmed matches to NCMEC")}
                </p>
                <p className="mt-1 text-xs text-[var(--text-secondary)]">
                  {gt("Confirmed CSAM matches must be reported to NCMEC's CyberTipline. The image itself was never stored; use the hashes, tracking ID and account details above. Record the report ID here once filed.")}
                </p>
                <a
                  href="https://report.cybertip.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--app-accent)] hover:underline"
                >
                  {gt("Open the CyberTipline")}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
                <label htmlFor={`${ids}-ncmec`} className={cn(labelClass, "mt-3")}>{gt("NCMEC report ID")}</label>
                <input
                  id={`${ids}-ncmec`}
                  value={ncmec}
                  onChange={(e) => setNcmec(e.target.value.slice(0, 100))}
                  placeholder={gt("e.g. 123456789")}
                  className={inputClass}
                />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div>
                <label htmlFor={`${ids}-status`} className={labelClass}>{gt("Status")}</label>
                <select id={`${ids}-status`} value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                  {INCIDENT_STATUSES.map((s) => (
                    <option key={s} value={s}>{incidentStatusLabel(s, gt)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`${ids}-notes`} className={labelClass}>{gt("Notes")}</label>
                <textarea
                  id={`${ids}-notes`}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 2000))}
                  rows={2}
                  placeholder={gt("Internal notes (staff only)")}
                  className={textareaClass}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={primaryBtn}>
                {saving && <Loader size={14} />}
                {gt("Save")}
              </button>
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

export function IncidentsTab({ onOpenUser, onChanged, reloadKey }: { onOpenUser: OpenUser; onChanged: () => void; reloadKey: number }) {
  const gt = useGT();
  const ids = useId();
  const [status, setStatus] = useState("open");
  const [kind, setKind] = useState("all");
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (kind !== "all") params.set("kind", kind);
  const { data, error, loading } = useJsonQuery<{ incidents: Incident[] }>(`/api/admin/trust-safety/incidents?${params}`, reloadKey);
  const incidents = data?.incidents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[calc(50%-0.375rem)] sm:w-48">
          <label htmlFor={`${ids}-status`} className={labelClass}>{gt("Status")}</label>
          <select id={`${ids}-status`} value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            {(["all", ...INCIDENT_STATUSES] as string[]).map((s) => (
              <option key={s} value={s}>{incidentStatusLabel(s, gt)}</option>
            ))}
          </select>
        </div>
        <div className="w-[calc(50%-0.375rem)] sm:w-48">
          <label htmlFor={`${ids}-kind`} className={labelClass}>{gt("Kind")}</label>
          <select id={`${ids}-kind`} value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
            <option value="all">{gt("All kinds")}</option>
            <option value="csam">{gt("CSAM (PhotoDNA)")}</option>
            <option value="scam_image">{gt("Scam image")}</option>
          </select>
        </div>
        {loading && data && <Loader size={18} />}
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        {gt("Blocked uploads are never stored, so incidents have no image to show — only the file's metadata and the scanner's result.")}
      </p>

      {!data && loading ? (
        <LoadingBlock />
      ) : error && !data ? (
        <EmptyState icon={<Inbox className="h-8 w-8" />} title={gt("Could not load incidents")}>{error}</EmptyState>
      ) : incidents.length === 0 ? (
        <EmptyState icon={<Inbox className="h-8 w-8" />} title={status === "open" ? gt("No open incidents") : gt("No incidents match these filters")} />
      ) : (
        <ul className="space-y-3">
          {incidents.map((i) => (
            <IncidentCard key={`${i.id}:${i.status}:${i.reviewedAt ?? ""}`} incident={i} onOpenUser={onOpenUser} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}
