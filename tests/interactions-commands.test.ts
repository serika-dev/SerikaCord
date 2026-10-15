import { describe, expect, test } from "bun:test";
import { FormErrors } from "@/lib/botapi/formErrors";
import {
  CommandType,
  OptionType,
  checkInvocationOptions,
  commandContexts,
  commandFingerprint,
  memberMeetsDefaultPermissions,
  planBulkOverwrite,
  resolveCommandPermission,
  snowflakeNow,
  validateAutocompleteChoices,
  validateCommand,
  validateCommandPermissions,
  type CommandDefinition,
} from "@/lib/botapi/commands";
import {
  ACK_DEADLINE_MS,
  ACK_GRACE_MS,
  CallbackType,
  InteractionStore,
  InteractionType,
  checkInitialCallback,
  checkTokenAlive,
  hashToken,
  isTokenShaped,
  memoryKV,
  newInteractionToken,
  type InteractionState,
} from "@/lib/botapi/interactionState";

function def(input: unknown, opts: { partial?: CommandDefinition } = {}) {
  const errors = new FormErrors();
  return { def: validateCommand(input, { errors, partial: opts.partial }), errors };
}

describe("command validation", () => {
  test("chat input names: lowercase, regex, length", () => {
    expect(def({ name: "ping", description: "Pong" }).errors.ok).toBeTrue();
    expect(def({ name: "Ping", description: "Pong" }).errors.ok).toBeFalse();
    expect(def({ name: "has space", description: "x" }).errors.ok).toBeFalse();
    expect(def({ name: "x".repeat(33), description: "x" }).errors.ok).toBeFalse();
    expect(def({ name: "日本語", description: "x" }).errors.ok).toBeTrue();
  });

  test("user / message commands: spaces allowed, no description or options", () => {
    expect(def({ name: "Report User", type: 2 }).errors.ok).toBeTrue();
    expect(def({ name: "Report", type: 3, description: "nope" }).errors.ok).toBeFalse();
    expect(def({ name: "Report", type: 2, options: [{ type: 3, name: "a", description: "b" }] }).errors.ok).toBeFalse();
  });

  test("description required for chat input", () => {
    const { errors } = def({ name: "ping" });
    expect(errors.ok).toBeFalse();
    expect(JSON.stringify(errors.toBody().errors)).toContain("description");
  });

  test("options: order, duplicates, nesting, choices", () => {
    expect(def({ name: "a", description: "a", options: [
      { type: 3, name: "opt", description: "o" },
      { type: 3, name: "req", description: "r", required: true },
    ] }).errors.ok).toBeFalse();
    expect(def({ name: "a", description: "a", options: [
      { type: 3, name: "x", description: "o" },
      { type: 4, name: "x", description: "o" },
    ] }).errors.ok).toBeFalse();
    expect(def({ name: "a", description: "a", options: [
      { type: 1, name: "sub", description: "s", options: [{ type: 1, name: "deep", description: "d" }] },
    ] }).errors.ok).toBeFalse();
    expect(def({ name: "a", description: "a", options: [
      { type: 1, name: "sub", description: "s" },
      { type: 3, name: "mixed", description: "m" },
    ] }).errors.ok).toBeFalse();
    expect(def({ name: "a", description: "a", options: [
      { type: 5, name: "flag", description: "f", choices: [{ name: "x", value: "y" }] },
    ] }).errors.ok).toBeFalse();
    expect(def({ name: "a", description: "a", options: [
      { type: 3, name: "s", description: "s", autocomplete: true, choices: [{ name: "x", value: "y" }] },
    ] }).errors.ok).toBeFalse();
    const good = def({ name: "a", description: "a", options: [
      { type: 2, name: "grp", description: "g", options: [{ type: 1, name: "sub", description: "s", options: [{ type: 4, name: "n", description: "n", min_value: 1, max_value: 5, required: true }] }] },
    ] });
    expect(good.errors.ok).toBeTrue();
  });

  test("permissions / contexts / localizations are stored", () => {
    const { def: d } = def({
      name: "ban", description: "Ban", default_member_permissions: "4", contexts: [0], integration_types: [0],
      name_localizations: { ja: "バン" }, description_localizations: { fr: "Bannir" }, nsfw: true,
    });
    expect(d!.defaultMemberPermissions).toBe("4");
    expect(d!.contexts).toEqual([0]);
    expect(d!.nameLocalizations).toEqual({ ja: "バン" });
    expect(d!.nsfw).toBeTrue();
    expect(def({ name: "x", description: "x", name_localizations: { klingon: "x" } }).errors.ok).toBeFalse();
    expect(def({ name: "x", description: "x", default_permission: false }).def!.defaultMemberPermissions).toBe("0");
  });

  test("PATCH keeps fields that weren't sent", () => {
    const base = def({ name: "ping", description: "Pong", default_member_permissions: "8" }).def!;
    const patched = def({ description: "Pong!" }, { partial: base }).def!;
    expect(patched.name).toBe("ping");
    expect(patched.defaultMemberPermissions).toBe("8");
    expect(patched.description).toBe("Pong!");
    expect(def({ type: 2 }, { partial: base }).errors.ok).toBeFalse();
  });
});

