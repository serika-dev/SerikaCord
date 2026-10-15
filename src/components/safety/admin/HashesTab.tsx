"use client";

import { useId, useRef, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Fingerprint, Hash, ImageUp, Plus, Trash2, X } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { DEFAULT_MATCH_DISTANCE, MAX_MATCH_DISTANCE, normalizeHash } from "@/lib/safety/imageHash";
import { sendJson, useJsonQuery } from "../useJsonQuery";
import { formatDate, formatDateTime, plain } from "../standingShared";
import {
  CopyButton,
  EmptyState,
  ImageDropZone,
  LoadingBlock,
  cardClass,
  formatBytes,
  inputClass,
  labelClass,
  primaryBtn,
  type ScamHash,
} from "./shared";

function ThresholdInput({
  value,
  onChange,
  onCommit,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  id: string;
}) {
  const gt = useGT();
  const commit = (e: React.SyntheticEvent<HTMLInputElement>) => onCommit?.(Number(e.currentTarget.value));
  return (
    <div className="flex items-center gap-3">
      <input
        id={id}
        type="range"
        min={0}
        max={MAX_MATCH_DISTANCE}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-valuetext={gt("{n} bits may differ", { n: value })}
        className="h-2 min-w-0 flex-1 cursor-pointer accent-[var(--app-accent)]"
      />
      <span className="w-8 shrink-0 text-right font-mono text-sm tabular-nums text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

function AddHashCard({ onAdded }: { onAdded: () => void }) {
  const gt = useGT();
  const ids = useId();
  const [mode, setMode] = useState<"image" | "hash">("image");
  const [label, setLabel] = useState("");
  const [distance, setDistance] = useState(DEFAULT_MATCH_DISTANCE);
  const [file, setFile] = useState<File | null>(null);
  const [hash, setHash] = useState("");
  const [busy, setBusy] = useState(false);
  const normalized = normalizeHash(hash);
  const ready = mode === "image" ? Boolean(file) : Boolean(normalized && label.trim());

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      if (mode === "image" && file) {
        const form = new FormData();
        form.append("file", file);
        if (label.trim()) form.append("label", label.trim());
        form.append("maxDistance", String(distance));
        await sendJson("/api/admin/trust-safety/hashes/from-image", { method: "POST", body: form });
      } else {
        await sendJson("/api/admin/trust-safety/hashes", { method: "POST", json: { hash: normalized, label: label.trim(), maxDistance: distance } });
      }
      toast.success(gt("Added to the scam hash list"));
      setFile(null);
      setHash("");
      setLabel("");
      onAdded();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not add the hash"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn(cardClass, "p-4 sm:p-5")} aria-labelledby={`${ids}-title`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${ids}-title`} className="text-sm font-semibold text-[var(--text-primary)]">{gt("Add a scam image")}</h3>
        <div role="tablist" aria-label={gt("How to add")} className="inline-flex rounded-lg bg-[var(--bg-app)] p-1">
          {(["image", "hash"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
                mode === m ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              )}
            >
              {m === "image" ? <ImageUp className="h-3.5 w-3.5" aria-hidden /> : <Hash className="h-3.5 w-3.5" aria-hidden />}
              {m === "image" ? gt("Upload image") : gt("Paste hash")}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {mode === "image" ? (
          file ? (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-app)] px-3 py-2 text-sm">
              <ImageUp className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{file.name}</span>
              <span className="shrink-0 text-xs text-[var(--text-muted)]">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => setFile(null)}
                aria-label={gt("Remove file")}
                className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : (
            <ImageDropZone
              onFile={setFile}
              title={gt("Drop the scam image here")}
              hint={gt("Only its perceptual hash is kept — the image itself is not stored.")}
              compact
            />
          )
        ) : (
          <div>
            <label htmlFor={`${ids}-hash`} className={labelClass}>{gt("Hash (16 hex characters)")}</label>
            <input
              id={`${ids}-hash`}
              value={hash}
              onChange={(e) => setHash(e.target.value.slice(0, 40))}
              placeholder={gt("e.g. {example}", { example: "8f3c1a0b9d7e6f21" })}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={hash.length > 0 && !normalized}
              className={cn(inputClass, "font-mono", hash.length > 0 && !normalized && "border-red-500")}
            />
            {hash.length > 0 && !normalized && <p className="mt-1 text-xs text-red-500">{gt("A hash is 16 hexadecimal characters (0-9, a-f).")}</p>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-label`} className={labelClass}>
              {mode === "image" ? gt("Label (defaults to the file name)") : gt("Label")}
            </label>
            <input
              id={`${ids}-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value.slice(0, 200))}
              placeholder={gt("e.g. Fake Nitro giveaway")}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor={`${ids}-dist`} className={labelClass}>{gt("Match threshold")}</label>
            <ThresholdInput id={`${ids}-dist`} value={distance} onChange={setDistance} />
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          {gt("The threshold is how many of the 64 hash bits may differ and still count as a match. Lower is stricter: 0 only matches near-identical copies; around 6 also catches re-encoded, resized or slightly edited versions. High values risk false matches.")}
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={() => void submit()} disabled={!ready || busy} className={primaryBtn}>
            {busy ? <Loader size={14} /> : <Plus className="h-4 w-4" aria-hidden />}
            {gt("Add to list")}
          </button>
        </div>
      </div>
    </section>
  );
}

function HashRow({ entry, onChanged }: { entry: ScamHash; onChanged: () => void }) {
  const gt = useGT();
  const confirm = useConfirm();
  const ids = useId();
  const [label, setLabel] = useState(plain(entry.label));
  const [distance, setDistance] = useState(entry.maxDistance);
  const [saving, setSaving] = useState(false);
  // Pointer-up, key-up and blur all commit; send each new value once.
  const committedDistance = useRef(entry.maxDistance);

  const patch = async (body: { label?: string; maxDistance?: number }) => {
    setSaving(true);
    try {
      await sendJson(`/api/admin/trust-safety/hashes/${entry.id}`, { method: "PATCH", json: body });
      toast.success(gt("Saved"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not save"));
      setLabel(plain(entry.label));
      setDistance(entry.maxDistance);
      committedDistance.current = entry.maxDistance;
    } finally {
      setSaving(false);
    }
  };

  const commitLabel = () => {
    const next = label.trim();
    if (!next) {
      setLabel(plain(entry.label));
      return;
    }
    if (next !== plain(entry.label)) void patch({ label: next });
  };

  const remove = async () => {
    const ok = await confirm({
      title: gt("Remove this hash?"),
      description: gt("Uploads matching \"{label}\" will no longer be blocked.", { label: plain(entry.label) }),
      confirmLabel: gt("Remove"),
    });
    if (!ok) return;
    setSaving(true);
    try {
      await sendJson(`/api/admin/trust-safety/hashes/${entry.id}`, { method: "DELETE" });
      toast.success(gt("Hash removed"));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not remove the hash"));
      setSaving(false);
    }
  };

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${ids}-label`} className="sr-only">{gt("Label")}</label>
          <input
            id={`${ids}-label`}
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 200))}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.stopPropagation();
                setLabel(plain(entry.label));
              }
            }}
            className="-ml-2 w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-[var(--text-primary)] outline-none hover:border-[var(--border-subtle)] focus:border-[var(--app-accent)] focus:bg-[var(--bg-input)]"
          />
          <p className="flex items-center gap-1 font-mono text-xs text-[var(--text-secondary)]">
            {entry.hash}
            <CopyButton value={entry.hash} label={gt("Copy hash")} />
          </p>
        </div>
        {saving && <Loader size={16} />}
        <button
          type="button"
          onClick={() => void remove()}
          disabled={saving}
          aria-label={gt("Remove hash")}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <div>
          <label htmlFor={`${ids}-dist`} className={labelClass}>{gt("Threshold (bits that may differ)")}</label>
          <ThresholdInput
            id={`${ids}-dist`}
            value={distance}
            onChange={setDistance}
            onCommit={(v) => {
              if (v === committedDistance.current) return;
              committedDistance.current = v;
              void patch({ maxDistance: v });
            }}
          />
        </div>
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
          <div>
            <dt className="inline">{gt("Matches")}: </dt>
            <dd className="inline font-semibold text-[var(--text-primary)]">{entry.matchCount}</dd>
          </div>
          <div>
            <dt className="inline">{gt("Last match")}: </dt>
            <dd className="inline">{entry.lastMatchedAt ? formatDateTime(entry.lastMatchedAt) : gt("never")}</dd>
          </div>
          <div>
            <dt className="inline">{gt("Added")}: </dt>
            <dd className="inline">
              {formatDate(entry.createdAt)}
              {entry.addedByUser ? ` · ${plain(entry.addedByUser.displayName || entry.addedByUser.username)}` : ""}
            </dd>
          </div>
        </dl>
      </div>
    </li>
  );
}

export function HashesTab({ onChanged, reloadKey }: { onChanged: () => void; reloadKey: number }) {
  const gt = useGT();
  const { data, error, loading } = useJsonQuery<{ hashes: ScamHash[] }>("/api/admin/trust-safety/hashes", reloadKey);
  const hashes = data?.hashes ?? [];

  return (
    <div className="space-y-4">
      <AddHashCard onAdded={onChanged} />
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
          {gt("Scam hash list ({count})", { count: hashes.length })}
        </h3>
        {loading && data && <Loader size={14} />}
      </div>
      {!data && loading ? (
        <LoadingBlock />
      ) : error && !data ? (
        <EmptyState icon={<Fingerprint className="h-8 w-8" />} title={gt("Could not load the hash list")}>{error}</EmptyState>
      ) : hashes.length === 0 ? (
        <EmptyState icon={<Fingerprint className="h-8 w-8" />} title={gt("No scam images listed yet")}>
          {gt("Add an image above: uploads that look like it are blocked, and the uploader gets a 24-hour chat restriction and a strike.")}
        </EmptyState>
      ) : (
        <ul className={cn(cardClass, "divide-y divide-[var(--border-subtle)]")}>
          {hashes.map((h) => (
            <HashRow key={`${h.id}:${h.label}:${h.maxDistance}`} entry={h} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}
