import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Table, UL } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";

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

export default function SlashCommandsDoc() {
  return (
    <DocPage
      title="Slash Commands Reference"
      description="SerikaCord includes a set of built-in slash commands available to all users. Commands are grouped by category: Moderation, Utility, and Fun."
    >
      <Callout type="info" title="Using commands">
        Type <InlineCode>/</InlineCode> in any message bar to see the autocomplete list. Some commands
        are <Strong>server-only</Strong> and won't appear in DMs. Commands with required parameters
        are marked with <InlineCode>&lt;angle brackets&gt;</InlineCode>; optional ones use
        <InlineCode>[square brackets]</InlineCode>.
      </Callout>

      {/* ── Moderation ── */}
      <H2 id="moderation">Moderation</H2>

      <H3 id="clear">/clear</H3>
      <P>Bulk-deletes recent messages in the current channel. You can target a specific user.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["amount", "No", "Number of messages to clear (1–100). Default: 100"],
          ["user", "No", "Only clear messages from this user (mention or 'all')"],
        ]}
      />
      <CodeBlock lang="bash">/clear
/clear 50
/clear @username
/clear 20 @spammer</CodeBlock>

      <H3 id="kick">/kick</H3>
      <P>Removes a member from the server. They can rejoin with an invite.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "Yes", "The member to kick (mention)"],
          ["reason", "No", "Reason shown in the audit log"],
        ]}
      />
      <CodeBlock lang="bash">/kick @troublemaker
/kick @troublemaker Spamming</CodeBlock>

      <H3 id="ban">/ban</H3>
      <P>Permanently bans a member. They cannot rejoin unless unbanned.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "Yes", "The member to ban (mention)"],
          ["reason", "No", "Reason shown in the audit log"],
        ]}
      />
      <CodeBlock lang="bash">/ban @malicious
/ban @malicious Repeated violations</CodeBlock>

      <H3 id="unban">/unban</H3>
      <P>Lifts a ban so the user can rejoin the server.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["userId", "Yes", "The ID of the banned user"],
        ]}
      />
      <CodeBlock lang="bash">/unban 123456789012345678</CodeBlock>

      <H3 id="timeout">/timeout</H3>
      <P>Mutes a member for a set duration. They can still read messages but can't send any.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "Yes", "The member to timeout (mention)"],
          ["duration", "Yes", "How long (60s, 5m, 1h, 1d, 7d, 28d, etc.)"],
          ["reason", "No", "Reason for the timeout"],
        ]}
      />
      <CodeBlock lang="bash">/timeout @noisy 10m
/timeout @noisy 1h Being disruptive</CodeBlock>

      <H3 id="warn">/warn</H3>
      <P>Sends a formal DM warning to the member. Logged for moderators.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "Yes", "The member to warn (mention)"],
          ["reason", "Yes", "Why the member is being warned"],
        ]}
      />
      <CodeBlock lang="bash">/warn @user Inappropriate language</CodeBlock>

      <H3 id="slowmode">/slowmode</H3>
      <P>Limits how fast members can send messages in the current channel.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["duration", "Yes", "Delay or 'off' to disable (5s, 10s, 30s, 1m, 5m, 15m, 1h, 6h)"],
        ]}
      />
      <CodeBlock lang="bash">/slowmode 30s
/slowmode 5m
/slowmode off</CodeBlock>

      {/* ── Utility ── */}
      <H2 id="utility">Utility</H2>

      <H3 id="nick">/nick</H3>
      <P>Changes your nickname in the current server. Leave empty to reset to your username.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["nickname", "No", "Your new nickname (empty = reset)"],
        ]}
      />
      <CodeBlock lang="bash">/nick CoolName
/nick</CodeBlock>

      <H3 id="serverinfo">/serverinfo</H3>
      <P>Displays information about the current server: creation date, member count, channel count, and more.</P>
      <CodeBlock lang="bash">/serverinfo</CodeBlock>

      <H3 id="userinfo">/userinfo</H3>
      <P>Shows join date, roles, and account age for a member. Defaults to you.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "No", "The member to inspect (mention, defaults to you)"],
        ]}
      />
      <CodeBlock lang="bash">/userinfo
/userinfo @someone</CodeBlock>

      <H3 id="avatar">/avatar</H3>
      <P>Displays a member's full-resolution avatar. Defaults to you.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["user", "No", "The member whose avatar to show (defaults to you)"],
        ]}
      />
      <CodeBlock lang="bash">/avatar
