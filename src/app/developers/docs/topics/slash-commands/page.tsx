import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Table, UL } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Slash Commands Reference",
  description:
    "Complete reference for all built-in slash commands in SerikaCord. Moderation, utility, and fun commands with usage, parameters, and examples.",
  path: "/developers/docs/topics/slash-commands",
  keywords: [
    "SerikaCord slash commands",
    "command reference",
    "moderation commands",
    "TTS command",
  ],
});

export default async function SlashCommandsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Slash Commands Reference")}
      description={gt("SerikaCord includes a set of built-in slash commands available to all users. Commands are grouped by category: Moderation, Utility, and Fun.")}
    >
      <Callout type="info" title={gt("Using commands")}>
        {gt("Type")}{" "}<InlineCode>/</InlineCode> {gt("in any message bar to see the autocomplete list. Some commands are")}{" "}<Strong>{gt("server-only")}</Strong> {gt("and won't appear in DMs. Commands with required parameters are marked with")}{" "}<InlineCode>&lt;angle brackets&gt;</InlineCode>; {gt("optional ones use")}
        <InlineCode>[square brackets]</InlineCode>.
      </Callout>

      {/* ── Moderation ── */}
      <H2 id="moderation">{gt("Moderation")}</H2>

      <H3 id="clear">/clear</H3>
      <P>{gt("Bulk-deletes recent messages in the current channel. You can target a specific user.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["amount", gt("No"), gt("Number of messages to clear (1–100). Default: 100")],
          ["user", gt("No"), gt("Only clear messages from this user (mention or 'all')")],
        ]}
      />
      <CodeBlock lang="bash">/clear
/clear 50
/clear @username
/clear 20 @spammer</CodeBlock>

      <H3 id="kick">/kick</H3>
      <P>{gt("Removes a member from the server. They can rejoin with an invite.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("Yes"), gt("The member to kick (mention)")],
          ["reason", gt("No"), gt("Reason shown in the audit log")],
        ]}
      />
      <CodeBlock lang="bash">/kick @troublemaker
/kick @troublemaker Spamming</CodeBlock>

      <H3 id="ban">/ban</H3>
      <P>{gt("Permanently bans a member. They cannot rejoin unless unbanned.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("Yes"), gt("The member to ban (mention)")],
          ["reason", gt("No"), gt("Reason shown in the audit log")],
        ]}
      />
      <CodeBlock lang="bash">/ban @malicious
/ban @malicious Repeated violations</CodeBlock>

      <H3 id="unban">/unban</H3>
      <P>{gt("Lifts a ban so the user can rejoin the server.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["userId", gt("Yes"), gt("The ID of the banned user")],
        ]}
      />
      <CodeBlock lang="bash">/unban 123456789012345678</CodeBlock>

      <H3 id="timeout">/timeout</H3>
      <P>{gt("Mutes a member for a set duration. They can still read messages but can't send any.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("Yes"), gt("The member to timeout (mention)")],
          ["duration", gt("Yes"), gt("How long (60s, 5m, 1h, 1d, 7d, 28d, etc.)")],
          ["reason", gt("No"), gt("Reason for the timeout")],
        ]}
      />
      <CodeBlock lang="bash">/timeout @noisy 10m
/timeout @noisy 1h Being disruptive</CodeBlock>

      <H3 id="warn">/warn</H3>
      <P>{gt("Sends a formal DM warning to the member. Logged for moderators.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("Yes"), gt("The member to warn (mention)")],
          ["reason", gt("Yes"), gt("Why the member is being warned")],
        ]}
      />
      <CodeBlock lang="bash">/warn @user Inappropriate language</CodeBlock>

      <H3 id="slowmode">/slowmode</H3>
      <P>{gt("Limits how fast members can send messages in the current channel.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["duration", gt("Yes"), gt("Delay or 'off' to disable (5s, 10s, 30s, 1m, 5m, 15m, 1h, 6h)")],
        ]}
      />
      <CodeBlock lang="bash">/slowmode 30s
/slowmode 5m
/slowmode off</CodeBlock>

      {/* ── Utility ── */}
      <H2 id="utility">{gt("Utility")}</H2>

      <H3 id="nick">/nick</H3>
      <P>{gt("Changes your nickname in the current server. Leave empty to reset to your username.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["nickname", gt("No"), gt("Your new nickname (empty = reset)")],
        ]}
      />
      <CodeBlock lang="bash">/nick CoolName
/nick</CodeBlock>

      <H3 id="serverinfo">/serverinfo</H3>
      <P>{gt("Displays information about the current server: creation date, member count, channel count, and more.")}</P>
      <CodeBlock lang="bash">/serverinfo</CodeBlock>

      <H3 id="userinfo">/userinfo</H3>
      <P>{gt("Shows join date, roles, and account age for a member. Defaults to you.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("No"), gt("The member to inspect (mention, defaults to you)")],
        ]}
      />
      <CodeBlock lang="bash">/userinfo
/userinfo @someone</CodeBlock>

      <H3 id="avatar">/avatar</H3>
      <P>{gt("Displays a member's full-resolution avatar. Defaults to you.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["user", gt("No"), gt("The member whose avatar to show (defaults to you)")],
        ]}
      />
      <CodeBlock lang="bash">/avatar
