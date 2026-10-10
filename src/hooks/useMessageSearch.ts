"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { isSearchable, parseSearchQuery, type SearchSort } from "@/lib/chat/searchQuery";
import {
  buildSearchRequest,
  pushSearchHistory,
  type SearchChannelOption,
  type SearchUserOption,
} from "@/lib/chat/searchClient";
import type { MessageAttachment, MessageEmbed, MessageSticker } from "@/lib/chat/types";

/** Where a search runs. One shared engine for servers, DMs and group DMs. */
export type SearchScope =
  | { kind: "server"; serverId: string }
  | { kind: "dm"; channelId: string };

export interface SearchHitAuthor {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  isBot?: boolean;
  isWebhook?: boolean;
  isDiscord?: boolean;
  isSystem?: boolean;
}

export interface SearchHit {
  id: string;
  channelId: string;
  serverId: string | null;
  authorId: string;
  author: SearchHitAuthor | null;
  content: string;
  attachments: MessageAttachment[];
  embeds: MessageEmbed[];
  sticker?: MessageSticker;
  pinned: boolean;
  edited: boolean;
  mentionedUserIds: string[];
  createdAt: string;
}

export interface SearchHitChannel {
  id: string;
  name: string;
  type: string | null;
  serverId: string | null;
  parentId: string | null;
  parentName: string | null;
  icon: string | null;
  recipientId: string | null;
  recipientNames?: string[];
}

interface SearchResponse {
  totalResults: number;
  pageableResults: number;
  indexing: boolean;
  messages: SearchHit[];
  channels: SearchHitChannel[];
  users: SearchHitAuthor[];
}

interface SearchState {
  scopeKey: string;
  open: boolean;
  /** The query that produced `results` (shown in the panel). */
  submitted: string;
  sort: SearchSort;
  page: number;
  loading: boolean;
  error: string | null;
  results: SearchResponse | null;
}

const HISTORY_KEY = "serika:search-history";

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* private mode: history is a convenience */
  }
}

function scopeKeyOf(scope: SearchScope | null): string {
  if (!scope) return "";
  return scope.kind === "server" ? `server:${scope.serverId}` : `dm:${scope.channelId}`;
}

function endpointFor(scope: SearchScope): { url: string; extra: Record<string, string> } {
  if (scope.kind === "server") return { url: `/api/servers/${scope.serverId}/messages/search`, extra: {} };
  return { url: "/api/dms/search", extra: { channelId: scope.channelId } };
}

/**
 * Discord-style message search state: the search bar draft, submitted query,
 * sort, page, results and recent-search history. Shared by ChatArea (server
 * search), the DM page and the group DM page. Fetches happen in event
 * handlers (never in effects); switching scope resets the panel by key.
 */
export function useMessageSearch(opts: {
  scope: SearchScope | null;
  users: readonly SearchUserOption[];
  channels?: readonly SearchChannelOption[];
}) {
  const { scope, users, channels } = opts;
  const scopeKey = scopeKeyOf(scope);
  const initial = useMemo<SearchState>(() => ({
    scopeKey,
    open: false,
    submitted: "",
    sort: "newest",
    page: 0,
    loading: false,
    error: null,
    results: null,
  }), [scopeKey]);
  const [stored, setState] = useState<SearchState>(initial);
  const state = stored.scopeKey === scopeKey ? stored : initial;
  const [draftState, setDraftState] = useState<{ scopeKey: string; value: string }>({ scopeKey, value: "" });
  const draft = draftState.scopeKey === scopeKey ? draftState.value : "";
  const [history, setHistory] = useState<string[]>(() => (typeof window === "undefined" ? [] : readHistory()));
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const setDraft = useCallback((value: string) => setDraftState({ scopeKey, value }), [scopeKey]);

  const run = useCallback(async (raw: string, sort: SearchSort, page: number) => {
    if (!scope) return;
    const parsed = parseSearchQuery(raw);
    if (!isSearchable(parsed)) return;
    const { params, impossible } = buildSearchRequest(parsed, {
      users,
      channels,
      sort,
      page,
      tzOffsetMinutes: new Date().getTimezoneOffset(),
    });
    const id = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((prev) => ({
      ...(prev.scopeKey === scopeKey ? prev : initial),
      open: true,
      submitted: raw,
      sort,
      page,
      loading: !impossible,
      error: null,
      results: impossible
        ? { totalResults: 0, pageableResults: 0, indexing: false, messages: [], channels: [], users: [] }
        : prev.scopeKey === scopeKey ? prev.results : null,
    }));
    if (impossible) return;
    const { url, extra } = endpointFor(scope);
    const qs = new URLSearchParams({ ...extra, ...params });
    try {
      const res = await fetch(`${url}?${qs.toString()}`, { signal: controller.signal, credentials: "include" });
      const data = (await res.json().catch(() => null)) as (SearchResponse & { error?: string }) | null;
      if (id !== requestRef.current) return;
      if (!res.ok || !data) {
        setState((prev) => ({ ...prev, loading: false, error: data?.error || "error" }));
        return;
      }
      setState((prev) => ({ ...prev, loading: false, error: null, results: data }));
    } catch (err) {
      if ((err as Error)?.name === "AbortError" || id !== requestRef.current) return;
      setState((prev) => ({ ...prev, loading: false, error: "error" }));
    }
  }, [scope, scopeKey, users, channels, initial]);

  /** Run the search bar's current text (Enter). */
  const submit = useCallback((raw?: string) => {
    const value = (raw ?? draft).trim();
    if (!value || !isSearchable(parseSearchQuery(value))) return false;
    const next = pushSearchHistory(history, value);
    setHistory(next);
    writeHistory(next);
    void run(value, state.sort, 0);
    return true;
  }, [draft, history, run, state.sort]);

  const setSort = useCallback((sort: SearchSort) => {
    if (!state.submitted) return;
    void run(state.submitted, sort, 0);
  }, [run, state.submitted]);

  const goToPage = useCallback((page: number) => {
    if (!state.submitted) return;
    void run(state.submitted, state.sort, page);
  }, [run, state.submitted, state.sort]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    requestRef.current++;
    setState((prev) => ({ ...(prev.scopeKey === scopeKey ? prev : initial), open: false, loading: false }));
  }, [scopeKey, initial]);

  /** Close the panel and clear the bar (Escape / the clear button). */
  const clear = useCallback(() => {
    close();
    setDraft("");
  }, [close, setDraft]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    writeHistory([]);
  }, []);

  return {
    enabled: Boolean(scope),
    scope,
    draft,
    setDraft,
    open: state.open,
    submitted: state.submitted,
    sort: state.sort,
    page: state.page,
    loading: state.loading,
    error: state.error,
    results: state.results,
    history,
    submit,
    setSort,
    goToPage,
    close,
    clear,
    clearHistory,
    users,
    channels,
  };
}

export type MessageSearchController = ReturnType<typeof useMessageSearch>;
