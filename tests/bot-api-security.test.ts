import { describe, expect, test } from "bun:test";
import {
  messagePayloadFor,
  redactMessageContent,
  routeDecision,
  shouldRedactContent,
  type RoutableDispatch,
  type RoutingSession,
} from "@/lib/gateway/routing";
import {
  APPLICATION_FLAGS,
  INTENT,
  INTENTS_CONFIGURED_MARKER,
  PRIVILEGED_INTENTS,
  allowedPrivilegedIntents,
  appHasMessageContent,
  disallowedIntents,
  intentApplicationFlags,
  toStoredIntents,
} from "@/lib/gateway/intents";
import { DM_BOT_PERMISSIONS, applyTimeout, botCan } from "@/lib/permissions/botChannel";
import { computeChannelPermissions } from "@/lib/permissions/channelOverwrites";
import { PERMISSION_BITS as P } from "@/lib/permissions/bits";
import { normalizeBotAttachments } from "@/lib/chat/attachmentPolicy";

const BOT = "11111111-1111-4111-8111-111111111111";
const OTHER_BOT = "22222222-2222-4222-8222-222222222222";
const ALICE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GUILD = "99999999-9999-4999-8999-999999999999";
const DM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CHANNEL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ALL_INTENTS = INTENT.GUILDS | INTENT.GUILD_MESSAGES | INTENT.DIRECT_MESSAGES | INTENT.MESSAGE_CONTENT | INTENT.GUILD_MEMBERS;

function session(over: Partial<RoutingSession> = {}): RoutingSession {
  return { botId: BOT, intents: ALL_INTENTS, guildIds: new Set([GUILD]), dmChannelIds: new Set(), ...over };
}

function dmMessage(over: Partial<RoutableDispatch> = {}): RoutableDispatch {
  return {
    t: "MESSAGE_CREATE",
    guildId: null,
    intent: INTENT.DIRECT_MESSAGES,
    d: { id: "m1", channel_id: DM, guild_id: null, author: { id: ALICE }, content: "secret poll between humans", mentions: [] },
    ...over,
  };
}

describe("gateway DM routing (no fan-out of DMs between humans)", () => {
  test("a bot with zero DM channels does not receive another DM's events", () => {
    // The old filter (`dmChannelIds.size && !has`) delivered this to every bot with no DMs.
    expect(routeDecision(session(), dmMessage()).deliver).toBe(false);
    expect(routeDecision(session(), dmMessage({ audience: [ALICE, BOB] })).deliver).toBe(false);
  });

  test("a DM-scoped dispatch without a channel id reaches nobody unless targeted", () => {
    const d = dmMessage({ d: { id: "m1", author: { id: ALICE } } });
    expect(routeDecision(session(), d).deliver).toBe(false);
    expect(routeDecision(session(), { ...d, targetBotId: BOT }).deliver).toBe(true);
    expect(routeDecision(session(), { ...d, targetBotId: OTHER_BOT }).deliver).toBe(false);
  });

  test("recipients in the audience receive it, and new DMs are tracked", () => {
    const r = routeDecision(session(), dmMessage({ audience: [ALICE, BOT] }));
    expect(r.deliver).toBe(true);
    expect(r.addDmChannelId).toBe(DM);
  });

  test("audience matching is case-insensitive", () => {
    expect(routeDecision(session(), dmMessage({ audience: [BOT.toUpperCase()] })).deliver).toBe(true);
  });

  test("a DM known at IDENTIFY still works without an audience; unknown DMs do not", () => {
    expect(routeDecision(session({ dmChannelIds: new Set([DM]) }), dmMessage()).deliver).toBe(true);
    expect(routeDecision(session({ dmChannelIds: new Set(["other"]) }), dmMessage()).deliver).toBe(false);
  });

  test("an audience excludes recipients-of-record that are not listed", () => {
    expect(routeDecision(session({ dmChannelIds: new Set([DM]) }), dmMessage({ audience: [ALICE, BOB] })).deliver).toBe(false);
  });

  test("intent is still required", () => {
    expect(routeDecision(session({ intents: INTENT.GUILDS }), dmMessage({ audience: [BOT] })).deliver).toBe(false);
  });

  test("poll vote events are channel-scoped too", () => {
    const vote: RoutableDispatch = { t: "MESSAGE_POLL_VOTE_ADD", guildId: null, intent: 0, d: { user_id: ALICE, channel_id: DM, message_id: "m", answer_id: 1 } };
    expect(routeDecision(session(), vote).deliver).toBe(false);
    expect(routeDecision(session(), { ...vote, audience: [BOT, ALICE] }).deliver).toBe(true);
  });
});

