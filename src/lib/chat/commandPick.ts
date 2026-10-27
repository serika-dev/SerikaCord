/**
 * Whether the composer text still starts with a command the user picked from
 * the palette (`/name` or `/group sub` followed by options), so the picked
 * command runs rather than another one with the same name. Pure.
 */
export function pickedCommandStillTyped(text: string, fullName: string): boolean {
  const name = fullName.trim().toLowerCase();
  if (!name) return false;
  const typed = text.trimStart().toLowerCase();
  if (!typed.startsWith(`/${name}`)) return false;
  const next = typed.charAt(name.length + 1);
  return next === "" || /\s/.test(next);
}