/avatar @someone</CodeBlock>

      <H3 id="roll">/roll</H3>
      <P>{gt("Rolls a die. Specify a number of sides, or default to 6.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["sides", gt("No"), gt("Number of sides on the die (default: 6)")],
        ]}
      />
      <CodeBlock lang="bash">/roll
/roll 20
/roll 100</CodeBlock>

      {/* ── Fun ── */}
      <H2 id="fun">{gt("Fun")}</H2>

      <H3 id="tts">/tts</H3>
      <P>
        {gt("Sends a message that is spoken aloud using text-to-speech. Supports a rich modifier system for multi-speaker dialogue, speed control, volume amplification, bass boost, ear rape, AI voices, accents, and sound triggers.")}
      </P>
      <Callout type="info" title={gt("Full TTS documentation")}>
        {gt("See the")}{" "}<Link2 href="/developers/docs/topics/tts">{gt("TTS Guide")}</Link2> {gt("for a complete reference of all modifiers, examples, and technical details.")}
      </Callout>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["message", gt("Yes"), gt("Text to speak with optional inline modifiers")],
        ]}
      />
      <CodeBlock lang="bash">/tts Hello world
/tts [f][2x] Hey! [m] What's up?
/tts [fish:miku] [vol:EAR] MAXIMUM POWER
/tts [steven] The universe is governed by physics</CodeBlock>
      <P>{gt("Key modifiers:")}</P>
      <UL>
        <li><InlineCode>[f]</InlineCode> / <InlineCode>[m]</InlineCode> — {gt("female / male voice")}</li>
        <li><InlineCode>[2x]</InlineCode> / <InlineCode>[turbo]</InlineCode> / <InlineCode>[slow]</InlineCode> — {gt("speed control")}</li>
        <li><InlineCode>[vol:50]</InlineCode> {gt("to")} <InlineCode>[vol:500]</InlineCode> — {gt("volume (0–500%)")}</li>
        <li><InlineCode>[vol:BASS]</InlineCode> — {gt("bass-boosted audio")}</li>
        <li><InlineCode>[vol:EAR]</InlineCode> — {gt("extreme loudness + distortion (still intelligible)")}</li>
        <li><InlineCode>[steven]</InlineCode> / <InlineCode>[robot]</InlineCode> / <InlineCode>[narrator]</InlineCode> — {gt("voice personas")}</li>
        <li><InlineCode>[f-japanese]</InlineCode> / <InlineCode>[m-german]</InlineCode> — {gt("accent/language voices")}</li>
        <li><InlineCode>[fish:miku]</InlineCode> — {gt("FishAudio AI voice")}</li>
      </UL>

      <H3 id="8ball">/8ball</H3>
      <P>{gt("Ask the magic 8-ball a yes/no question.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["question", gt("Yes"), gt("Your yes/no question")],
        ]}
      />
      <CodeBlock lang="bash">/8ball Will I win the lottery?</CodeBlock>

      <H3 id="me">/me</H3>
      <P>{gt("Sends an action message displayed in italics (e.g. *waves hello*).")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["action", gt("Yes"), gt("The action to perform")],
        ]}
      />
      <CodeBlock lang="bash">/me waves hello
/me dances happily</CodeBlock>

      <H3 id="shrug">/shrug</H3>
      <P>{gt("Appends ¯\_(ツ)_/¯ to your message. Empty message = just the shrug.")}</P>
      <Table
        headers={[gt("Parameter"), gt("Required"), gt("Description")]}
        rows={[
          ["message", gt("No"), gt("Optional message before the shrug")],
        ]}
      />
      <CodeBlock lang="bash">/shrug
/shrug I don't know</CodeBlock>

      <H2 id="summary">{gt("Quick reference")}</H2>
      <Table
        headers={[gt("Command"), gt("Category"), gt("Server-only"), gt("Description")]}
        rows={[
          ["/clear", gt("Moderation"), gt("Yes"), gt("Bulk-delete messages")],
          ["/kick", gt("Moderation"), gt("Yes"), gt("Kick a member")],
          ["/ban", gt("Moderation"), gt("Yes"), gt("Ban a member")],
          ["/unban", gt("Moderation"), gt("Yes"), gt("Revoke a ban")],
          ["/timeout", gt("Moderation"), gt("Yes"), gt("Temporarily mute a member")],
          ["/warn", gt("Moderation"), gt("Yes"), gt("Send a formal warning")],
          ["/slowmode", gt("Moderation"), gt("Yes"), gt("Set channel slowmode")],
          ["/nick", gt("Utility"), gt("Yes"), gt("Change your nickname")],
          ["/serverinfo", gt("Utility"), gt("Yes"), gt("Show server info")],
          ["/userinfo", gt("Utility"), gt("Yes"), gt("Show member info")],
          ["/avatar", gt("Utility"), gt("Yes"), gt("Show full avatar")],
          ["/roll", gt("Fun"), gt("No"), gt("Roll a die")],
          ["/tts", gt("Fun"), gt("No"), gt("Text-to-speech with modifiers")],
          ["/8ball", gt("Fun"), gt("No"), gt("Magic 8-ball")],
          ["/me", gt("Fun"), gt("No"), gt("Action message")],
          ["/shrug", gt("Fun"), gt("No"), gt("Shrug emoji")],
        ]}
      />
    </DocPage>
  );
}
