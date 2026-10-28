"use client";

import { useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { AtSign, ImageOff, Radio, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/Loader";
import { SettingsButton } from "@/components/settings/blocks/SettingsButton";
import {
  MESSAGE_TEMPLATE_MAX,
  parseTwitchLogin,
  parseYouTubeChannelInput,
  type IntegrationItem,
} from "@/lib/integrations/notifications";
import type { Role } from "./types";

type Kind = "youtube" | "twitch";
type Source = "video" | "live" | "vod" | "offline" | "sample";

interface LatestState {
  url: string | null;
  item: IntegrationItem | null;
  source: Source | null;
  error: string | null;
}

/**
 * YouTube / Twitch card body: channel + notification channel, who gets
 * pinged, an optional message, a preview of the real latest upload / stream
 * and "Send test notification" (posted like a real one, with the card's
 * unsaved values). Values live in the settings draft (bulk save).
 */
export function IntegrationNotificationSettings({
  kind,
  serverId,
  values,
  onChange,
  textChannels,
  roles,
  canMentionEveryone,
  fieldError,
  labelClass,
  inputClass,
  selectClass,
}: {
  kind: Kind;
  serverId: string;
  values: { channel: string; notifyChannelId: string; mention: string; mentionRoleId: string; message: string };
  onChange: (field: "channel" | "notifyChannelId" | "mention" | "mentionRoleId" | "message", value: string) => void;
  textChannels: { id: string; name: string }[];
  roles: Role[];
  canMentionEveryone: boolean;
  fieldError: (field: "channel" | "notifyChannelId" | "mention" | "message") => React.ReactNode;
  labelClass: string;
  inputClass: string;
  selectClass: string;
}) {
  const gt = useGT();
  const trimmed = values.channel.trim();
  const valid = trimmed ? Boolean(kind === "youtube" ? parseYouTubeChannelInput(trimmed) : parseTwitchLogin(trimmed)) : false;

  // Debounced lookup of the real latest item while the channel is typed.
  const [debounced, setDebounced] = useState(trimmed);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(trimmed), 600);
    return () => clearTimeout(t);
  }, [trimmed]);
  const latestUrl = valid && debounced === trimmed
    ? `/api/servers/${serverId}/integrations/${kind}/latest?channel=${encodeURIComponent(trimmed)}`
    : null;
  const [latest, setLatest] = useState<LatestState>({ url: null, item: null, source: null, error: null });
  useEffect(() => {
    if (!latestUrl) return;
    let active = true;
    fetch(latestUrl)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { item?: IntegrationItem; source?: Source; error?: string } | null;
        if (!active) return;
        setLatest(res.ok && body?.item
          ? { url: latestUrl, item: body.item, source: body.source ?? null, error: null }
          : { url: latestUrl, item: null, source: null, error: body?.error || "" });
      })
      .catch(() => {
        if (active) setLatest({ url: latestUrl, item: null, source: null, error: "" });
      });
    return () => {
      active = false;
    };
  }, [latestUrl]);
  const current = latest.url === latestUrl ? latest : null;
  const loadingPreview = Boolean(trimmed && valid && !current);

  const pingRoles = useMemo(
    () => roles.filter((r) => !r.isDefault).sort((a, b) => b.position - a.position),
    [roles],
  );
  const selectedRole = values.mention === "role" ? pingRoles.find((r) => r.id === values.mentionRoleId) : undefined;
  const pingValue = values.mention === "role" ? (values.mentionRoleId ? `role:${values.mentionRoleId}` : "none") : values.mention || "none";
  const setPing = (value: string) => {
    if (value.startsWith("role:")) {
      onChange("mention", "role");
      onChange("mentionRoleId", value.slice(5));
    } else {
      onChange("mention", value);
      onChange("mentionRoleId", "");
    }
  };

  const [sending, setSending] = useState(false);
  const sendTest = async () => {
    if (!values.notifyChannelId) {
      toast.error(gt("Please configure and select a notification channel first"));
      return;
    }
    if (!valid) {
      toast.error(kind === "youtube" ? gt("Enter a YouTube channel first") : gt("Enter a Twitch channel first"));
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/integrations/${kind}/mock-trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: values.notifyChannelId,
          channel: trimmed,
          mention: values.mention || "none",
          mentionRoleId: values.mentionRoleId || undefined,
          message: values.message,
        }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok) toast.success(gt("Test notification sent"));
      else toast.error(data?.error || gt("Failed to send the test notification"));
    } catch {
      toast.error(gt("Failed to send the test notification"));
    } finally {
      setSending(false);
    }
  };

  const sourceLabel = (source: Source | null) => {
    switch (source) {
      case "live": return gt("Live now");
      case "vod": return gt("Offline · latest broadcast");
      case "offline": return gt("Offline · no past broadcasts");
      case "sample": return gt("Sample (Twitch API not set up)");
      default: return gt("Latest video");
    }
  };
  const item = current?.item ?? null;
  const published = item?.publishedAt ? new Date(item.publishedAt) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>{kind === "youtube" ? gt("YOUTUBE CHANNEL") : gt("TWITCH CHANNEL")}</span>
          <Input
            type="text"
            placeholder={kind === "youtube" ? gt("e.g. @MrBeast or a channel link") : gt("e.g. shroud or twitch.tv/shroud")}
            value={values.channel}
            onChange={(e) => onChange("channel", e.target.value)}
            className={inputClass}
            maxLength={300}
            aria-invalid={Boolean(trimmed && !valid)}
          />
          {trimmed && !valid ? (
            <p className="mt-1.5 text-xs text-red-500">
              {kind === "youtube" ? gt("Enter a YouTube channel URL, @handle or channel ID") : gt("Enter a Twitch channel name or twitch.tv link")}
            </p>
          ) : fieldError("channel")}
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>{gt("NOTIFICATION CHANNEL")}</span>
          <select
            value={values.notifyChannelId}
            onChange={(e) => onChange("notifyChannelId", e.target.value)}
            className={selectClass}
            aria-label={kind === "twitch" ? gt("Twitch notification channel") : gt("YouTube notification channel")}
          >
            <option value="">{gt("Select a channel")}</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
          {fieldError("notifyChannelId")}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>{gt("PING")}</span>
          <select value={pingValue} onChange={(e) => setPing(e.target.value)} className={selectClass} aria-label={gt("Who gets pinged")}>
            <option value="none">{gt("No ping")}</option>
            <option value="everyone" disabled={!canMentionEveryone && values.mention !== "everyone"}>@everyone</option>
            <option value="here" disabled={!canMentionEveryone && values.mention !== "here"}>@here</option>
            {pingRoles.length > 0 && (
              <optgroup label={gt("Roles")}>
                {pingRoles.map((role) => {
                  const blocked = !role.mentionable && !canMentionEveryone && values.mentionRoleId !== role.id;
                  return (
                    <option key={role.id} value={`role:${role.id}`} disabled={blocked}>
                      @{role.name}{!role.mentionable ? ` (${gt("not mentionable")})` : ""}
                    </option>
                  );
                })}
              </optgroup>
            )}
          </select>
          {fieldError("mention") ?? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              {values.mention === "none" || !values.mention ? (
                gt("Nobody is pinged.")
              ) : (
                <>
                  <span>{gt("Pings")}</span>
                  <span
                    className="inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 font-medium"
                    style={{
                      color: selectedRole?.color || "var(--app-accent)",
                      backgroundColor: `color-mix(in srgb, ${selectedRole?.color || "var(--app-accent)"} 15%, transparent)`,
                    }}
                  >
                    <AtSign className="h-3 w-3 shrink-0" />
                    {values.mention === "role" ? selectedRole?.name ?? gt("Unknown role") : values.mention}
                  </span>
                  {!canMentionEveryone && <span>{gt("(you can't change this without the Mention @everyone permission)")}</span>}
                </>
              )}
            </p>
          )}
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>{gt("MESSAGE (OPTIONAL)")}</span>
          <Input
            type="text"
            placeholder={kind === "youtube"
              ? gt("{channel} just uploaded a new video!", { channel: "{channel}" })
              : gt("{channel} is now live on Twitch!", { channel: "{channel}" })}
            value={values.message}
            onChange={(e) => onChange("message", e.target.value)}
            className={inputClass}
            maxLength={MESSAGE_TEMPLATE_MAX}
          />
          {fieldError("message") ?? (
            <p className="mt-1.5 text-xs text-[var(--text-secondary)]">
              {kind === "youtube"
                ? gt("Use {channel}, {title} and {url}. The ping goes in front.", { channel: "{channel}", title: "{title}", url: "{url}" })
                : gt("Use {channel}, {title}, {game} and {url}. The ping goes in front.", { channel: "{channel}", title: "{title}", game: "{game}", url: "{url}" })}
            </p>
          )}
        </label>
      </div>

      {trimmed && valid && (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3" aria-live="polite">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">
            {kind === "youtube" ? gt("Latest upload") : gt("Latest stream")}
          </p>
          {loadingPreview ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <Loader size={14} />
              {gt("Looking up the channel...")}
            </div>
          ) : item ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex min-w-0 items-start gap-3 rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
            >
              <span className="relative block aspect-video w-28 shrink-0 overflow-hidden rounded-md bg-[var(--bg-input)] sm:w-40">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
                    <ImageOff className="h-5 w-5" />
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">{item.title}</span>
                <span className="mt-0.5 block truncate text-xs text-[var(--text-secondary)]">{item.channelName}</span>
                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1" style={current?.source === "live" ? { color: kind === "twitch" ? "#9146FF" : "#FF0000" } : undefined}>
                    {current?.source === "live" && <Radio className="h-3 w-3" />}
                    {sourceLabel(current?.source ?? null)}
                  </span>
                  {published && current?.source !== "sample" && <span>{published.toLocaleString()}</span>}
                </span>
              </span>
            </a>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">
              {current?.error || gt("Couldn't load this channel right now.")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SettingsButton variant="secondary" onClick={() => void sendTest()} disabled={sending} className="sm:self-start">
          {sending ? <Loader size={14} /> : <Send />}
          {sending ? gt("Sending...") : gt("Send test notification")}
        </SettingsButton>
        <p className="text-xs text-[var(--text-secondary)]">
          {gt("Posts the latest real item with this card's settings, including the ping. Unsaved changes are used for the test only.")}
        </p>
      </div>
    </div>
  );
}
