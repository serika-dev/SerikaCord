"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronDown, Settings2 } from "lucide-react";
import { useGT } from "gt-next";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsStatusPill, type SettingsStatusTone } from "@/components/settings/blocks/SettingsStatusPill";
import { cn } from "@/lib/utils";

/**
 * One entry of the Integrations overview (Discord's Integrations page): brand
 * icon tile, title + status pill, one-line description and a Configure button
 * that expands the settings underneath. Matches the Discord bridge card.
 */
export function IntegrationCard({
  icon,
  iconStyle,
  title,
  description,
  status,
  statusTone = "neutral",
  open,
  onToggle,
  children,
}: {
  icon: ReactNode;
  /** Brand colour for the icon tile (`{ color }`). */
  iconStyle?: CSSProperties;
  title: ReactNode;
  description: ReactNode;
  status: ReactNode;
  statusTone?: SettingsStatusTone;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const gt = useGT();
  return (
    <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)]">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,currentColor_15%,transparent)]"
            style={iconStyle}
          >
            {icon}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--text-primary)]">
              {title}
              <SettingsStatusPill tone={statusTone} dot>
                {status}
              </SettingsStatusPill>
            </p>
            <p className="truncate text-sm text-[var(--text-secondary)]">{description}</p>
          </div>
        </div>
        <SettingsButton variant={open ? "secondary" : "primary"} onClick={onToggle} aria-expanded={open} className="sm:self-center">
          {open ? <ChevronDown /> : <Settings2 />}
          {open ? gt("Close") : gt("Configure")}
        </SettingsButton>
      </div>
      {open && (
        <div className={cn("border-t border-[var(--border-subtle)] p-4", "animate-in fade-in duration-150 motion-reduce:animate-none")}>
          {children}
        </div>
      )}
    </div>
  );
}