describe("bulk overwrite keeps ids", () => {
  const ping = def({ name: "ping", description: "Pong" }).def!;
  const echo = def({ name: "echo", description: "Echo" }).def!;
  const existing = [
    { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "ping", type: 1, fingerprint: commandFingerprint(ping) },
    { id: "aaaaaaaa-0000-4000-8000-000000000002", name: "old", type: 1, fingerprint: "x" },
  ];

  test("unchanged commands keep their id and version, new ones are created, missing ones deleted", () => {
    const errors = new FormErrors();
    const plan = planBulkOverwrite(existing, [ping, echo], errors);
    expect(errors.ok).toBeTrue();
    expect(plan.update).toEqual([{ id: existing[0].id, def: ping, changed: false }]);
    expect(plan.create).toEqual([echo]);
    expect(plan.remove).toEqual([existing[1].id]);
  });

  test("an id in the body renames in place", () => {
    const renamed = { ...echo, id: existing[1].id };
    const plan = planBulkOverwrite(existing, [renamed], new FormErrors());
    expect(plan.update[0]).toMatchObject({ id: existing[1].id, changed: true });
    expect(plan.remove).toEqual([existing[0].id]);
  });

  test("same name + type twice is an error, same name different type is fine", () => {
    const errors = new FormErrors();
    planBulkOverwrite([], [ping, ping], errors);
    expect(errors.ok).toBeFalse();
    const user = def({ name: "ping", type: CommandType.USER }).def!;
    const ok = new FormErrors();
    planBulkOverwrite([], [ping, user], ok);
    expect(ok.ok).toBeTrue();
  });

  test("versions are snowflakes", () => {
    const v = snowflakeNow(Date.UTC(2026, 0, 1));
    expect(/^\d{17,20}$/.test(v)).toBeTrue();
    expect(Number((BigInt(v) >> 22n) + 1420070400000n)).toBe(Date.UTC(2026, 0, 1));
  });
});

