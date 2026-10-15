// Fixed labels, versions and size limits of the E2EE protocol (v1). Changing
// any label or size is a protocol change: bump the version instead.

export const E2EE_VERSION = 1 as const;

/** Domain-separation labels (each is the first `frame()` part of what it covers). */
export const LABELS = {
  device: "serika-e2ee-device-v1",
  backupKey: "serika-e2ee-backup-key-v1",
  message: "serika-e2ee-msg-v1",
  wrap: "serika-e2ee-wrap-v1",
  sig: "serika-e2ee-sig-v1",
  backup: "serika-e2ee-backup-v1",
  dtls: "serika-e2ee-dtls-v1",
  safety: "serika-e2ee-safety-v1",
  attachment: "serika-e2ee-file-v1",
  /** A device's push notification key, signed by that device's signing key (notifyKeys.ts). */
  notify: "serika-e2ee-notify-v1",
} as const;

/** Raw uncompressed P-256 public key: 0x04 ‖ X ‖ Y. */
export const PUBLIC_KEY_BYTES = 65;
/** IEEE P1363 ECDSA P-256 signature (r ‖ s). */
export const SIGNATURE_BYTES = 64;
export const AES_KEY_BYTES = 32;
export const GCM_IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const SHA256_BYTES = 32;
/** A wrapped message key: 32-byte key + 16-byte GCM tag. */
export const WRAPPED_KEY_BYTES = AES_KEY_BYTES + GCM_TAG_BYTES;

/** Device ids: 16 random bytes as base64url (22 chars). */
export const DEVICE_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const UUID_RE = new RegExp(`^${UUID}$`, "i");
/** Wrap recipient: a device id, or `backup:<user uuid>` for a member's backup key. */
export const RECIPIENT_RE = new RegExp(`^(?:[A-Za-z0-9_-]{22}|backup:${UUID})$`, "i");

export const LIMITS = {
  /** Plaintext payload JSON (content ≤ 4000 chars + attachment keys + reply preview). */
  maxPayloadBytes: 32 * 1024,
  /** Wrapped-key entries per envelope: 10 members × (10 devices + 1 backup) rounded up. */
  maxRecipients: 128,
  /** Serialized envelope JSON accepted by the server. */
  maxEnvelopeJsonBytes: 96 * 1024,
  /** Active devices per user. */
  maxDevicesPerUser: 10,
  /** Passphrase backup blob (base64). */
  maxBackupBlobB64: 16 * 1024,
  /** Attachments carried by one encrypted message. */
  maxAttachments: 10,
  /** Device display name. */
  maxDeviceName: 64,
} as const;

export const PBKDF2_ITERATIONS = 600_000;
export const PBKDF2_MAX_ITERATIONS = 5_000_000;
export const PBKDF2_SALT_BYTES = 16;
export const MIN_PASSPHRASE_LENGTH = 10;

/**
 * First 8 bytes of every encrypted attachment blob ("SRKE2EE" + version 1).
 * Besides versioning the format it guarantees the server's image sniffer never
 * mistakes ciphertext for an image (random bytes start with "BM" — BMP — once
 * in 65 536 uploads, and FF D8 FF — JPEG — once in 16.7 M).
 */
export const ATTACHMENT_MAGIC = new Uint8Array([0x53, 0x52, 0x4b, 0x45, 0x32, 0x45, 0x45, 0x01]);

/** Upload name of an encrypted attachment blob: `e2ee-<22 base64url chars>.bin`. */
export const ATTACHMENT_BLOB_NAME_RE = /^e2ee-[A-Za-z0-9_-]{22}\.bin$/;
export const ATTACHMENT_BLOB_TYPE = "application/octet-stream";

/** Safety number: 12 groups of 5 digits (6 per user). */
export const SAFETY_NUMBER_GROUPS = 12;
export const SAFETY_NUMBER_ITERATIONS = 5200;
