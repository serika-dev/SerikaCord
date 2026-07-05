import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, CardGrid, Card } from "../../DocPage";
import { Zap, TerminalSquare, Cable, KeyRound } from "lucide-react";

export default function BotsOverviewDoc() {
  return (
    <DocPage
      title="Bots Overview"
      description="A bot is an automated user backed by an application. It authenticates with a bot token, calls the REST API, and receives real-time events over the gateway."
    >
      <P>
        On SerikaCord, every bot is powered by an <Strong>application</Strong> you create in the{" "}
        <Link2 href="/developers/applications">Developer Portal</Link2>. Enabling a bot on that
        application provisions a dedicated bot <Strong>user</Strong>, a secret <Strong>token</Strong>,
        and an <Strong>Ed25519 keypair</Strong> used to verify interaction requests.
      </P>

      <Callout type="info" title="Same mental model as Discord">
        Application → Bot user → Token → Gateway + REST. If you&apos;ve internalised how Discord bots work,
        nothing here is new — only the host name changes to{" "}
        <InlineCode>api.serika.chat</InlineCode>.
      </Callout>

      <H2 id="anatomy">Anatomy of a bot</H2>
      <UL>
        <li><Strong>Application</Strong> — the top-level identity (name, icon, OAuth2 config, commands).</li>
        <li><Strong>Bot user</Strong> — the account that appears in servers and authors messages.</li>
        <li><Strong>Bot token</Strong> — the secret used in the <InlineCode>Authorization: Bot …</InlineCode> header.</li>
        <li><Strong>Public key</Strong> — lets you verify the signatures on interaction POSTs we send you.</li>
        <li><Strong>Intents</Strong> — a bitmask declaring which gateway events you want to receive.</li>
      </UL>

      <H2 id="two-ways">Two ways a bot receives events</H2>
      <CardGrid>
        <Card href="/developers/docs/topics/gateway" title="Gateway (WebSocket)" icon={<Cable className="size-4" />}>
          A persistent connection that streams events like <InlineCode>MESSAGE_CREATE</InlineCode> and{" "}
          <InlineCode>GUILD_MEMBER_ADD</InlineCode> as they happen. This is how libraries like discord.js run.
        </Card>
        <Card href="/developers/docs/bots/interactions" title="Interactions (HTTP)" icon={<KeyRound className="size-4" />}>
          A signed HTTP POST we send to your Interactions Endpoint URL whenever a user invokes a command.
          No persistent connection required.
        </Card>
      </CardGrid>

      <H2 id="authentication">Authentication</H2>
      <P>Every REST call includes your bot token:</P>
      <CodeBlock lang="bash">{`curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/users/@me`}</CodeBlock>
      <Callout type="danger" title="Treat your token like a password">
        Anyone with your token controls your bot. Never commit it. If it leaks, reset it from the{" "}
        <Strong>Bot</Strong> tab — the old token stops working immediately.
      </Callout>

      <H2 id="intents">Gateway intents</H2>
      <P>
        Intents let you subscribe to only the events you need. Pass them in the gateway{" "}
        <InlineCode>IDENTIFY</InlineCode> payload. Privileged intents (Message Content, Server Members,
        Presence) are toggled per-application on the <Strong>Bot</Strong> tab.
      </P>
      <H3 id="common-intents">Common intents</H3>
      <CodeBlock lang="javascript">{`const Intents = {
  GUILDS:            1 << 0,
  GUILD_MEMBERS:     1 << 1,   // privileged
  GUILD_MODERATION:  1 << 2,
  GUILD_MESSAGES:    1 << 9,
  DIRECT_MESSAGES:   1 << 12,
  MESSAGE_CONTENT:   1 << 15,  // privileged
};

// Guilds + guild messages + message content
const intents = Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.MESSAGE_CONTENT;`}</CodeBlock>

      <H2 id="permissions">Permissions</H2>
      <P>
        What a bot can do inside a server is governed by the same bitwise permission system as Discord.
        You request a permission integer at install time; server admins can adjust roles afterward. See{" "}
        <Link2 href="/developers/docs/topics/permissions">Permissions</Link2>.
      </P>

      <H2 id="next">Next steps</H2>
      <CardGrid>
        <Card href="/developers/docs/getting-started" title="Getting Started" icon={<Zap className="size-4" />}>
          Build and run your first bot step by step.
        </Card>
        <Card href="/developers/docs/bots/slash-commands" title="Slash Commands" icon={<TerminalSquare className="size-4" />}>
          Register and handle <InlineCode>/</InlineCode> commands.
        </Card>
      </CardGrid>
    </DocPage>
  );
}
