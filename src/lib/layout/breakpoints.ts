/**
 * Layout tiers (one source for JS; CSS mirrors them with the `phone:` /
 * `desk:` custom variants in globals.css).
 *
 * - phone: the single-page phone shell. Narrower than 768px, or a phone held
 *   sideways (short, touch, landscape), where the desktop columns leave no
 *   room for the chat once the keyboard is up.
 * - compact: 768–1023px desktop layout (iPad portrait, split view, small
 *   windows): server rail + channel list + chat; the member list and search
 *   results open over the chat instead of taking a column.
 * - wide: 1024px and up, every column inline (member list collapsible).
 */
export const PHONE_QUERY = "(max-width: 767px), (max-height: 500px) and (orientation: landscape) and (pointer: coarse)";
export const COMPACT_QUERY = "(max-width: 1023px)";
/** Touch-first input (finger-sized targets, no hover-only controls). */
export const COARSE_QUERY = "(pointer: coarse)";
