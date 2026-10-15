"use client";

/** Opens User Settings on the Account Standing tab (desktop dialog and phone layout both listen). */
export function openAccountStanding(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("openUserSettings", { detail: { tab: "account-standing" } }));
}

/** Server answer for a chat send blocked by a platform restriction. */
export function isAccountRestricted(body: unknown): body is { error?: string; code: "account_restricted"; restrictedUntil?: string } {
  return Boolean(body && typeof body === "object" && (body as { code?: unknown }).code === "account_restricted");
}