describe("gateway guild routing", () => {
  const guildMsg = (over: Partial<RoutableDispatch> = {}): RoutableDispatch => ({
    t: "MESSAGE_CREATE",
    guildId: GUILD,
    intent: INTENT.GUILD_MESSAGES,
    d: { id: "m", channel_id: CHANNEL, guild_id: GUILD, author: { id: ALICE }, content: "hi", mentions: [] },
    ...over,
  });

  test("only bots in the guild", () => {
    expect(routeDecision(session(), guildMsg()).deliver).toBe(true);
    expect(routeDecision(session({ guildIds: new Set() }), guildMsg()).deliver).toBe(false);
  });

  test("channel audience hides private channels from bots that cannot view them", () => {
    expect(routeDecision(session(), guildMsg({ audience: [OTHER_BOT] })).deliver).toBe(false);
    expect(routeDecision(session(), guildMsg({ audience: [BOT] })).deliver).toBe(true);
  });

  test("never echoes the bot's own message", () => {
    expect(routeDecision(session(), guildMsg({ d: { channel_id: CHANNEL, guild_id: GUILD, author: { id: BOT } } })).deliver).toBe(false);
  });

  test("a targeted GUILD_CREATE adds the guild", () => {
    const r = routeDecision(session({ guildIds: new Set() }), { t: "GUILD_CREATE", guildId: GUILD, intent: 0, d: {}, targetBotId: BOT });
    expect(r).toEqual({ deliver: true, addGuildId: GUILD });
  });
});

describe("MESSAGE_CONTENT", () => {
  const msg = { id: "m", channel_id: CHANNEL, guild_id: GUILD, author: { id: ALICE }, content: "hello", embeds: [{ title: "e" }], attachments: [{ url: "x" }], components: [{ type: 1 }], poll: { question: { text: "q" } }, mentions: [] as Array<{ id: string }> };

  test("guild messages are blanked without the intent", () => {
    const out = messagePayloadFor("MESSAGE_CREATE", msg, BOT, INTENT.GUILD_MESSAGES) as Record<string, unknown>;
    expect(out.content).toBe("");
    expect(out.embeds).toEqual([]);
    expect(out.attachments).toEqual([]);
    expect(out.components).toEqual([]);
    expect("poll" in out).toBe(false);
    expect(out.id).toBe("m");
    expect(msg.content).toBe("hello"); // the shared payload is not mutated
  });

  test("kept with the intent, in DMs, for mentions and for the bot's own messages", () => {
    expect((messagePayloadFor("MESSAGE_CREATE", msg, BOT, INTENT.GUILD_MESSAGES | INTENT.MESSAGE_CONTENT) as { content: string }).content).toBe("hello");
    expect((messagePayloadFor("MESSAGE_CREATE", { ...msg, guild_id: null }, BOT, 0) as { content: string }).content).toBe("hello");
    expect((messagePayloadFor("MESSAGE_CREATE", { ...msg, mentions: [{ id: BOT }] }, BOT, 0) as { content: string }).content).toBe("hello");
    expect((messagePayloadFor("MESSAGE_UPDATE", { ...msg, author: { id: BOT } }, BOT, 0) as { content: string }).content).toBe("hello");
  });

  test("other events pass through untouched", () => {
    expect(messagePayloadFor("MESSAGE_DELETE", msg, BOT, 0)).toBe(msg);
  });

  test("forward snapshots and replied-to content are blanked too", () => {
    const out = redactMessageContent({ ...msg, message_snapshots: [{ message: { content: "fwd" } }], referenced_message: { content: "ref", author: { id: ALICE } } }, BOT) as {
      message_snapshots: Array<{ message: { content: string } }>; referenced_message: { content: string };
    };
    expect(out.message_snapshots[0].message.content).toBe("");
    expect(out.referenced_message.content).toBe("");
  });

  test("REST decision mirrors the gateway rule", () => {
    expect(shouldRedactContent({ guildId: GUILD, authorId: ALICE, mentionedUserIds: [] }, BOT, false)).toBe(true);
    expect(shouldRedactContent({ guildId: GUILD, authorId: ALICE, mentionedUserIds: [BOT] }, BOT, false)).toBe(false);
    expect(shouldRedactContent({ guildId: null, authorId: ALICE }, BOT, false)).toBe(false);
    expect(shouldRedactContent({ guildId: GUILD, authorId: ALICE }, BOT, true)).toBe(false);
  });
});

