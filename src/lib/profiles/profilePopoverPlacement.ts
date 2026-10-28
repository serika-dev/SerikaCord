/**
 * Where the compact profile card (MemberProfilePopup → ProfileCard) opens.
 *
 * Discord-style: the card opens beside the thing that was clicked (the name,
 * avatar or @mention itself), top-aligned with it, and slides up as far as it
 * must to stay on screen. Radix Popover (floating-ui) does the maths; these
 * are the options every trigger shares, so the rules live in one place.
 */

/** Where a profile card trigger lives on screen. */
export type ProfilePopoverSurface =
  /** Chat content: author name/avatar, mentions, reply names. Opens to the right. */
  | "chat"
  /** A list docked on the right of the window (member list). Opens to the left. */
  | "rightPanel";

export type ProfilePopoverSide = "left" | "right";

/** Gap between the trigger and the card, in px. */
export const PROFILE_POPOVER_SIDE_OFFSET = 10;
/** Minimum distance between the card and the viewport edges, in px. */
export const PROFILE_POPOVER_COLLISION_PADDING = 12;

export function profilePopoverSide(surface: ProfilePopoverSurface): ProfilePopoverSide {
  return surface === "rightPanel" ? "left" : "right";
}

export interface ProfilePopoverPositioning {
  side: ProfilePopoverSide;
  align: "start";
  sideOffset: number;
  collisionPadding: number;
  avoidCollisions: true;
  /** "always": keep shifting along the trigger's edge until the card is fully on screen. */
  sticky: "always";
  /** Hide (not close) the card while its trigger is scrolled out of view. */
  hideWhenDetached: true;
}

/**
 * Radix `PopoverContent` props for a profile card. Collision handling:
 * - not enough room on `side` → flips to the other side (floating-ui flip);
 * - would run past the top/bottom edge → shifts vertically, keeping
 *   `collisionPadding` px from the edge (shift, no limiter with sticky=always);
 * - taller than the viewport → the card caps itself at
 *   `--radix-popover-content-available-height` and scrolls its body
 *   (ProfileCard's `fitToViewport`).
 * Radix re-runs this on scroll, resize and whenever the card's size changes.
 */
export function profilePopoverPositioning(surface: ProfilePopoverSurface = "chat"): ProfilePopoverPositioning {
  return {
    side: profilePopoverSide(surface),
    align: "start",
    sideOffset: PROFILE_POPOVER_SIDE_OFFSET,
    collisionPadding: PROFILE_POPOVER_COLLISION_PADDING,
    avoidCollisions: true,
    sticky: "always",
    hideWhenDetached: true,
  };
}