/avatar @someone</CodeBlock>

      <H3 id="roll">/roll</H3>
      <P>Rolls a die. Specify a number of sides, or default to 6.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["sides", "No", "Number of sides on the die (default: 6)"],
        ]}
      />
      <CodeBlock lang="bash">/roll
/roll 20
/roll 100</CodeBlock>

      {/* ── Fun ── */}
      <H2 id="fun">Fun</H2>

      <H3 id="tts">/tts</H3>
      <P>
        Sends a message that is spoken aloud using text-to-speech. Supports a rich modifier system
        for multi-speaker dialogue, speed control, volume amplification, bass boost, ear rape,
        AI voices, accents, and sound triggers.
      </P>
      <Callout type="info" title="Full TTS documentation">
        See the <Link2 href="/developers/docs/topics/tts">TTS Guide</Link2> for a complete reference
        of all modifiers, examples, and technical details.
      </Callout>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["message", "Yes", "Text to speak with optional inline modifiers"],
        ]}
      />
      <CodeBlock lang="bash">/tts Hello world
/tts [f][2x] Hey! [m] What's up?
/tts [fish:miku] [vol:EAR] MAXIMUM POWER
/tts [steven] The universe is governed by physics</CodeBlock>
      <P>Key modifiers:</P>
      <UL>
        <li><InlineCode>[f]</InlineCode> / <InlineCode>[m]</InlineCode> — female / male voice</li>
        <li><InlineCode>[2x]</InlineCode> / <InlineCode>[turbo]</InlineCode> / <InlineCode>[slow]</InlineCode> — speed control</li>
        <li><InlineCode>[vol:50]</InlineCode> to <InlineCode>[vol:500]</InlineCode> — volume (0–500%)</li>
        <li><InlineCode>[vol:BASS]</InlineCode> — bass-boosted audio</li>
        <li><InlineCode>[vol:EAR]</InlineCode> — extreme loudness + distortion (still intelligible)</li>
        <li><InlineCode>[steven]</InlineCode> / <InlineCode>[robot]</InlineCode> / <InlineCode>[narrator]</InlineCode> — voice personas</li>
        <li><InlineCode>[f-japanese]</InlineCode> / <InlineCode>[m-german]</InlineCode> — accent/language voices</li>
        <li><InlineCode>[fish:miku]</InlineCode> — FishAudio AI voice</li>
      </UL>

      <H3 id="8ball">/8ball</H3>
      <P>Ask the magic 8-ball a yes/no question.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["question", "Yes", "Your yes/no question"],
        ]}
      />
      <CodeBlock lang="bash">/8ball Will I win the lottery?</CodeBlock>

      <H3 id="me">/me</H3>
      <P>Sends an action message displayed in italics (e.g. *waves hello*).</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["action", "Yes", "The action to perform"],
        ]}
      />
      <CodeBlock lang="bash">/me waves hello
/me dances happily</CodeBlock>

      <H3 id="shrug">/shrug</H3>
      <P>Appends ¯\_(ツ)_/¯ to your message. Empty message = just the shrug.</P>
      <Table
        headers={["Parameter", "Required", "Description"]}
        rows={[
          ["message", "No", "Optional message before the shrug"],
        ]}
      />
      <CodeBlock lang="bash">/shrug
/shrug I don't know</CodeBlock>

      <H2 id="summary">Quick reference</H2>
      <Table
        headers={["Command", "Category", "Server-only", "Description"]}
        rows={[
          ["/clear", "Moderation", "Yes", "Bulk-delete messages"],
          ["/kick", "Moderation", "Yes", "Kick a member"],
          ["/ban", "Moderation", "Yes", "Ban a member"],
          ["/unban", "Moderation", "Yes", "Revoke a ban"],
          ["/timeout", "Moderation", "Yes", "Temporarily mute a member"],
          ["/warn", "Moderation", "Yes", "Send a formal warning"],
          ["/slowmode", "Moderation", "Yes", "Set channel slowmode"],
          ["/nick", "Utility", "Yes", "Change your nickname"],
          ["/serverinfo", "Utility", "Yes", "Show server info"],
          ["/userinfo", "Utility", "Yes", "Show member info"],
          ["/avatar", "Utility", "Yes", "Show full avatar"],
          ["/roll", "Fun", "No", "Roll a die"],
          ["/tts", "Fun", "No", "Text-to-speech with modifiers"],
          ["/8ball", "Fun", "No", "Magic 8-ball"],
          ["/me", "Fun", "No", "Action message"],
          ["/shrug", "Fun", "No", "Shrug emoji"],
        ]}
      />
    </DocPage>
  );
}
