// Recovery passphrase strength (client-side only: the server never sees the
// passphrase, it only stores the sealed backup and could attack it offline).
// The score is length + character variety, but common passwords, keyboard
// runs, sequences and repeats are always weak whatever their length.
import { MIN_PASSPHRASE_LENGTH } from "./constants";

/** 0 too short, 1 weak, 2 okay, 3 good, 4 strong. */
export type PassphraseStrength = 0 | 1 | 2 | 3 | 4;

/** The minimum a recovery passphrase must reach ("Good"). */
export const MIN_RECOVERY_PASSPHRASE_STRENGTH: PassphraseStrength = 3;

/** Small blocklist of the most common passwords / bases (lower-case, letters only where it matters). */
const COMMON = [
  "password", "passphrase", "passwort", "motdepasse", "contrasena", "qwertyuiop", "qwerty", "azerty", "qwertz",
  "asdfghjkl", "asdfgh", "zxcvbnm", "letmein", "welcome", "iloveyou", "admin", "administrator", "login", "master",
  "dragon", "monkey", "football", "baseball", "soccer", "sunshine", "princess", "shadow", "superman", "batman",
  "trustno", "changeme", "secret", "recovery", "encryption", "serikacord", "serika", "discord", "hello", "abc",
  "default", "access", "starwars", "pokemon", "minecraft", "whatever", "freedom", "charlie", "michael", "jordan",
];
// Longest first, so "qwertyuiop" is removed before "qwerty".
const COMMON_SORTED = [...COMMON].sort((a, b) => b.length - a.length);

/** Mostly consecutive characters ("abcdefgh", "12345678", "98765432"). */
function isMostlySequential(v: string): boolean {
  if (v.length < 2) return false;
  let steps = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v.charCodeAt(i) - v.charCodeAt(i - 1);
    if (d === 1 || d === -1 || d === 0) steps++;
  }
  return steps / (v.length - 1) >= 0.7;
}

/** What is left of a passphrase once common words, digits and symbols are removed. */
function distinctiveLetters(v: string): string {
  let rest = v.toLowerCase();
  for (const word of COMMON_SORTED) rest = rest.split(word).join(" ");
  return rest.replace(/[^\p{L}]/gu, "");
}

export function passphraseStrength(value: string): PassphraseStrength {
  const v = (value ?? "").normalize("NFKC").trim();
  if (v.length < MIN_PASSPHRASE_LENGTH) return 0;
  if (new Set(v.toLowerCase()).size < 6) return 1;
  if (isMostlySequential(v.toLowerCase())) return 1;
  if (distinctiveLetters(v).length < 6) return 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9\s]/, /\s/].filter((re) => re.test(v)).length;
  let score = 1;
  if (v.length >= 14) score++;
  if (v.length >= 20) score++;
  if (classes >= 3) score++;
  return Math.min(4, score) as PassphraseStrength;
}

/** Whether a new recovery passphrase is strong enough to seal the key backup with. */
export function isStrongRecoveryPassphrase(value: string): boolean {
  return passphraseStrength(value) >= MIN_RECOVERY_PASSPHRASE_STRENGTH;
}
