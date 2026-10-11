"use client";

import { useGT } from "gt-next";
import { Check, SmilePlus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { statusLabelInvisible } from "@/lib/statusLabels";
import { MobileSheet, SheetGroup } from "./MobileSheet";

type Presence = "online" | "idle" | "dnd" | "offline";
const PRESENCES: Presence[] = ["online", "idle", "dnd", "offline"];

/** Presence dot colours (status semantics, the same in every theme). */
export const PRESENCE_DOT: Record<Presence, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  offline: "bg-gray-500",
};

/**
 * Discord's "Change Online Status" sheet from the You tab: pick a presence in
 * one tap, or open the custom status editor.
 */
export function MobileStatusSheet({ onClose, onCustomStatus }: { onClose: () => void; onCustomStatus: () => void }) {
  const gt = useGT();
  const { user, setOnlineStatus } = useAuth();
  const current = (user?.status ?? "online") as Presence;

  const descriptions: Partial<Record<Presence, string>> = {
    dnd: gt("You will not receive desktop notifications"),
    offline: gt("You will appear offline, but have full access"),
  };

  return (
    <MobileSheet
      label={gt("Change Online Status")}
      onClose={onClose}
      header={<h2 className="px-4 pb-3 text-lg font-bold text-[var(--text-primary)]">{gt("Change Online Status")}</h2>}
    >
      <SheetGroup>
        {PRESENCES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              onClose();
              if (p !== current) void setOnlineStatus(p);
            }}
            className="flex min-h-12 w-full touch-manipulation items-center gap-3 px-4 py-2.5 text-left active:bg-[var(--bg-hover)]"
          >
            <span className={`h-3 w-3 shrink-0 rounded-full ${PRESENCE_DOT[p]}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-medium text-[var(--text-primary)]">{statusLabelInvisible(p, gt)}</span>
              {descriptions[p] ? (
                <span className="block text-xs text-[var(--text-muted)]">{descriptions[p]}</span>
              ) : null}
            </span>
            {p === current && <Check className="h-5 w-5 shrink-0 text-[var(--app-accent)]" />}
          </button>
        ))}
      </SheetGroup>
      <SheetGroup>
        <button
          type="button"
          onClick={() => {
            onClose();
            onCustomStatus();
          }}
          className="flex h-12 w-full touch-manipulation items-center gap-3 px-4 text-left text-[15px] font-medium text-[var(--text-primary)] active:bg-[var(--bg-hover)]"
        >
          <SmilePlus className="h-5 w-5 text-[var(--text-secondary)]" />
          {user?.customStatus ? gt("Edit Custom Status") : gt("Set Custom Status")}
        </button>
      </SheetGroup>
    </MobileSheet>
  );
}