describe("privileged intents", () => {
  const before = new Date("2026-01-01T00:00:00Z");
  const after = new Date("2026-12-01T00:00:00Z");

  test("existing apps are grandfathered until the owner saves the toggles", () => {
    expect(allowedPrivilegedIntents({ gatewayIntents: 0, createdAt: before })).toBe(PRIVILEGED_INTENTS);
    expect(appHasMessageContent({ gatewayIntents: 0, createdAt: before })).toBe(true);
    // Saved with Message Content off: enforced.
    expect(appHasMessageContent({ gatewayIntents: INTENTS_CONFIGURED_MARKER, createdAt: before })).toBe(false);
  });

  test("new apps start with none", () => {
    expect(allowedPrivilegedIntents({ gatewayIntents: 0, createdAt: after })).toBe(0);
    expect(appHasMessageContent({ gatewayIntents: toStoredIntents(INTENT.MESSAGE_CONTENT), createdAt: after })).toBe(true);
  });

  test("stored value keeps only privileged bits and the marker", () => {
    expect(toStoredIntents(INTENT.MESSAGE_CONTENT | INTENT.GUILDS)).toBe(INTENT.MESSAGE_CONTENT | INTENTS_CONFIGURED_MARKER);
    expect(toStoredIntents(-1)).toBeNull();
    expect(toStoredIntents("abc")).toBeNull();
  });

  test("IDENTIFY with an unapproved privileged intent is disallowed (4014)", () => {
    expect(disallowedIntents(INTENT.GUILDS | INTENT.MESSAGE_CONTENT, 0)).toBe(INTENT.MESSAGE_CONTENT);
    expect(disallowedIntents(INTENT.GUILDS | INTENT.GUILD_MESSAGES, 0)).toBe(0);
    expect(disallowedIntents(INTENT.MESSAGE_CONTENT, INTENT.MESSAGE_CONTENT)).toBe(0);
  });

  test("application flags advertise approvals", () => {
    expect(intentApplicationFlags(INTENT.MESSAGE_CONTENT)).toBe(APPLICATION_FLAGS.GATEWAY_MESSAGE_CONTENT);
    expect(intentApplicationFlags(PRIVILEGED_INTENTS)).toBe(
      APPLICATION_FLAGS.GATEWAY_MESSAGE_CONTENT | APPLICATION_FLAGS.GATEWAY_GUILD_MEMBERS | APPLICATION_FLAGS.GATEWAY_PRESENCE,
    );
  });
});

