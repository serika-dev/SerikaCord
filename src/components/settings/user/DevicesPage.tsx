"use client";

import { memo, useState, type Dispatch, type SetStateAction } from "react";
import { useGT, useLocale } from "gt-next";
import { AppWindow, LogOut, Monitor, MonitorSmartphone, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { SettingsCard, SettingsPageHeader, SettingsSection } from "@/components/settings/SettingsSection";
import { SettingsListItem } from "@/components/settings/blocks/SettingsListItem";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsEmptyState } from "@/components/settings/blocks/SettingsEmptyState";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import { SettingsStatusPill } from "@/components/settings/blocks/SettingsStatusPill";
import { PasskeysSettingsRow } from "@/components/settings/PasskeysSettingsRow";
import { useConfirm } from "@/components/ui/confirm-dialog";

export interface DeviceSession {
  id: string;
  deviceName?: string;
  platform?: string;
  current?: boolean;
  lastActiveAt?: string;
}

function deviceIcon(device: DeviceSession) {
  const platform = (device.platform || "").toLowerCase();
  const name = (device.deviceName || "").toLowerCase();
  if (platform === "android" || platform === "ios") return Smartphone;
  if (name.includes("desktop")) return AppWindow;
  return Monitor;
}

function relativeTime(iso: string | undefined, locale: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.round((then - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (abs < 60) return rtf.format(0, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Discord's Devices page: this device on top, then every other signed-in
 * device with its client, platform and last activity and a Log out action,
 * plus "Log out all known devices".
 */
export const DevicesPage = memo(function DevicesPage({
  devices,
  setDevices,
  loaded,
}: {
  devices: DeviceSession[];
  setDevices: Dispatch<SetStateAction<DeviceSession[]>>;
  /** False until the first settings fetch finished (shows skeleton rows). */
  loaded: boolean;
}) {
  const gt = useGT();
  const locale = useLocale();
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);

  const current = devices.filter((d) => d.current);
  const others = devices.filter((d) => !d.current);

  const revoke = async (device: DeviceSession, quiet = false) => {
    const response = await fetch(`/api/users/me/devices/${device.id}`, { method: "DELETE" });
    if (response.ok) {
      setDevices((prev) => prev.filter((item) => item.id !== device.id));
      if (!quiet) toast.success(gt("Device revoked"));
      return true;
    }
    if (!quiet) toast.error(gt("Failed to revoke device"));
    return false;
  };

  const logOutOne = async (device: DeviceSession) => {
    setBusyId(device.id);
    try {
      await revoke(device);
    } finally {
      setBusyId(null);
    }
  };

  const logOutAll = async () => {
    const ok = await confirm({
      title: gt("Log out all known devices?"),
      description: gt("You'll stay signed in on this device. Every other device has to sign in again."),
      confirmLabel: gt("Log Out All"),
    });
    if (!ok) return;
    setBusyAll(true);
    try {
      const results = await Promise.all(others.map((d) => revoke(d, true)));
      if (results.every(Boolean)) toast.success(gt("Logged out of all other devices"));
      else toast.error(gt("Failed to revoke device"));
    } finally {
      setBusyAll(false);
    }
  };

  const renderDevice = (device: DeviceSession) => {
    const Icon = deviceIcon(device);
    const when = relativeTime(device.lastActiveAt, locale);
    return (
      <SettingsListItem
        key={device.id}
        leading={
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)]">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
        }
        title={device.deviceName || gt("Unknown device")}
        badges={device.current ? <SettingsStatusPill tone="accent">{gt("This device")}</SettingsStatusPill> : undefined}
        subtitle={[device.platform, device.current ? gt("Active now") : when].filter(Boolean).join(" · ")}
        actions={
          device.current ? undefined : (
            <SettingsButton
              variant="secondary"
              size="sm"
              disabled={busyId === device.id || busyAll}
              onClick={() => void logOutOne(device)}
              aria-label={gt("Log out of {device}", { device: device.deviceName || gt("Unknown device") })}
            >
              <LogOut aria-hidden />
              {gt("Log Out")}
            </SettingsButton>
          )
        }
      />
    );
  };

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={gt("Devices")}
        description={gt("Here are all the devices that are currently logged in with your account. Log out of any you don't recognise.")}
      />

      {!loaded ? (
        <SettingsSkeleton variant="list" count={3} />
      ) : devices.length === 0 ? (
        <SettingsEmptyState icon={MonitorSmartphone} title={gt("No active devices. Your sessions will appear here.")} />
      ) : (
        <>
          {current.length > 0 && (
            <SettingsSection title={gt("Current Device")}>
              <SettingsCard>{current.map(renderDevice)}</SettingsCard>
            </SettingsSection>
          )}
          {others.length > 0 && (
            <SettingsSection title={gt("Other Devices")}>
              <SettingsCard>{others.map(renderDevice)}</SettingsCard>
            </SettingsSection>
          )}
          {others.length > 0 && (
            <SettingsSection
              title={gt("Log out of all known devices")}
              description={gt("You'll have to sign in again on every device you log out of.")}
            >
              <div>
                <SettingsButton variant="danger" disabled={busyAll} onClick={() => void logOutAll()}>
                  {gt("Log out all known devices")}
                </SettingsButton>
              </div>
            </SettingsSection>
          )}
        </>
      )}

      <SettingsSection title={gt("Sign-in Security")}>
        <PasskeysSettingsRow />
      </SettingsSection>
    </div>
  );
});
