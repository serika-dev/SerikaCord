/**
 * Static, server-rendered previews of the real SerikaCord UI for the homepage.
 *
 * Every piece copies the markup and Tailwind classes of the component it
 * shows, with the app's own theme tokens, so the previews look exactly like
 * the app in the visitor's theme. When those components change, update the
 * matching block here:
 *   ServerRail       ← src/components/layout/ServerSidebar.tsx
 *   ChannelList      ← src/components/layout/ChannelSidebar.tsx (+ voice/VoiceChannelMembers.tsx, user panel)
 *   ChatHeader       ← src/components/chat/ChatArea.tsx (header) + chat/search/MessageSearchBar.tsx
 *   MessageRow       ← src/components/chat/MessageGroup.tsx + MessageGroupHeader.tsx
 *   Reactions        ← src/components/chat/MessageReactions.tsx
 *   Poll             ← src/components/chat/PollCard.tsx (results view)
 *   ThreadChip       ← src/components/chat/ThreadRows.tsx
 *   Typing           ← src/components/chat/TypingIndicator.tsx
 *   Composer         ← src/components/chat/MessageBar.tsx + RichComposer.tsx
 *   MemberRow        ← src/components/chat/MemberSidebar.tsx (MemberItem)
 *   PhoneDmPreview   ← the DM page at phone width + e2ee PIN / link / reset / lock dialogs as bottom sheets (PrivacyPhone.tsx)
 *   LivePreview      ← all of the above, playable (live/LivePreview.tsx)
 *   HeroDevices      ← the desktop app on #clips + the phone voice view, scaled into a computer and a phone (HeroDevices.tsx)
 *   CallPlayground   ← voice/CallStage.tsx (grid / spotlight) + channels/[serverId]/[channelId]/page.tsx (dock) (CallPlayground.tsx)
 * Names, messages and servers are examples; nothing is sent anywhere.
 */
import { getGT, getLocale } from "gt-next/server";
import { LivePreview } from "./live/LivePreview";
import { PrivacyPhone } from "./PrivacyPhone";
import { DesktopScreen, Fit, HeroDevices } from "./HeroDevices";
import { DEVICE_TIME } from "./IosStatus";
import { SEED_TIMES } from "./live/strings";

export { MemberRow, UserPanel } from "./preview/parts";

/**
 * "Today at 2:41 PM" in the visitor's language (formatMessageTimestamp). The
 * sample chats are written on an evening clock; they're shown 7 hours earlier
 * so everything happened before the devices' clock (DEVICE_TIME, 14:44).
 */
async function clock() {
  const [gt, locale] = await Promise.all([getGT(), getLocale()]);
  const time = (h: number, m: number) => {
    const d = new Date(Date.UTC(2026, 0, 1, h - 7, m));
    try {
      return d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    } catch {
      return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    }
  };
  return { gt, time, today: (h: number, m: number) => gt("Today at {time}", { time: time(h, m) }) };
}

/** The hero: the app itself, playable (live/LivePreview.tsx). Seed timestamps are formatted here. */
export async function ChannelPreview() {
  const { time, today } = await clock();
  const times = Object.fromEntries(
    SEED_TIMES.map((t) => {
      const [h, m] = t.split(":").map(Number);
      return [t, today(h, m)];
    }),
  ) as Record<(typeof SEED_TIMES)[number], string>;
  return <LivePreview times={{ ...times, thread: time(21, 40) }} />;
}

// ─── Encrypted DM, on a phone ────────────────────────────────────────────────
/** The privacy section's phone (PrivacyPhone.tsx). Seed timestamps are formatted here. */
export async function PhoneDmPreview() {
  const { today } = await clock();
  return <PrivacyPhone times={{ a: today(20, 12), b: today(20, 14), c: today(21, 34), d: today(19, 40), status: DEVICE_TIME }} />;
}

// ─── Hero computer and phone ─────────────────────────────────────────────────
/** The hero's computer and phone (HeroDevices.tsx), with their times formatted here. */
export async function HeroDevicesPreview() {
  const { today } = await clock();
  return <HeroDevices today={today} clock={DEVICE_TIME} />;
}

// ─── The web app in a browser (AppsSection) ──────────────────────────────────
/** The desktop app on #clips, scaled to fit a browser window (HeroDevices.tsx). */
export async function WebAppScreen() {
  const { gt, today } = await clock();
  return (
    <Fit w={1160} h={720}>
      <DesktopScreen gt={gt} today={today} />
    </Fit>
  );
}