describe("invocation options", () => {
  const declared = def({ name: "x", description: "x", options: [
    { type: 1, name: "add", description: "a", options: [
      { type: 4, name: "n", description: "n", required: true, min_value: 1, max_value: 10 },
      { type: 3, name: "note", description: "n", max_length: 5 },
      { type: 6, name: "who", description: "w" },
      { type: 3, name: "q", description: "q", autocomplete: true },
    ] },
    { type: 1, name: "color", description: "c", options: [
      { type: 3, name: "c", description: "c", required: true, choices: [{ name: "Red", value: "red" }] },
    ] },
  ] }).def!.options;
  const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  test("valid typed options", () => {
    const r = checkInvocationOptions(declared, [{ name: "add", type: 1, options: [{ name: "n", type: 4, value: 3 }, { name: "who", type: 6, value: `<@${USER}>` }] }]);
    expect(r.ok).toBeTrue();
    if (r.ok) {
      expect(r.path).toEqual(["add"]);
      expect(r.refs.users).toEqual([USER]);
    }
  });

  test("range, length, choices, required, unknown options", () => {
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 11 }] }]).ok).toBeFalse();
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 1.5 }] }]).ok).toBeFalse();
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 1 }, { name: "note", value: "toolong" }] }]).ok).toBeFalse();
    expect(checkInvocationOptions(declared, [{ name: "add", options: [] }])).toMatchObject({ ok: false, reason: "missing_required" });
    expect(checkInvocationOptions(declared, [{ name: "color", options: [{ name: "c", value: "blue" }] }]).ok).toBeFalse();
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 1 }, { name: "evil", value: 1 }] }])).toMatchObject({ ok: false, reason: "unknown_option" });
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 1 }, { name: "who", value: "not-an-id" }] }]).ok).toBeFalse();
  });

  test("autocomplete needs exactly one focused autocomplete option", () => {
    const r = checkInvocationOptions(declared, [{ name: "add", options: [{ name: "q", value: "he", focused: true }] }], { autocomplete: true });
    expect(r.ok).toBeTrue();
    if (r.ok) expect(r.focused?.name).toBe("q");
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "note", value: "he", focused: true }] }], { autocomplete: true }).ok).toBeFalse();
    expect(checkInvocationOptions(declared, [{ name: "add", options: [{ name: "n", value: 1 }] }], { autocomplete: true }).ok).toBeFalse();
  });

  test("autocomplete result choices match the focused type", () => {
    expect(validateAutocompleteChoices({ choices: [{ name: "One", value: 1 }] }, OptionType.INTEGER)).toHaveLength(1);
    expect(validateAutocompleteChoices({ choices: [{ name: "One", value: "1" }] }, OptionType.INTEGER)).toBeNull();
    expect(validateAutocompleteChoices({ choices: Array.from({ length: 26 }, (_, i) => ({ name: `${i}`, value: `${i}` })) }, OptionType.STRING)).toBeNull();
  });
});

describe("command permissions", () => {
  test("default_member_permissions", () => {
    expect(memberMeetsDefaultPermissions(null, 0n, false)).toBeTrue();
    expect(memberMeetsDefaultPermissions("0", 0xffffn, false)).toBeFalse();
    expect(memberMeetsDefaultPermissions("0", 0n, true)).toBeTrue();
    expect(memberMeetsDefaultPermissions("4", 4n | 1n, false)).toBeTrue();
    expect(memberMeetsDefaultPermissions("6", 4n, false)).toBeFalse();
  });

  test("contexts default from dm_permission; guild commands only in guilds", () => {
    expect(commandContexts({ contexts: null, dmPermission: null })).toEqual([0, 1, 2]);
    expect(commandContexts({ contexts: null, dmPermission: false })).toEqual([0]);
    expect(commandContexts({ contexts: [1], guildId: "g" })).toEqual([0]);
  });

  test("overrides: user beats role, any allowed role beats denied roles, command beats app", () => {
    const ctx = { userId: "u", roleIds: ["r1", "r2"], channelId: "c", everyoneIds: ["g"], allChannelsIds: ["g"] };
    expect(resolveCommandPermission([[{ id: "r1", type: 1, permission: false }, { id: "r2", type: 1, permission: true }]], ctx).user).toBeTrue();
    expect(resolveCommandPermission([[{ id: "r1", type: 1, permission: true }, { id: "u", type: 2, permission: false }]], ctx).user).toBeFalse();
    expect(resolveCommandPermission([[{ id: "g", type: 1, permission: false }]], ctx).user).toBeFalse();
    expect(resolveCommandPermission([[{ id: "u", type: 2, permission: true }], [{ id: "u", type: 2, permission: false }]], ctx).user).toBeTrue();
    expect(resolveCommandPermission([[{ id: "g", type: 3, permission: false }]], ctx).channel).toBeFalse();
    expect(resolveCommandPermission([], ctx)).toEqual({ user: null, channel: null });
  });

  test("PUT body validation", () => {
    const errors = new FormErrors();
    expect(validateCommandPermissions({ permissions: [{ id: "123456789012345678", type: 1, permission: true }] }, errors)).toHaveLength(1);
    expect(validateCommandPermissions({ permissions: [{ id: "x", type: 9, permission: "yes" }] }, new FormErrors())).toBeNull();
  });
});

