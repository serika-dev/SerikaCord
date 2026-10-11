/**
 * Navigation state of a phone-width settings sheet (server / channel
 * settings): a grouped section list, a pushed section page, and an optional
 * detail page inside that section (e.g. one role's editor). Pure so the
 * back-button behaviour can be unit tested.
 */
export interface MobileSettingsNav<S extends string = string> {
  /** Section shown when `page` is true. */
  section: S;
  /** false = the section list is showing. */
  page: boolean;
  /** A detail page pushed on top of the section (role editor, ...). */
  detail: string | null;
}

export function openMobileSection<S extends string>(nav: MobileSettingsNav<S>, section: S): MobileSettingsNav<S> {
  return { section, page: true, detail: null };
}

export function openMobileDetail<S extends string>(nav: MobileSettingsNav<S>, detail: string): MobileSettingsNav<S> {
  return { ...nav, page: true, detail };
}

/**
 * One "back" press: detail → section page → list → close. Returns `null`
 * when the sheet itself should close.
 */
export function mobileSettingsBack<S extends string>(nav: MobileSettingsNav<S>): MobileSettingsNav<S> | null {
  if (nav.detail !== null) return { ...nav, detail: null };
  if (nav.page) return { ...nav, page: false };
  return null;
}
