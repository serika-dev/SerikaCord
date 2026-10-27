"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Link2, Settings, Shield, Trash2, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useGT } from "gt-next";
import { ChannelUpdateError, useServer, type ChannelUpdate } from "@/contexts/ServerContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { UnsavedChangesBar, useUnsavedShake } from "@/components/ui/unsaved-changes-bar";
import { SettingsContent, SettingsNav, type SettingsNavSection } from "@/components/settings/SettingsShell";
import { SettingsPageHeader } from "@/components/settings/SettingsSection";
import { SettingsSkeleton } from "@/components/settings/blocks/SettingsSkeleton";
import {
  MobileSaveAction,
  MobileSettingsList,
  MobileSettingsScreen,
  type MobileSettingsGroup,
} from "@/components/settings/MobileSettingsShell";
import { ChannelKindIcon, ChannelOverviewPage, type ChannelFieldErrors } from "@/components/dialogs/channelSettings/ChannelOverviewPage";
import { DeleteChannelDialog } from "@/components/dialogs/channelSettings/DeleteChannelDialog";
import { useSettingsDraft, type SettingsDraft } from "@/hooks/useSettingsDraft";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useBackHandler } from "@/hooks/useBackHandler";
import { usePermissions } from "@/hooks/usePermissions";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { normalizeOverwrites, type EditableOverwrite } from "@/lib/permissions/overwriteEditor";
import {
  buildChannelPatch,
  channelCapabilities,
  channelDraftFrom,
  channelErrorField,
  channelSettingsKind,
  validateChannelDraft,
  type ChannelDraft,
  type ChannelDraftKey,
} from "@/lib/servers/channelSettings";
import { mobileSettingsBack, openMobileSection, type MobileSettingsNav } from "@/lib/settings/mobileSettingsNav";

type ChannelSettingsTab = "overview" | "permissions" | "invites" | "integrations";

const pageLoader = () => <SettingsSkeleton variant="rows" count={4} />;

// Heavy pages load on first open.
const ChannelPermissionsPanel = dynamic(
  () => import("@/components/dialogs/ChannelPermissionsPanel").then((m) => m.ChannelPermissionsPanel),
  { ssr: false, loading: pageLoader },
);
const ChannelWebhooksPanel = dynamic(
  () => import("@/components/dialogs/ChannelWebhooksPanel").then((m) => m.ChannelWebhooksPanel),
  { ssr: false, loading: () => <div className="flex justify-center py-12"><Loader size={28} /></div> },
);
const ChannelInvitesPage = dynamic(
  () => import("@/components/dialogs/channelSettings/ChannelInvitesPage").then((m) => m.ChannelInvitesPage),
  { ssr: false, loading: pageLoader },
);

interface ServerRole {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
  position?: number;
}

interface ChannelSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
}

/**
 * Channel / category / thread settings: the shared settings chrome
 * (SettingsNav + SettingsContent on desktop, MobileSettingsShell on phones)
 * over one draft of every editable field, saved with a single
 * `PATCH /api/channels/:id` that carries only what changed.
 */
export function ChannelSettingsDialog({ open, onOpenChange, channelId }: ChannelSettingsDialogProps) {
  if (!open) return null;
  // Keyed so another channel always starts from a fresh draft.
  return <ChannelSettingsBody key={channelId} channelId={channelId} onOpenChange={onOpenChange} />;
}