describe("bot channel permissions", () => {
  const ROLE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const EVERYONE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const base = P.VIEW_CHANNEL | P.SEND_MESSAGES | P.READ_MESSAGE_HISTORY | P.ADD_REACTIONS;
  const resolve = (overwrites: Array<{ id: string; type: string; allow?: string; deny?: string }>, rolePerms: bigint[] = []) =>
    computeChannelPermissions({
      everyonePermissions: base,
      rolePermissions: rolePerms,
      overwrites,
      ctx: { serverId: GUILD, everyoneRoleId: EVERYONE, memberRoleIds: [ROLE], userId: BOT },
    });

  test("a role overwrite that denies SEND_MESSAGES stops the bot from posting", () => {
    const perms = resolve([{ id: ROLE, type: "role", deny: String(P.SEND_MESSAGES) }]);
    expect(botCan(perms, "send")).toBe(false);
    expect(botCan(perms, "read_history")).toBe(true);
    expect(botCan(resolve([]), "send")).toBe(true);
  });

  test("a member overwrite applies to the bot like any member", () => {
    const perms = resolve([{ id: BOT, type: "member", deny: String(P.VIEW_CHANNEL) }]);
    expect(botCan(perms, "read_history")).toBe(false);
    expect(botCan(perms, "send")).toBe(false);
  });

  test("ADMINISTRATOR passes overwrites", () => {
    const perms = resolve([{ id: ROLE, type: "role", deny: String(P.SEND_MESSAGES) }], [P.ADMINISTRATOR]);
    expect(botCan(perms, "manage_messages")).toBe(true);
  });

  test("removing others' reactions or clearing all needs MANAGE_MESSAGES", () => {
    expect(botCan(base, "manage_messages")).toBe(false);
    expect(botCan(base | P.MANAGE_MESSAGES, "manage_messages")).toBe(true);
    // A channel deny of MANAGE_MESSAGES wins over the role grant.
    const denied = resolve([{ id: ROLE, type: "role", deny: String(P.MANAGE_MESSAGES) }], [P.MANAGE_MESSAGES]);
    expect(botCan(denied, "manage_messages")).toBe(false);
  });

  test("own reactions: existing needs VIEW + READ_MESSAGE_HISTORY, new emoji also ADD_REACTIONS", () => {
    const noReact = P.VIEW_CHANNEL | P.READ_MESSAGE_HISTORY;
    expect(botCan(noReact, "react_existing")).toBe(true);
    expect(botCan(noReact, "react_new")).toBe(false);
    expect(botCan(noReact | P.ADD_REACTIONS, "react_new")).toBe(true);
    expect(botCan(P.VIEW_CHANNEL | P.ADD_REACTIONS, "react_existing")).toBe(false);
  });

  test("threads send with SEND_MESSAGES_IN_THREADS", () => {
    expect(botCan(P.VIEW_CHANNEL | P.SEND_MESSAGES, "send", { isThread: true })).toBe(false);
    expect(botCan(P.VIEW_CHANNEL | P.SEND_MESSAGES_IN_THREADS, "send", { isThread: true })).toBe(true);
  });

  test("pinning accepts PIN_MESSAGES or MANAGE_MESSAGES", () => {
    expect(botCan(P.VIEW_CHANNEL | P.PIN_MESSAGES, "pin")).toBe(true);
    expect(botCan(P.VIEW_CHANNEL | P.MANAGE_MESSAGES, "pin")).toBe(true);
    expect(botCan(P.VIEW_CHANNEL, "pin")).toBe(false);
  });

  test("DMs: no moderation powers", () => {
    expect(botCan(DM_BOT_PERMISSIONS, "send")).toBe(true);
    expect(botCan(DM_BOT_PERMISSIONS, "manage_messages")).toBe(false);
    expect(botCan(DM_BOT_PERMISSIONS, "manage_webhooks")).toBe(false);
  });

  test("a timed-out bot keeps only view + history", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    const until = new Date(now + 60_000);
    const perms = applyTimeout(base | P.MANAGE_MESSAGES, until, now);
    expect(botCan(perms, "send")).toBe(false);
    expect(botCan(perms, "manage_messages")).toBe(false);
    expect(botCan(perms, "read_history")).toBe(true);
    expect(applyTimeout(base, new Date(now - 1), now)).toBe(base);
  });
});

describe("bot attachments", () => {
  const cdnUrl = "https://cdn.serika.chat";

  test("arbitrary URLs are rejected", () => {
    const r = normalizeBotAttachments([{ url: "https://evil.example/invoice.pdf", filename: "invoice.pdf", content_type: "application/pdf" }], { cdnUrl, botId: BOT });
    expect("error" in r).toBe(true);
  });

  test("another user's upload is rejected", () => {
    const r = normalizeBotAttachments([{ url: `${cdnUrl}/attachments/${ALICE}/a.png`, filename: "a.png", content_type: "image/png" }], { cdnUrl, botId: BOT });
    expect("error" in r).toBe(true);
  });

  test("the bot's own upload is accepted and stored in the internal shape", () => {
    const r = normalizeBotAttachments([{ url: `${cdnUrl}/attachments/${CHANNEL}/${BOT}/a.png`, filename: "a.png", content_type: "image/png", size: 10 }], { cdnUrl, botId: BOT });
    expect("attachments" in r && r.attachments[0]).toMatchObject({ contentType: "image/png", filename: "a.png", size: 10 });
  });

  test("absent attachments are fine; non-arrays are not", () => {
    expect(normalizeBotAttachments(undefined, { cdnUrl, botId: BOT })).toEqual({ attachments: [] });
    expect("error" in normalizeBotAttachments({ url: "x" }, { cdnUrl, botId: BOT })).toBe(true);
  });
});