describe("interaction token state machine", () => {
  const base = (over: Partial<InteractionState> = {}): InteractionState => ({
    id: "ix1", type: InteractionType.APPLICATION_COMMAND, applicationId: "app", botId: "bot", channelId: "c",
    guildId: "g", invokerId: "u", invokerName: "ann", createdAt: 1_000_000, ...over,
  });

  test("initial callback within 3 s, once", () => {
    const now = 1_000_000 + 1000;
    expect(checkInitialCallback(base(), CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, false, now).ok).toBeTrue();
    expect(checkInitialCallback(base(), CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, true, now)).toMatchObject({ ok: false, code: 40060 });
    expect(checkInitialCallback(base(), CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, false, 1_000_000 + ACK_DEADLINE_MS + ACK_GRACE_MS + 1)).toMatchObject({ ok: false, code: 10062 });
  });

  test("callback types allowed per interaction type", () => {
    const now = 1_000_500;
    expect(checkInitialCallback(base(), CallbackType.UPDATE_MESSAGE, false, now).ok).toBeFalse();
    expect(checkInitialCallback(base({ type: InteractionType.MESSAGE_COMPONENT, sourceMessageId: "m" }), CallbackType.UPDATE_MESSAGE, false, now).ok).toBeTrue();
    expect(checkInitialCallback(base({ type: InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE }), CallbackType.CHANNEL_MESSAGE_WITH_SOURCE, false, now).ok).toBeFalse();
    expect(checkInitialCallback(base({ type: InteractionType.MODAL_SUBMIT }), CallbackType.MODAL, false, now).ok).toBeFalse();
    expect(checkInitialCallback(base(), CallbackType.PREMIUM_REQUIRED, false, now)).toMatchObject({ ok: false, code: 50035 });
    expect(checkInitialCallback(base(), CallbackType.LAUNCH_ACTIVITY, false, now)).toMatchObject({ ok: false, code: 50035 });
  });

  test("followups for 15 minutes", () => {
    expect(checkTokenAlive(base(), 1_000_000 + 14 * 60_000).ok).toBeTrue();
    expect(checkTokenAlive(base(), 1_000_000 + 16 * 60_000)).toMatchObject({ ok: false, code: 10015 });
    expect(checkTokenAlive(null)).toMatchObject({ ok: false, code: 10015 });
  });

  test("tokens are long, random, stored hashed; ack claimed once", async () => {
    const token = newInteractionToken();
    expect(token.startsWith("aW50ZXJhY3Rpb246")).toBeTrue();
    expect(isTokenShaped(token)).toBeTrue();
    expect(isTokenShaped("short")).toBeFalse();
    expect(isTokenShaped("../../etc")).toBeFalse();
    expect(newInteractionToken()).not.toBe(token);
    const kv = memoryKV();
    const store = new InteractionStore(kv);
    const state = base({ createdAt: Date.now() });
    await store.create(token, state);
    expect(await kv.get(`ix:t:${token}`)).toBeNull();
    expect(await kv.get(`ix:t:${hashToken(token)}`)).not.toBeNull();
    expect((await store.getByToken(token))?.id).toBe("ix1");
    expect(await store.getByToken(newInteractionToken())).toBeNull();
    expect(await store.claimAck("ix1", 4)).toBeTrue();
    expect(await store.claimAck("ix1", 4)).toBeFalse();
    await store.releaseAck("ix1");
    expect(await store.claimAck("ix1", 5)).toBeTrue();
  });

  test("autocomplete results are taken once; modals submit once", async () => {
    const store = new InteractionStore(memoryKV());
    await store.setAutocomplete("ix", [{ name: "a", value: "a" }]);
    expect(await store.takeAutocomplete("ix")).toHaveLength(1);
    expect(await store.takeAutocomplete("ix")).toBeNull();
    expect(await store.claimOnce("modal", "m1")).toBeTrue();
    expect(await store.claimOnce("modal", "m1")).toBeFalse();
    expect(await store.getRecord("eph", "../x")).toBeNull();
  });
});
