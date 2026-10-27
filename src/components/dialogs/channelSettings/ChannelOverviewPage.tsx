"use client";

import type { ReactNode } from "react";
import { Folder, Hash, Info, LayoutGrid, List, MessagesSquare, Ticket, Volume2, Megaphone, Radio, Clock, CalendarPlus } from "lucide-react";
import { useGT } from "gt-next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SettingsCard,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsToggleRow,
} from "@/components/settings/SettingsSection";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import { SettingsDangerZone } from "@/components/settings/blocks/SettingsDangerZone";
import { SettingsRadioCards } from "@/components/settings/blocks/SettingsRadioCards";
import { CHANNEL_NAME_MAX } from "@/lib/servers/channelRules";
import {
  MAX_TOPIC_LENGTH,
  SLOWMODE_STEPS,
  THREAD_ARCHIVE_OPTIONS,
  USER_LIMIT_MAX,
  slowmodeStepIndex,
  splitDuration,
  type ChannelCapabilities,
  type ChannelDraft,
  type ChannelDraftKey,
  type ChannelSettingsKind,
  type ForumLayout,
  type ForumSortOrder,
} from "@/lib/servers/channelSettings";
import { MarkdownField } from "./MarkdownField";
import { StepSlider } from "./StepSlider";
import { ForumTagsEditor } from "./ForumTagsEditor";

export interface OverviewRole {
  id: string;
  name: string;
  color?: string;
  isDefault?: boolean;
}

export type ChannelFieldErrors = Partial<Record<ChannelDraftKey, string>>;

const selectClass =
  "h-10 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--app-accent)] disabled:cursor-not-allowed disabled:opacity-60 max-md:text-base";

export function ChannelKindIcon({ kind, className }: { kind: ChannelSettingsKind; className?: string }) {
  const Icon =
    kind === "voice" ? Volume2
      : kind === "stage" ? Radio
        : kind === "category" ? Folder
          : kind === "announcement" ? Megaphone
            : kind === "forum" ? MessagesSquare
              : kind === "thread" ? MessagesSquare
                : Hash;
  return <Icon className={className} />;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p role="alert" className="mt-1.5 text-xs text-red-500">{message}</p>;
}

/**
 * Channel Settings → Overview. Shows only what the channel kind supports
 * (see channelCapabilities); every edit goes into the dialog's single draft.
 */
