"use client";

/**
 * React side of the shared mention resolver (lib/chat/mentionResolver):
 * names come from the caller's users, the open server's members (bots
 * included), the server's channels, then the lazy per-id lookup
 * (lib/chat/mentionUserLookup). Components only subscribe to the lookup cache
 * while they have a mention nobody else can name.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useServerMembersOptional, useServerOptional } from "@/contexts/ServerContext";
import { useAuth } from "@/contexts/AuthContext";
import type { MentionNames } from "@/lib/chat/mentionText";
import {
  indexById,
  resolveMentionNames,
  resolveMentionUser,
  unresolvedMentionUserIds,
  type MentionRoleInfo,
  type MentionUserInfo,
} from "@/lib/chat/mentionResolver";
import { getMentionUserSnapshot, requestMentionUser, subscribeMentionUsers } from "@/lib/chat/mentionUserLookup";

type MemberLike = { id?: string; username?: string; displayName?: string | null; avatar?: string | null };

const EMPTY_INDEX: ReadonlyMap<string, MentionUserInfo> = new Map();
const EMPTY_LOOKUP: ReadonlyMap<string, MentionUserInfo | null> = new Map();
// One index per members array, shared by every consumer.
const memberIndexes = new WeakMap<object, ReadonlyMap<string, MentionUserInfo>>();

function memberIndex(members: MemberLike[] | undefined): ReadonlyMap<string, MentionUserInfo> {
  if (!members || members.length === 0) return EMPTY_INDEX;
  let index = memberIndexes.get(members);
  if (!index) {
    const map = new Map<string, MentionUserInfo>();
    for (const m of members) {
      if (!m?.id || map.has(m.id)) continue;
      map.set(m.id, {
        id: m.id,
        username: m.username,
        displayName: m.displayName || m.username,
        avatar: m.avatar ?? undefined,
      });
    }
    index = map;
    memberIndexes.set(members, index);
  }
  return index;
}

/** The open server's members (bots included) by id; empty outside the app shell. */
export function useMemberMentionIndex(): ReadonlyMap<string, MentionUserInfo> {
  const members = useServerMembersOptional()?.members as MemberLike[] | undefined;
  return memberIndex(members);
}

const noopUnsubscribe = () => {};

/** The lookup cache, subscribed only while `active` (otherwise a fixed empty map). */
function useLookupCache(active: boolean): ReadonlyMap<string, MentionUserInfo | null> {
  const subscribe = useCallback(
    (onChange: () => void) => (active ? subscribeMentionUsers(onChange) : noopUnsubscribe),
    [active],
  );
  const getSnapshot = useCallback(() => (active ? getMentionUserSnapshot() : EMPTY_LOOKUP), [active]);
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_LOOKUP);
}

/**
 * One mentioned user the caller couldn't name: tries the open server's
 * members, then the lazy lookup. Undefined while unknown.
 */
export function useLazyMentionUser(id: string): MentionUserInfo | undefined {
  const members = useMemberMentionIndex();
  const viewerId = useAuth().user?.id ?? null;
  const fromMembers = resolveMentionUser(id, { users: [members] });
  const needsLookup = !fromMembers;
  const lookup = useLookupCache(needsLookup);
  useEffect(() => {
    if (needsLookup) requestMentionUser(id, viewerId);
  }, [needsLookup, id, viewerId]);
  if (fromMembers) return fromMembers;
  return lookup.get(id) ?? undefined;
}

/**
 * Names for the mentions in `text` (plain-text previews: thread rows, pins,
 * the composer's reply bar), for `renderMentionText`.
 */
export function useMentionNames(
  text: string | null | undefined,
  extra?: { users?: ReadonlyArray<MentionUserInfo>; roles?: ReadonlyArray<MentionRoleInfo> },
): MentionNames {
  const members = useMemberMentionIndex();
  const channels = useServerOptional()?.channels;
  const viewerId = useAuth().user?.id ?? null;
  const extraUsers = extra?.users;
  const extraRoles = extra?.roles;
  const extraIndex = useMemo(() => indexById(extraUsers), [extraUsers]);

  const missing = useMemo(
    () => unresolvedMentionUserIds(text, { users: [extraIndex, members] }),
    [text, extraIndex, members],
  );
  const missingKey = missing.join(",");
  const lookup = useLookupCache(missing.length > 0);
  useEffect(() => {
    if (!missingKey) return;
    for (const id of missingKey.split(",")) requestMentionUser(id, viewerId);
  }, [missingKey, viewerId]);

  return useMemo(
    () =>
      resolveMentionNames(text, {
        users: [extraIndex, members],
        roles: extraRoles ?? null,
        channels: channels ?? null,
        lookupUser: (id) => lookup.get(id),
      }),
    [text, extraIndex, members, extraRoles, channels, lookup],
  );
}
