// Safety numbers: 60 digits (12 groups of 5) two people compare to make sure
// they hold each other's real identity keys. Each person contributes 30 digits
// from an iterated SHA-256 over their identity key and user id (5200 rounds
// make brute-forcing a colliding key expensive); the halves are ordered by user
// id so both sides see the same number.
import { LABELS, SAFETY_NUMBER_ITERATIONS } from "./constants";
import { concat, frame, type Bytes } from "./encoding";
import { publicKeyBytes } from "./keys";

export interface SafetyParty {
  userId: string;
  identityPub: string;
}

async function fingerprintDigits(party: SafetyParty): Promise<string[]> {
  const pub = publicKeyBytes(party.identityPub);
  let hash: Bytes = frame(LABELS.safety, party.userId.toLowerCase(), pub);
  for (let i = 0; i < SAFETY_NUMBER_ITERATIONS; i++) {
    hash = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", concat(hash, pub)));
  }
  const groups: string[] = [];
  for (let g = 0; g < 6; g++) {
    // 5 bytes → 40-bit integer → 5 decimal digits.
    let n = 0;
    for (let b = 0; b < 5; b++) n = n * 256 + hash[g * 5 + b];
    groups.push(String(n % 100000).padStart(5, "0"));
  }
  return groups;
}

/** 12 groups of 5 digits, identical for both parties. */
export async function computeSafetyNumber(a: SafetyParty, b: SafetyParty): Promise<string[]> {
  const [first, second] = a.userId.toLowerCase() <= b.userId.toLowerCase() ? [a, b] : [b, a];
  const [x, y] = await Promise.all([fingerprintDigits(first), fingerprintDigits(second)]);
  return [...x, ...y];
}
