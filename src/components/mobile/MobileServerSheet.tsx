"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { Bell, BellOff, CheckCheck, Copy, FolderPlus, LogOut, Plus, Settings, UserPlus, Users } from "lucide-react";
import { useServer } from "@/contexts/ServerContext";
import { useUnread } from "@/contexts/UnreadContext";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useServerMutes } from "@/hooks/useServerMutes";
import { useMuteOptions, useMutedUntilLabel } from "@/components/notifications/useMuteOptions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { openNotificationSettings } from "@/lib/notifications/events";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cdnImage } from "@/lib/utils";
import { MobileSheet, SheetGroup, SheetRow } from "./MobileSheet";

type SheetServer = {
  id: string;
  name: string;
  icon?: string | null;
  banner?: string | null;
  ownerId?: string;
  isOwner?: boolean;
  memberCount?: number;
  onlineCount?: number;
  description?: string;
};

/** Ask the channels layout to open a dialog (it owns them). */
function emit(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/**
 * Discord's server sheet (tap the server name or long-press its icon): banner,
 * counts, Invite / Notifications / Settings, then Mark As Read, Mute, Create
 * Channel, Copy ID and Leave Server.
 */
export function MobileServerSheet({ server, onClose }: { server: SheetServer; onClose: () => void }) {
  const gt = useGT();
  const router = useRouter();
  const { user } = useAuth();
  const { currentServer, leaveServer, setCurrentServer, setCurrentChannel } = useServer();
  const { markServerRead, isServerUnread } = useUnread();
  const { isMuted, muteUntilOf, muteServer, unmuteServer } = useServerMutes();
  const muteOptions = useMuteOptions();
  const mutedLabel = useMutedUntilLabel();
  const confirm = useConfirm();
  const { can, isAdmin } = usePermissions(server.id);
  const [showMute, setShowMute] = useState(false);

  const muted = isMuted(server.id);
  const isOwner = server.isOwner === true || (!!user?.id && server.ownerId === user.id);
  const canManageServer = isAdmin || can("MANAGE_SERVER");
  const canManageChannels = isAdmin || can("MANAGE_CHANNELS");
  const isCurrent = currentServer?.id === server.id;

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  const quick = [
    { key: "invite", icon: UserPlus, label: gt("Invite"), onClick: run(() => emit("openInviteDialog", { serverId: server.id })) },
    {
      key: "notifications",
      icon: muted ? BellOff : Bell,
      label: gt("Notifications"),
      onClick: run(() => openNotificationSettings({ scope: "server", id: server.id, name: server.name })),
    },
    ...(canManageServer && isCurrent
      ? [{ key: "settings", icon: Settings, label: gt("Settings"), onClick: run(() => emit("openServerSettings")) }]
      : []),
  ];

  const header = (
    <div className="px-4 pb-3">
      {server.banner ? (
        <div
          className="mb-3 h-24 rounded-xl bg-cover bg-center"
          style={{ backgroundImage: `url(${cdnImage(server.banner)})` }}
        />
      ) : null}
      <div className="flex items-center gap-3">
        <Avatar className="h-14 w-14 rounded-2xl">
          <AvatarImage src={cdnImage(server.icon || undefined)} className="object-cover" />
          <AvatarFallback className="rounded-2xl bg-[var(--app-accent)] text-xl font-semibold text-[var(--text-on-accent)]">
            {server.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-[var(--text-primary)]">{server.name}</h2>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--text-muted)]">
            {typeof server.onlineCount === "number" && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-[var(--status-online)]" />
                {gt("{count} Online", { count: server.onlineCount })}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {gt("{count} Members", { count: server.memberCount ?? 0 })}
            </span>
          </div>
        </div>
      </div>
      {server.description ? (
        <p className="mt-2 line-clamp-3 text-sm text-[var(--text-secondary)]">{server.description}</p>
      ) : null}
    </div>
  );

  return (
    <MobileSheet label={server.name} header={header} onClose={onClose}>
      <div className="mb-3 flex justify-around px-3">
        {quick.map(({ key, icon: Icon, label, onClick }) => (
          <button
            key={key}
            type="button"
            onClick={onClick}
            className="flex w-20 touch-manipulation flex-col items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] active:scale-95"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-card)] text-[var(--text-primary)]">
              <Icon className="h-5 w-5" />
            </span>
            {label}
          </button>
        ))}
      </div>

      <SheetGroup>
        {isServerUnread(server.id) && (
          <SheetRow icon={CheckCheck} label={gt("Mark As Read")} onClick={run(() => markServerRead(server.id))} />
        )}
        {muted ? (
          <SheetRow
            icon={Bell}
            label={gt("Unmute Server")}
            onClick={run(() => unmuteServer(server.id))}
            trailing={<span className="shrink-0 text-xs text-[var(--text-muted)]">{mutedLabel(muteUntilOf(server.id))}</span>}
          />
        ) : (
          <SheetRow icon={BellOff} label={gt("Mute Server")} onClick={() => setShowMute((v) => !v)} />
        )}
        {showMute &&
          !muted &&
          muteOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={run(() => muteServer(server.id, o.minutes))}
              className="flex h-11 w-full touch-manipulation items-center pl-12 pr-4 text-left text-sm text-[var(--text-secondary)] active:bg-[var(--bg-hover)]"
            >
              {o.label}
            </button>
          ))}
      </SheetGroup>

      {canManageChannels && isCurrent && (
        <SheetGroup>
          <SheetRow icon={Plus} label={gt("Create Channel")} onClick={run(() => emit("openCreateChannel", { type: "text" }))} />
          <SheetRow icon={FolderPlus} label={gt("Create Category")} onClick={run(() => emit("openCreateChannel", { type: "category" }))} />
        </SheetGroup>
      )}

      <SheetGroup>
        <SheetRow
          icon={Copy}
          label={gt("Copy Server ID")}
          onClick={run(() => {
            void navigator.clipboard?.writeText(server.id);
            toast.success(gt("Server ID copied"));
          })}
        />
        {!isOwner && (
          <SheetRow
            icon={LogOut}
            label={gt("Leave Server")}
            danger
            onClick={run(async () => {
              const ok = await confirm({
                title: gt("Leave Server"),
                description: gt("Leave '{name}'? You'll need a new invite to rejoin.", { name: server.name }),
                confirmLabel: gt("Leave Server"),
              });
              if (!ok) return;
              try {
                await leaveServer(server.id);
                if (isCurrent) {
                  setCurrentChannel(null);
                  setCurrentServer(null);
                  router.push("/channels/me");
                }
              } catch {
                /* leaveServer surfaces its own errors */
              }
            })}
          />
        )}
      </SheetGroup>
    </MobileSheet>
  );
}
