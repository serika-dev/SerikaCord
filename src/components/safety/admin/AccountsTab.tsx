"use client";

import { useId, useState } from "react";
import { useGT } from "gt-next";
import { Search, UserSearch } from "lucide-react";
import { Loader } from "@/components/ui/Loader";
import { cn } from "@/lib/utils";
import { useJsonQuery } from "../useJsonQuery";
import type { SafetyUserCard } from "../standingShared";
import { EmptyState, UserChip, cardClass, inputClass, primaryBtn, type OpenUser } from "./shared";

export function AccountsTab({ onOpenUser }: { onOpenUser: OpenUser }) {
  const gt = useGT();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const { data, error, loading } = useJsonQuery<{ users: SafetyUserCard[] }>(
    query.length >= 2 ? `/api/admin/trust-safety/users?q=${encodeURIComponent(query)}` : null
  );
  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(draft.trim());
        }}
      >
        <label htmlFor={inputId} className="sr-only">{gt("Username or user ID")}</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden />
          <input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 100))}
            placeholder={gt("Exact username or user ID")}
            autoComplete="off"
            spellCheck={false}
            className={cn(inputClass, "pl-9")}
          />
        </div>
        <button type="submit" disabled={draft.trim().length < 2} className={primaryBtn}>
          {loading ? <Loader size={14} /> : null}
          {gt("Search")}
        </button>
      </form>

      {!query ? (
        <EmptyState icon={<UserSearch className="h-8 w-8" />} title={gt("Look up an account")}>
          {gt("Search by exact username or paste a user ID to see the account's standing, incidents and actions.")}
        </EmptyState>
      ) : query.length < 2 ? null : error && !loading ? (
        <EmptyState icon={<UserSearch className="h-8 w-8" />} title={gt("Search failed")}>{error}</EmptyState>
      ) : loading && !data ? (
        <div className="flex justify-center py-8"><Loader size={24} /></div>
      ) : users.length === 0 ? (
        <EmptyState icon={<UserSearch className="h-8 w-8" />} title={gt("No account found")}>
          {gt("Usernames must match exactly. Try the user ID instead.")}
        </EmptyState>
      ) : (
        <ul className={cn(cardClass, "divide-y divide-[var(--border-subtle)]", loading && "opacity-60")}>
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <UserChip user={u} userId={u.id} onOpen={onOpenUser} />
              <button
                type="button"
                onClick={() => onOpenUser(u.id)}
                className="shrink-0 text-sm font-medium text-[var(--app-accent)] hover:underline"
              >
                {gt("Open")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