function ChannelSettingsBody({ channelId, onOpenChange }: { channelId: string; onOpenChange: (open: boolean) => void }) {
  const { channels, updateChannel, deleteChannel, currentServer, fetchChannels } = useServer();
  const gt = useGT();
  const confirmDialog = useConfirm();
  const isMobile = useIsMobile();
  const serverId = currentServer?.id ?? null;
  const perms = usePermissions(serverId);

  const channel = useMemo(() => channels.find((c) => c.id === channelId), [channels, channelId]);
  const kind = channelSettingsKind(channel?.type);
  const caps = channelCapabilities(channel?.type);
  const isCategory = kind === "category";
  const isThread = kind === "thread";

  // What this member may change (the routes check again). While the first
  // permissions answer loads, nothing is hidden or locked yet, so the page
  // doesn't flash a "you can't edit this" state for moderators.
  const may = (key: Parameters<typeof perms.can>[0]) => perms.loading || perms.isOwner || perms.can(key);
  const canManageChannels = may("MANAGE_CHANNELS");
  const canManageRoles = may("MANAGE_ROLES");
  const canManageServer = may("MANAGE_SERVER");
  const canCreateInvite = may("CREATE_INVITE");
  const canManageWebhooks = may("MANAGE_WEBHOOKS");

  // ── Data ─────────────────────────────────────────────────────────────────
  // The full row carries what the sidebar list doesn't (user limit, forum
  // tags / sort / layout / flags, default thread archive).
  const [fullRow, setFullRow] = useState<{ row: Record<string, unknown> | null } | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/channels/${channelId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active) setFullRow({ row: (data?.channel as Record<string, unknown> | undefined) ?? null });
      })
      .catch(() => {
        if (active) setFullRow({ row: null });
      });
    return () => {
      active = false;
    };
  }, [channelId]);

  const [roles, setRoles] = useState<ServerRole[]>([]);
  useEffect(() => {
    if (!serverId) return;
    let active = true;
    fetch(`/api/servers/${serverId}/roles`)
      .then((r) => r.json())
      .then((data) => {
        if (!active) return;
        setRoles(
          (data.roles || []).map((r: { _id?: string; id?: string; name: string; color?: string; isDefault?: boolean; position?: number }) => ({
            id: r.id || r._id || "",
            name: r.name,
            color: r.color,
            isDefault: r.isDefault,
            position: r.position,
          })),
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [serverId]);

  // The saved state: the live sidebar channel (updated by saves and refetches)
  // over the full row.
  const source = useMemo<ChannelDraft | null>(() => {
    if (!channel || !fullRow) return null;
    const row = fullRow.row ?? {};
    // Keys the list doesn't carry (or an older cached list lacks) keep the row's value.
    const live = Object.fromEntries(Object.entries(channel).filter(([, v]) => v !== undefined));
    return channelDraftFrom({ ...row, ...live, nsfw: channel.isNsfw ?? row.nsfw });
  }, [channel, fullRow]);

  // ── Draft ────────────────────────────────────────────────────────────────
  const settingsDraft = useSettingsDraft({});
  const { load: loadDraft, update: updateDraftValue, reset: resetDraft, markSaved } = settingsDraft;
  const ready = "name" in settingsDraft.baseline;
  const draft = settingsDraft.draft as unknown as ChannelDraft;
  const baseline = settingsDraft.baseline as unknown as ChannelDraft;
  const patch = useMemo(
    () => (ready ? buildChannelPatch(channel?.type, baseline, draft) : {}),
    [ready, channel?.type, baseline, draft],
  );
  const changeCount = Object.keys(patch).length;
  const dirty = changeCount > 0;

  // (Re)load the draft from the saved state whenever it changes and nothing
  // is being edited: first load, after a save, or an edit made elsewhere.
  const loadedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!source || dirty) return;
    const key = JSON.stringify(source);
    if (key === loadedKeyRef.current) return;
    loadedKeyRef.current = key;
    loadDraft(source as unknown as SettingsDraft);
  }, [source, dirty, loadDraft]);

  const [fieldErrors, setFieldErrors] = useState<ChannelFieldErrors>({});
  const update = useCallback(
    <K extends ChannelDraftKey>(key: K, value: ChannelDraft[K]) => {
      updateDraftValue(key, value);
      setFieldErrors((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [updateDraftValue],
  );

  // ── Navigation ───────────────────────────────────────────────────────────
  // The sidebar follows `navTab` at once; the page renders from the deferred
  // value so opening a heavy page never blocks the click.
  const [navTab, setNavTab] = useState<ChannelSettingsTab>("overview");
  const deferredTab = useDeferredValue(navTab);
  const [navQuery, setNavQuery] = useState("");
  const [mobileNav, setMobileNav] = useState<MobileSettingsNav<ChannelSettingsTab>>({ section: "overview", page: false, detail: null });
  const [deleteOpen, setDeleteOpen] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const handleSave = async () => {
    if (!channel || !ready || isSaving) return;
    const invalid = validateChannelDraft(channel.type, draft);
    if (invalid.name || invalid.topic) {
      const errors: ChannelFieldErrors = {};
      if (invalid.name) errors.name = gt("Channel name cannot be empty");
      if (invalid.topic) errors.topic = gt("The topic is too long");
      setFieldErrors(errors);
      toast.error(errors.name || errors.topic);
      if (navTab !== "overview") setNavTab("overview");
      return;
    }
    if (!dirty) return;
    setIsSaving(true);
    setFieldErrors({});
    try {
      const updated = await updateChannel(channel.id, patch as ChannelUpdate);
      if (updated) setFullRow({ row: updated });
      markSaved();
      toast.success(gt("Channel settings saved"));
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : gt("Failed to save settings");
      const field = channelErrorField(message, err instanceof ChannelUpdateError ? err.details : undefined);
      if (field) setFieldErrors({ [field]: message });
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    resetDraft();
    setFieldErrors({});
  };

  const navItems = useMemo(() => {
    const items: Array<{ id: ChannelSettingsTab; label: string; icon: typeof Settings; keywords?: string }> = [
      {
        id: "overview",
        label: gt("Overview"),
        icon: Settings,
        keywords: gt("name topic slowmode age-restricted nsfw category announcement tags guidelines user limit"),
      },
    ];
    if (caps.permissions && canManageRoles) {
      items.push({ id: "permissions", label: gt("Permissions"), icon: Shield, keywords: gt("private roles members access overrides sync") });
    }
    if (caps.invites && canManageServer) {
      items.push({ id: "invites", label: gt("Invites"), icon: Link2, keywords: gt("invite link code") });
    }
    if (caps.integrations && canManageWebhooks) {
      items.push({ id: "integrations", label: gt("Integrations"), icon: Webhook, keywords: gt("webhooks apps bots") });
    }
    return items;
  }, [gt, caps.permissions, caps.invites, caps.integrations, canManageRoles, canManageServer, canManageWebhooks]);

  const sectionTitle = isCategory ? gt("Category Settings") : isThread ? gt("Thread Settings") : gt("Channel Settings");
  const navSections = useMemo<SettingsNavSection<ChannelSettingsTab>[]>(
    () => [{ title: sectionTitle, items: navItems }],
    [sectionTitle, navItems],
  );
  // A page the member can't use (permissions still loading / lost) falls back to Overview.
  const activeTab: ChannelSettingsTab = navItems.some((i) => i.id === deferredTab) ? deferredTab : "overview";

  // ── Closing ──────────────────────────────────────────────────────────────
  // Leaving with unsaved changes: the first attempt shakes the save bar
  // (Discord); trying again right away asks whether to discard them.
  const [unsavedShake, shakeUnsaved] = useUnsavedShake();
  const lastShakeAtRef = useRef(0);
  const closePromptOpenRef = useRef(false);
  const requestClose = useCallback(async () => {
    if (dirty) {
      if (closePromptOpenRef.current) return;
      if (!isMobile && Date.now() - lastShakeAtRef.current > 2500) {
        lastShakeAtRef.current = Date.now();
        shakeUnsaved();
        return;
      }
      closePromptOpenRef.current = true;
      const discard = await confirmDialog({
        title: gt("You have unsaved changes. Discard them and close?"),
        confirmLabel: gt("Discard"),
      }).finally(() => {
        closePromptOpenRef.current = false;
      });
      if (!discard) return;
      resetDraft();
    }
    onOpenChange(false);
  }, [dirty, isMobile, shakeUnsaved, confirmDialog, gt, resetDraft, onOpenChange]);

  // Phone: back walks page → list → close (Android back button too).
  const handleMobileBack = () => {
    const next = mobileSettingsBack(mobileNav);
    if (next) setMobileNav(next);
    else void requestClose();
  };
  useBackHandler(isMobile, () => {
    if (deleteOpen) setDeleteOpen(false);
    else handleMobileBack();
    return true;
  });

  const handleDelete = async () => {
    if (!channel) return;
    const name = decodeHtmlEntities(channel.name);
    try {
      await deleteChannel(channel.id);
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Failed to delete channel"));
      throw err;
    }
    toast.success(
      isCategory
        ? gt("Category {name} deleted", { name })
        : isThread
          ? gt("Thread {name} deleted", { name })
          : gt("Channel #{name} deleted", { name }),
    );
    // A deleted category's channels move out of it server-side.
    if (isCategory && serverId) void fetchChannels(serverId);
    setDeleteOpen(false);
    onOpenChange(false);
  };

  if (!channel || !serverId) return null;

  // ── Pages ────────────────────────────────────────────────────────────────
  const displayName = decodeHtmlEntities(channel.name);
  const typeLabel =
    kind === "voice" ? gt("Voice Channel")
      : kind === "stage" ? gt("Stage Channel")
        : kind === "announcement" ? gt("Announcement Channel")
          : kind === "forum" ? gt("Forum Channel")
            : kind === "category" ? gt("Category")
              : kind === "thread" ? gt("Thread")
                : gt("Text Channel");
  const deleteLabel = isCategory ? gt("Delete Category") : isThread ? gt("Delete Thread") : gt("Delete Channel");
  const categories = channels
    .filter((c) => c.type === "category")
    .map((c) => ({ id: c.id, name: decodeHtmlEntities(c.name), isNsfw: c.isNsfw }));
  const parentCategory =
    caps.parent && ready && draft.parentId ? channels.find((c) => c.id === draft.parentId && c.type === "category") ?? null : null;
  const webhookChannelOptions = channels
    .filter((c) => c.type === "text" || c.type === "announcement" || c.type === "forum")
    .map((c) => ({ id: c.id, name: decodeHtmlEntities(c.name) }));

  const renderPage = (tab: ChannelSettingsTab) => {
    switch (tab) {
      case "permissions":
        return ready ? (
          <ChannelPermissionsPanel
            channel={{ id: channel.id, name: displayName, type: channel.type }}
            parent={
              parentCategory
                ? { id: parentCategory.id, name: decodeHtmlEntities(parentCategory.name), permissionOverwrites: normalizeOverwrites(parentCategory.permissionOverwrites) }
                : null
            }
            serverId={serverId}
            roles={roles}
            overwrites={draft.permissionOverwrites}
            onChange={(next: EditableOverwrite[]) => update("permissionOverwrites", next)}
            disabled={!canManageRoles}
          />
        ) : (
          pageLoader()
        );
      case "invites":
        return <ChannelInvitesPage serverId={serverId} channelId={channel.id} canCreate={canCreateInvite} />;
      case "integrations":
        return (
          <div className="space-y-6">
            <SettingsPageHeader
              title={gt("Integrations")}
              description={gt("Manage webhooks and applications integrated with this channel.")}
              className="mb-0"
            />
            <ChannelWebhooksPanel channelId={channel.id} channelOptions={webhookChannelOptions} />
          </div>
        );
      default:
        return ready ? (
          <ChannelOverviewPage
            kind={kind}
            caps={caps}
            draft={draft}
            update={update}
            fieldErrors={fieldErrors}
            categories={categories}
            roles={roles}
            canEdit={canManageChannels}
            canManageRoles={canManageRoles}
            canDelete={canManageChannels}
            onDelete={() => setDeleteOpen(true)}
          />
        ) : (
          <div className="space-y-6">
            <SettingsPageHeader title={gt("Overview")} className="mb-0" />
            {pageLoader()}
          </div>
        );
    }
  };

  const deleteDialog = (
    <DeleteChannelDialog open={deleteOpen} onOpenChange={setDeleteOpen} kind={kind} name={displayName} onConfirm={handleDelete} />
  );

  const shellClass =
    "theme-backdrop !fixed !top-0 !left-0 !translate-x-0 !translate-y-0 !max-w-none !w-screen !h-dvh !rounded-none flex gap-0 overflow-hidden border-none bg-[var(--bg-app)] p-0";

  if (isMobile) {
    const draftPage = mobileNav.section === "overview" || mobileNav.section === "permissions";
    const groups: MobileSettingsGroup<ChannelSettingsTab | "delete">[] = [
      { title: sectionTitle, items: navItems.map(({ id, label, icon }) => ({ id, label, icon })) },
    ];
    if (canManageChannels) groups.push({ items: [{ id: "delete", label: deleteLabel, icon: Trash2, destructive: true }] });
    const unsavedBar = (
      <UnsavedChangesBar
        visible={dirty}
        isSaving={isSaving}
        onSave={() => void handleSave()}
        onDiscard={handleDiscard}
        changeCount={changeCount}
        className="mt-0"
      />
    );
    const pageLabel = navItems.find((i) => i.id === mobileNav.section)?.label ?? "";
    return (
      <Dialog open onOpenChange={(next) => !next && void requestClose()}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className={shellClass}
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            handleMobileBack();
          }}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogTitle className="sr-only">{sectionTitle}</DialogTitle>
          {!mobileNav.page ? (
            <MobileSettingsScreen
              embedded
              animate={false}
              leading="close"
              onLeading={() => void requestClose()}
              title={kind === "category" || kind === "thread" || kind === "voice" || kind === "stage" ? displayName : `#${displayName}`}
              subtitle={typeLabel}
              footer={dirty ? unsavedBar : undefined}
            >
              <MobileSettingsList
                groups={groups}
                onSelect={(id) => {
                  if (id === "delete") {
                    setDeleteOpen(true);
                    return;
                  }
                  setNavTab(id);
                  setMobileNav((nav) => openMobileSection(nav, id));
                }}
              />
            </MobileSettingsScreen>
          ) : (
            <MobileSettingsScreen
              key={mobileNav.section}
              embedded
              leading="back"
              onLeading={handleMobileBack}
              title={pageLabel}
              subtitle={displayName}
              action={draftPage ? <MobileSaveAction onSave={() => void handleSave()} disabled={!dirty} saving={isSaving} /> : null}
              footer={dirty ? unsavedBar : undefined}
            >
              <div className="px-4 pb-10 pt-4">{renderPage(mobileNav.section)}</div>
            </MobileSettingsScreen>
          )}
          {deleteDialog}
        </DialogContent>
      </Dialog>
    );
  }

  const activeLabel = navItems.find((i) => i.id === activeTab)?.label ?? gt("Overview");

  return (
    <Dialog open onOpenChange={(next) => !next && void requestClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className={shellClass}
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          // Escape in the sidebar search clears it before it closes anything.
          const target = e.target as HTMLElement | null;
          if (target?.dataset?.settingsSearch !== undefined && navQuery) {
            setNavQuery("");
            return;
          }
          void requestClose();
        }}
        onInteractOutside={(e) => e.preventDefault()}
        // Don't pop the keyboard / focus the search box on open.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{gt("{type} settings for {name}", { type: typeLabel, name: displayName })}</DialogTitle>
        <SettingsNav
          sections={navSections}
          activeId={navTab}
          onSelect={setNavTab}
          query={navQuery}
          onQueryChange={setNavQuery}
          ariaLabel={sectionTitle}
          header={
            <div className="flex min-w-0 items-center gap-2.5 px-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                <ChannelKindIcon kind={kind} className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">{typeLabel}</p>
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]" title={displayName}>{displayName}</p>
              </div>
            </div>
          }
          footer={
            canManageChannels ? (
              <div className="border-t border-[var(--border-subtle)] pt-3">
                <button
                  type="button"
                  data-settings-nav-item
                  onClick={() => setDeleteOpen(true)}
                  className="settings-nav-item flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm text-red-500 hover:bg-red-500/10"
                >
                  <span className="min-w-0 flex-1 truncate">{deleteLabel}</span>
                  <Trash2 className="h-4 w-4 shrink-0" />
                </button>
              </div>
            ) : undefined
          }
        />
        <SettingsContent
          pageKey={activeTab}
          title={activeLabel}
          width={activeTab === "permissions" || activeTab === "invites" ? "wide" : "narrow"}
          onClose={() => void requestClose()}
          closeLabel={gt("Close channel settings")}
          highlightQuery={navQuery}
          footer={
            <UnsavedChangesBar
              visible={dirty}
              isSaving={isSaving}
              onSave={() => void handleSave()}
              onDiscard={handleDiscard}
              onUndo={settingsDraft.undo}
              onRedo={settingsDraft.redo}
              canUndo={settingsDraft.canUndo}
              canRedo={settingsDraft.canRedo}
              changeCount={changeCount}
              shakeSignal={unsavedShake}
              className="mt-0 max-w-none"
            />
          }
        >
          {renderPage(activeTab)}
        </SettingsContent>
        {deleteDialog}
      </DialogContent>
    </Dialog>
  );
}
