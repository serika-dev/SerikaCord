import type { SettingsPatch } from "@/lib/settings/mergeSettings";

/** User settings as loaded from GET /api/users/me/settings (free-form JSON). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserSettingsValue = Record<string, any> | null;

/** Applies a patch locally and PATCHes it (toast on success). */
export type SaveSettingsPatch = (patch: SettingsPatch, sectionLabel: string) => unknown;

/** Slider variant: applies live, PATCHes once ~300ms after the last change. */
export type SaveSettingsPatchDebounced = (patch: SettingsPatch, sectionLabel: string) => void;
