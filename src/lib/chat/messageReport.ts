/** Reasons offered by "Report Message" (sent as-is; the server checks the list). */
export const MESSAGE_REPORT_REASONS = [
  "spam",
  "harassment",
  "hate",
  "nsfw",
  "self_harm",
  "illegal",
  "impersonation",
  "other",
] as const;

export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

export function isMessageReportReason(value: unknown): value is MessageReportReason {
  return typeof value === "string" && (MESSAGE_REPORT_REASONS as readonly string[]).includes(value);
}
