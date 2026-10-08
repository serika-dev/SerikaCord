"use client";

/**
 * Saved accounts for the account switcher. The `saved_accounts` cookie holds
 * every saved account's tokens, so it is HttpOnly: page scripts can't read or
 * write it. The server exposes a token-free list instead, and switching goes
 * through POST /api/auth/switch, which reads the tokens server-side.
 */
export interface SavedAccountSummary {
  email: string;
  username: string;
  displayName?: string;
  avatar?: string;
  savedAt: number;
  /** A token is saved for this account, so it can be switched to without a password. */
  switchable: boolean;
}

export async function fetchSavedAccounts(): Promise<SavedAccountSummary[]> {
  try {
    const res = await fetch("/api/auth/saved-accounts", { credentials: "same-origin" });
    if (!res.ok) return [];
    const data = (await res.json()) as { accounts?: SavedAccountSummary[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

export async function removeSavedAccount(email: string): Promise<SavedAccountSummary[] | null> {
  try {
    const res = await fetch("/api/auth/saved-accounts/remove", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accounts?: SavedAccountSummary[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return null;
  }
}
