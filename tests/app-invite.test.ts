import { describe, expect, test } from "bun:test";
import {
  appInviteDtoFields,
  appInviteEmail,
  appInviteFromMessage,
  appInviteMarker,
  appInviteText,
  isAppInviteApp,
} from "../src/lib/social/appInvite";
import { isStandaloneRow } from "../src/lib/chat/messages";

describe("app invites", () => {
  test("only known apps are accepted (callers can't pick a URL)", () => {
    expect(isAppInviteApp("serikatrack")).toBe(true);
    expect(isAppInviteApp("toString")).toBe(false);
    expect(isAppInviteApp("https://evil.example")).toBe(false);
  });

  test("a stored invite row becomes an app_invite DTO with the fixed link", () => {
    const row = { type: "system", interaction: appInviteMarker("serikatrack") };
    const appInvite = { app: "serikatrack", name: "SerikaTrack", url: "https://track.serika.moe", tagline: "Track the anime and manga you watch and read, and see what your friends are into." };
    expect(appInviteFromMessage(row)).toEqual(appInvite);
    // content is left alone: older clients show the stored sentence.
    expect(appInviteDtoFields(row)).toEqual({ type: "app_invite", interaction: undefined, appInvite });
  });

  test("the stored sentence names the inviter, the app, what it is and the link", () => {
    const text = appInviteText("serikatrack", "Pika");
    expect(text.startsWith("Pika invited you to SerikaTrack!")).toBe(true);
    expect(text).toContain("anime and manga");
    expect(text).toContain("https://track.serika.moe");
  });

  test("other rows are left alone", () => {
    expect(appInviteDtoFields({ type: "default", interaction: appInviteMarker("serikatrack") })).toEqual({});
    expect(appInviteDtoFields({ type: "system", interaction: { kind: "app_invite", app: "nope" } })).toEqual({});
    expect(appInviteDtoFields({ type: "system", interaction: null })).toEqual({});
  });

  test("the row is drawn as a one-line notice", () => {
    expect(isStandaloneRow({ type: "app_invite" })).toBe(true);
  });

  test("the email escapes names", () => {
    const { subject, html, text } = appInviteEmail("serikatrack", "<b>Mallory</b>", "Bob & co");
    expect(subject).toBe("<b>Mallory</b> invited you to SerikaTrack");
    expect(html).toContain("&lt;b&gt;Mallory&lt;/b&gt;");
    expect(html).not.toContain("<b>Mallory</b>");
    expect(html).toContain("Bob &amp; co");
    expect(text).toContain("https://track.serika.moe");
  });
});