export function ChannelOverviewPage({
  kind,
  caps,
  draft,
  update,
  fieldErrors,
  categories,
  roles,
  canEdit,
  canManageRoles,
  canDelete,
  onDelete,
}: {
  kind: ChannelSettingsKind;
  caps: ChannelCapabilities;
  draft: ChannelDraft;
  update: <K extends ChannelDraftKey>(key: K, value: ChannelDraft[K]) => void;
  fieldErrors: ChannelFieldErrors;
  categories: ReadonlyArray<{ id: string; name: string; isNsfw?: boolean }>;
  roles: readonly OverviewRole[];
  canEdit: boolean;
  canManageRoles: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const gt = useGT();
  const disabled = !canEdit;
  const isCategory = kind === "category";
  const isThread = kind === "thread";
  const isForum = kind === "forum";
  const parentIsNsfw = caps.parent && !!draft.parentId && !!categories.find((c) => c.id === draft.parentId)?.isNsfw;

  const durationLabel = (seconds: number) => {
    if (seconds <= 0) return gt("Off");
    const { amount, unit } = splitDuration(seconds);
    if (unit === "h") return gt("{count}h", { count: amount });
    if (unit === "m") return gt("{count}m", { count: amount });
    return gt("{count}s", { count: amount });
  };
  const archiveLabel = (minutes: number) => {
    switch (minutes) {
      case 60: return gt("1 Hour");
      case 1440: return gt("24 Hours");
      case 4320: return gt("3 Days");
      default: return gt("1 Week");
    }
  };

  const slowIndex = slowmodeStepIndex(draft.rateLimitPerUser);
  const slowTicks = SLOWMODE_STEPS.map((s, i) => ({ at: i, label: durationLabel(s), minor: i % 2 === 1 }));
  const limitTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99].map((n, i) => ({
    at: n,
    label: n === 0 ? "∞" : String(n),
    minor: i % 2 === 1,
  }));
  const supportRoles = roles.filter((r) => !r.isDefault);

  const nameLabel = isCategory ? gt("Category Name") : isThread ? gt("Thread Name") : gt("Channel Name");

  const section = (title: ReactNode, description: ReactNode | undefined, body: ReactNode) => (
    <SettingsSection title={title} description={description}>
      {body}
    </SettingsSection>
  );

  return (
    <div className="space-y-8">
      <SettingsPageHeader
        title={gt("Overview")}
        description={
          isCategory
            ? gt("Categories group channels together. Channels synced with a category share its permissions.")
            : isThread
              ? gt("Rename this thread, slow it down or change when it hides itself.")
              : gt("Name your channel, tell people what it's for and set how it behaves.")
        }
        className="mb-0"
      />

      {!canEdit && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 text-[13px] text-[var(--text-secondary)]">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          {gt("You need the Manage Channels permission to change these settings.")}
        </div>
      )}

      {/* Name + category */}
      <SettingsCard>
        <div data-settings-row className="px-4 py-3.5">
          <label htmlFor="channel-settings-name" className="text-sm font-medium text-[var(--text-primary)]" data-settings-label={nameLabel}>
            {nameLabel}
          </label>
          <div className="relative mt-2">
            <ChannelKindIcon kind={kind} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input
              id="channel-settings-name"
              value={draft.name}
              onChange={(e) => update("name", e.target.value)}
              maxLength={CHANNEL_NAME_MAX}
              disabled={disabled}
              aria-invalid={Boolean(fieldErrors.name) || undefined}
              className={cn(
                "h-10 border-[var(--border-subtle)] bg-[var(--bg-input)] pl-9 text-[var(--text-primary)] max-md:text-base",
                fieldErrors.name && "border-red-500 focus-visible:ring-red-500",
              )}
            />
          </div>
          <FieldError message={fieldErrors.name} />
        </div>
        {caps.parent && (
          <SettingsRow
            label={gt("Category")}
            description={gt("Moving a channel keeps its own permissions.")}
            stackOnMobile
            control={
              <select
                value={draft.parentId ?? ""}
                onChange={(e) => update("parentId", e.target.value || null)}
                disabled={disabled}
                aria-label={gt("Category")}
                className={cn(selectClass, "sm:w-56")}
              >
                <option value="">{gt("No Category")}</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            }
          >
            {fieldErrors.parentId ? <FieldError message={fieldErrors.parentId} /> : null}
          </SettingsRow>
        )}
      </SettingsCard>

      {caps.topic && section(
        isForum ? gt("Post Guidelines") : gt("Channel Topic"),
        isForum
          ? gt("Shown when someone writes a new post. Markdown works here.")
          : gt("Shown in the channel header. Markdown works here."),
        <div>
          <MarkdownField
            value={draft.topic}
            onChange={(v) => update("topic", v)}
            maxLength={MAX_TOPIC_LENGTH}
            rows={isForum ? 6 : 3}
            disabled={disabled}
            invalid={Boolean(fieldErrors.topic)}
            ariaLabel={isForum ? gt("Post Guidelines") : gt("Channel Topic")}
            placeholder={
              isForum
                ? gt("Tell people what belongs in this forum and how to write a good post")
                : gt("Let everyone know how to use this channel!")
            }
          />
          <FieldError message={fieldErrors.topic} />
        </div>,
      )}

      {isForum && (
        <>
          {section(
            gt("Tags"),
            gt("Help people organise their posts into subcategories. Click a tag to edit or delete it."),
            <SettingsCard>
              <div className="px-4 py-3.5">
                <ForumTagsEditor tags={draft.availableTags} onChange={(tags) => update("availableTags", tags)} disabled={disabled} />
                <FieldError message={fieldErrors.availableTags} />
              </div>
              <SettingsToggleRow
                label={gt("Require people to select tags when posting")}
                description={draft.availableTags.length === 0 ? gt("Create a tag first.") : undefined}
                checked={draft.requireTag}
                onCheckedChange={(v) => update("requireTag", v)}
                disabled={disabled || (draft.availableTags.length === 0 && !draft.requireTag)}
              />
            </SettingsCard>,
          )}

          {section(
            gt("Forum Type"),
            gt("Posts are public discussions. Tickets are private: each is only visible to its creator and the support roles you choose."),
            <div className="space-y-3">
              <SettingsRadioCards<"posts" | "tickets">
                layout="tiles"
                className="sm:grid-cols-2"
                ariaLabel={gt("Forum Type")}
                value={draft.forumMode}
                onChange={(v) => update("forumMode", v)}
                disabled={disabled}
                options={[
                  { value: "posts", label: gt("Posts"), description: gt("Everyone can read and reply"), icon: MessagesSquare },
                  { value: "tickets", label: gt("Tickets"), description: gt("Private support conversations"), icon: Ticket },
                ]}
              />
              {draft.forumMode === "tickets" && (
                <SettingsCard>
                  <SettingsRow
                    label={gt("Support Roles")}
                    description={
                      canManageRoles
                        ? gt("Members with these roles can see and respond to every ticket.")
                        : gt("You need the Manage Roles permission to change support roles.")
                    }
                  >
                    <div className="flex flex-wrap gap-2">
                      {supportRoles.map((r) => {
                        const on = draft.ticketAccessRoleIds.some((id) => id.toLowerCase() === r.id.toLowerCase());
                        return (
                          <button
                            key={r.id}
                            type="button"
                            aria-pressed={on}
                            disabled={disabled || !canManageRoles}
                            onClick={() =>
                              update(
                                "ticketAccessRoleIds",
                                on
                                  ? draft.ticketAccessRoleIds.filter((id) => id.toLowerCase() !== r.id.toLowerCase())
                                  : [...draft.ticketAccessRoleIds, r.id],
                              )
                            }
                            className={cn(
                              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-60",
                              on
                                ? "border-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)] text-[var(--text-primary)]"
                                : "border-[var(--border-subtle)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]",
                            )}
                          >
                            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: r.color || "var(--text-muted)" }} />
                            {r.name}
                          </button>
                        );
                      })}
                      {supportRoles.length === 0 && (
                        <span className="text-xs text-[var(--text-muted)]">{gt("No roles yet — create roles in Server Settings.")}</span>
                      )}
                    </div>
                  </SettingsRow>
                </SettingsCard>
              )}
            </div>,
          )}

          {section(
            gt("Default Sort Order"),
            gt("How posts are sorted when someone opens the forum. People can still change it for themselves."),
            <SettingsRadioCards<ForumSortOrder>
              ariaLabel={gt("Default Sort Order")}
              value={draft.defaultSortOrder}
              onChange={(v) => update("defaultSortOrder", v)}
              disabled={disabled}
              options={[
                { value: "latest_activity", label: gt("Recent Activity"), description: gt("Posts with the newest messages first") },
                { value: "creation_date", label: gt("Creation Time"), description: gt("Newest posts first") },
              ]}
            />,
          )}

          {section(
            gt("Default Layout"),
            gt("How posts are shown when someone opens the forum."),
            <SettingsRadioCards<ForumLayout>
              layout="tiles"
              className="sm:grid-cols-2"
              ariaLabel={gt("Default Layout")}
              value={draft.defaultForumLayout}
              onChange={(v) => update("defaultForumLayout", v)}
              disabled={disabled}
              options={[
                { value: "list_view", label: gt("List"), icon: List },
                { value: "gallery_view", label: gt("Gallery"), icon: LayoutGrid },
              ]}
            />,
          )}
        </>
      )}

      {caps.slowmode && section(
        gt("Slowmode"),
        undefined,
        <SettingsCard>
          <div data-settings-row className="px-4 py-4">
            <StepSlider
              value={slowIndex}
              max={SLOWMODE_STEPS.length - 1}
              onChange={(i) => update("rateLimitPerUser", SLOWMODE_STEPS[i] ?? 0)}
              ticks={slowTicks}
              valueLabel={durationLabel(SLOWMODE_STEPS[slowIndex])}
              ariaLabel={gt("Slowmode")}
              disabled={disabled}
            />
            <p className="mt-3 text-[13px] leading-snug text-[var(--text-secondary)]">
              {isForum
                ? gt("Members can create one post per this interval, unless they have Manage Channel or Manage Messages.")
                : gt("Members will be restricted to sending one message per slowmode interval unless they have Manage Messages or Manage Channel overrides.")}
            </p>
            <FieldError message={fieldErrors.rateLimitPerUser} />
          </div>
        </SettingsCard>,
      )}

      {caps.userLimit && section(
        gt("User Limit"),
        undefined,
        <SettingsCard>
          <div data-settings-row className="px-4 py-4">
            <StepSlider
              value={draft.userLimit}
              max={USER_LIMIT_MAX}
              onChange={(n) => update("userLimit", n)}
              ticks={limitTicks}
              valueLabel={draft.userLimit === 0 ? gt("No limit") : gt("{count} users", { count: draft.userLimit })}
              ariaLabel={gt("User Limit")}
              disabled={disabled}
            />
            <p className="mt-3 text-[13px] leading-snug text-[var(--text-secondary)]">
              {gt("Limits how many people can be in this voice channel at once. Moderators can still move people in.")}
            </p>
            <FieldError message={fieldErrors.userLimit} />
          </div>
        </SettingsCard>,
      )}

      {(caps.nsfw || caps.announcementToggle || caps.defaultThreadArchive || caps.threadArchive) && (
        <SettingsCard>
          {caps.nsfw && (
            <SettingsToggleRow
              label={isCategory ? gt("Age-Restricted Category") : gt("Age-Restricted Channel")}
              description={
                isCategory
                  ? gt("Every channel in this category, including new ones and ones moved into it, will be age-restricted. Turning this off keeps the channels age-restricted until you change them one by one.")
                  : parentIsNsfw
                    ? gt("This channel's category is age-restricted, so this channel is too. Move it out of the category to change this.")
                    : gt("Users must verify their age to view content in this channel. This channel will be marked with an age-restricted badge in lists.")
              }
              checked={draft.nsfw || parentIsNsfw}
              onCheckedChange={(v) => update("nsfw", v)}
              disabled={disabled || parentIsNsfw}
            >
              {fieldErrors.nsfw ? <FieldError message={fieldErrors.nsfw} /> : null}
            </SettingsToggleRow>
          )}
          {caps.announcementToggle && (
            <SettingsToggleRow
              label={gt("Announcement Channel")}
              description={gt("Members can publish messages from this channel, and other servers can follow it to get them in their own channels.")}
              checked={draft.announcement}
              onCheckedChange={(v) => update("announcement", v)}
              disabled={disabled}
            />
          )}
          {caps.defaultThreadArchive && (
            <SettingsRow
              icon={Clock}
              label={gt("Hide After Inactivity")}
              description={gt("New threads in this channel will be hidden from the channel list after this period of inactivity.")}
              stackOnMobile
              control={
                <select
                  value={draft.defaultAutoArchiveDuration}
                  onChange={(e) => update("defaultAutoArchiveDuration", Number(e.target.value))}
                  disabled={disabled}
                  aria-label={gt("Hide After Inactivity")}
                  className={cn(selectClass, "sm:w-40")}
                >
                  {THREAD_ARCHIVE_OPTIONS.map((m) => (
                    <option key={m} value={m}>{archiveLabel(m)}</option>
                  ))}
                </select>
              }
            />
          )}
          {caps.threadArchive && (
            <SettingsRow
              icon={CalendarPlus}
              label={gt("Hide After Inactivity")}
              description={gt("This thread hides from the channel list after this long without new messages.")}
              stackOnMobile
              control={
                <select
                  value={draft.autoArchiveDuration}
                  onChange={(e) => update("autoArchiveDuration", Number(e.target.value))}
                  disabled={disabled}
                  aria-label={gt("Hide After Inactivity")}
                  className={cn(selectClass, "sm:w-40")}
                >
                  {THREAD_ARCHIVE_OPTIONS.map((m) => (
                    <option key={m} value={m}>{archiveLabel(m)}</option>
                  ))}
                </select>
              }
            />
          )}
        </SettingsCard>
      )}

      {canDelete && (
        <SettingsDangerZone
          title={isCategory ? gt("Delete Category") : isThread ? gt("Delete Thread") : gt("Delete Channel")}
          description={
            isCategory
              ? gt("Remove this category. Its channels stay and move out of the category.")
              : gt("Permanently remove this channel and all its content.")
          }
          action={
            <SettingsButton variant="danger" onClick={onDelete}>
              {isCategory ? gt("Delete Category") : isThread ? gt("Delete Thread") : gt("Delete Channel")}
            </SettingsButton>
          }
        />
      )}
    </div>
  );
}
