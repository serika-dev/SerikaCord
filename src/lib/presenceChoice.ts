/**
 * The status pickers show "Invisible" as the client status `"offline"`, but
 * `"offline"` is also what the server stores for new accounts, the mobile
 * shell's background hook and older logouts, so it can't mean "the user chose
 * Invisible". The choice is therefore stored as `"invisible"` (which the API
 * accepts and resolveEffectiveStatus already shows as offline to others) and
 * mapped back to `"offline"` for the UI.
 */
export type ClientStatus = "online" | "idle" | "dnd" | "offline";

/** Status value to send to PUT /api/users/me for a picker choice. */
export function toServerStatus(status: string): string {
  return status === "offline" ? "invisible" : status;
}

/** Status as the UI models it (Invisible is shown as "offline"). */
export function toClientStatus(status: string | null | undefined): ClientStatus {
  if (status === "invisible" || status === "offline") return "offline";
  if (status === "idle" || status === "dnd") return status;
  return "online";
}

/**
 * Whether loading the app should mark the user online again. Explicit choices
 * (Do Not Disturb, Invisible) stick; idle, online and the legacy/default
 * "offline" are promoted to online.
 */
export function shouldPromoteToOnline(rawStatus: string | null | undefined): boolean {
  return rawStatus !== "dnd" && rawStatus !== "invisible";
}
