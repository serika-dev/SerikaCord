"use client";

import { useState } from "react";
import { T, useGT } from "gt-next";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { LinkOptionsForm } from "./LinkOptionsForm";
import { SettingRow, btnSecondary } from "./bits";
import { bridgeApi, type BridgeLinkOptions, type BridgeState } from "./types";

type ImportKey = "roles" | "permissions" | "emojis" | "stickers" | "sounds";

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
        <p className="text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-1">{children}</div>
    </section>
  );
}

/** Options tab: bridge switch, consent enforcement, defaults every link inherits, and the one-shot import. */
export function BridgeOptionsTab({
  serverId,
  state,
  onState,
  onImported,
}: {
  serverId: string;
  state: BridgeState;
  onState: (s: BridgeState) => void;
  onImported: () => void;
}) {
  const gt = useGT();
  const confirm = useConfirm();
  const [saving, setSaving] = useState<string | null>(null);
  const [importOpts, setImportOpts] = useState<Record<ImportKey, boolean>>({ roles: true, permissions: true, emojis: true, stickers: true, sounds: true });
  const [replace, setReplace] = useState(false);
  const [importing, setImporting] = useState(false);

  const patch = async (key: string, body: { enabled?: boolean; restrictUnconsented?: boolean; defaults?: Partial<BridgeLinkOptions> }, success: string) => {
    setSaving(key);
    const res = await bridgeApi<BridgeState>(serverId, "", { method: "PATCH", body });
    setSaving(null);
    if (!res.ok) {
      toast.error(res.error || gt("Could not save"));
      return;
    }
    onState(res.data);
    toast.success(success);
  };

  const runImport = async () => {
    if (replace) {
      const ok = await confirm({
        title: gt("Replace every channel?"),
        description: gt("All of this server's channels and their messages are deleted and rebuilt from Discord. This cannot be undone."),
        confirmLabel: gt("Replace channels"),
      });
      if (!ok) return;
    }
    setImporting(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/integrations/discord/sync`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: replace ? "delete" : "add", ...importOpts }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || gt("Import from Discord failed"));
        return;
      }
      const d = data?.details ?? {};
      toast.success(gt("Imported from Discord: {created} created, {linked} matched, {deleted} removed", { created: d.created ?? 0, linked: d.linked ?? 0, deleted: d.deleted ?? 0 }));
      if (Array.isArray(d.webhookFailures) && d.webhookFailures.length > 0) {
        toast.error(gt("The bot could not create webhooks in {count} channels. Check its Manage Webhooks permission, then repair them in Status.", { count: d.webhookFailures.length }));
      }
      onImported();
    } catch {
      toast.error(gt("Import from Discord failed"));
    } finally {
      setImporting(false);
    }
  };

  const importRows: Array<{ key: ImportKey; label: string; description: string }> = [
    { key: "roles", label: gt("Roles"), description: gt("Create SerikaCord roles for Discord roles that don't exist here yet (matched by name).") },
    { key: "permissions", label: gt("Channel permissions"), description: gt("Copy each Discord channel's role permission overwrites onto its SerikaCord channel.") },
    { key: "emojis", label: gt("Emojis"), description: gt("Copy custom emojis that don't exist here yet.") },
    { key: "stickers", label: gt("Stickers"), description: gt("Copy stickers that don't exist here yet.") },
    { key: "sounds", label: gt("Soundboard"), description: gt("Copy soundboard sounds that don't exist here yet.") },
  ];

  return (
    <div className="space-y-6">
      <Section title={gt("Bridge")} description={gt("Turn mirroring on or off for every linked channel at once.")}>
        <SettingRow label={<T>Mirror messages</T>} description={<T>When off, nothing crosses the bridge. Your links and options are kept.</T>}>
          <ToggleSwitch
            checked={state.enabled}
            disabled={saving === "enabled"}
            onCheckedChange={(v) => patch("enabled", { enabled: v }, v ? gt("Discord bridge turned on") : gt("Discord bridge turned off"))}
            aria-label={gt("Mirror messages")}
          />
        </SettingRow>
        <SettingRow
          label={<T>Restrict members who haven&apos;t agreed</T>}
          description={<T>Discord members who haven&apos;t agreed to data processing by Serika are timed out for a week (re-applied weekly) until they do. Their messages are never mirrored either way.</T>}
        >
          <ToggleSwitch
            checked={state.restrictUnconsented}
            disabled={saving === "restrict"}
            onCheckedChange={(v) => patch("restrict", { restrictUnconsented: v }, gt("Saved"))}
            aria-label={gt("Restrict members who haven't agreed")}
          />
        </SettingRow>
      </Section>

      <Section title={gt("Defaults for every link")} description={gt("New links start with these, and links you haven't customised follow them when they change.")}>
        <div className="py-2">
          <LinkOptionsForm
            value={state.defaults}
            disabled={saving === "defaults"}
            onChange={(p) => patch("defaults", { defaults: p }, gt("Defaults saved"))}
          />
        </div>
      </Section>

      <Section title={gt("Import from Discord")} description={gt("Copy the Discord server's structure here once. Channels are matched by name; existing links are kept.")}>
        {importRows.map((row) => (
          <SettingRow key={row.key} label={row.label} description={row.description}>
            <ToggleSwitch
              checked={importOpts[row.key]}
              onCheckedChange={(v) => setImportOpts((o) => ({ ...o, [row.key]: v }))}
              aria-label={row.label}
              size="sm"
            />
          </SettingRow>
        ))}
        <SettingRow
          label={<span className={cn(replace && "text-red-500")}><T>Replace all channels</T></span>}
          description={<T>Delete every SerikaCord channel first and rebuild the list from Discord. Destructive.</T>}
        >
          <ToggleSwitch checked={replace} onCheckedChange={setReplace} aria-label={gt("Replace all channels")} size="sm" />
        </SettingRow>
        <div className="flex justify-end py-3">
          <button type="button" className={cn(btnSecondary, replace && "border-red-500/40 text-red-500")} onClick={runImport} disabled={importing}>
            {importing ? <Loader size={14} /> : <Download className="size-4" aria-hidden="true" />}
            {importing ? gt("Importing…") : gt("Import now")}
          </button>
        </div>
      </Section>
    </div>
  );
}
