import { DocPage, P, H2, CodeBlock, Callout, Strong, InlineCode, Link2, CardGrid, Card } from "../DocPage";
import { Bot, Zap, Cable, KeyRound, Webhook, TerminalSquare, ShieldCheck, Users } from "lucide-react";

export default function IntroDoc() {
  return (
    <DocPage
      title="SerikaCord Developer Docs"
      description="Build bots, apps, and integrations on SerikaCord — a 1:1-compatible mirror of the Discord API. If you can build a Discord bot, you can build a SerikaCord bot."
    >
      <Callout type="info" title="Discord API Compatibility">
        SerikaCord speaks the same REST routes, gateway opcodes, OAuth2 flows, and data structures as
        Discord. Existing <InlineCode>discord.js</InlineCode> / <InlineCode>discord.py</InlineCode> bots
        run with a one-line base-URL change.
      </Callout>

      <H2 id="start-here">Start here</H2>
      <CardGrid>
        <Card href="/developers/docs/getting-started" title="Getting Started" icon={<Zap className="size-4" />}>
          Create an app, get a token, and ping a channel — end to end in five minutes.
        </Card>
        <Card href="/developers/docs/bots/overview" title="Bots Overview" icon={<Bot className="size-4" />}>
          What a bot is on SerikaCord, how it authenticates, and how it receives events.
        </Card>
        <Card href="/developers/docs/quick-start" title="Quick Start" icon={<TerminalSquare className="size-4" />}>
          Drop-in code for discord.js, discord.py, and raw HTTP.
        </Card>
        <Card href="/developers/docs/reference" title="API Reference" icon={<Cable className="size-4" />}>
          Every REST endpoint, versioned like Discord under <InlineCode>/v10</InlineCode>.
        </Card>
      </CardGrid>

      <H2 id="base-url">Base URL &amp; endpoints</H2>
      <P>Every request goes to the dedicated bot API host. The version lives in the path, just like Discord.</P>
      <CodeBlock lang="bash">{`REST     https://api.serika.chat/api/v10
Gateway  wss://api.serika.chat/api/v10/gateway
OAuth2   https://api.serika.chat/api/oauth2/authorize`}</CodeBlock>

      <H2 id="authentication">Authentication</H2>
      <P>
        Bot requests carry a bot token in the <InlineCode>Authorization</InlineCode> header with the{" "}
        <InlineCode>Bot</InlineCode> prefix. Grab one from the{" "}
        <Link2 href="/developers/applications">Developer Portal</Link2> → your app → <Strong>Bot</Strong>.
      </P>
      <CodeBlock lang="bash">Authorization: Bot YOUR_BOT_TOKEN_HERE</CodeBlock>

      <H2 id="explore">Explore</H2>
      <CardGrid>
        <Card href="/developers/docs/bots/slash-commands" title="Slash Commands" icon={<TerminalSquare className="size-4" />}>
          Register commands users can invoke with <InlineCode>/</InlineCode>.
        </Card>
        <Card href="/developers/docs/bots/interactions" title="Interactions" icon={<KeyRound className="size-4" />}>
          Receive signed command events over HTTP and respond.
        </Card>
        <Card href="/developers/docs/topics/gateway" title="Gateway" icon={<Cable className="size-4" />}>
          Real-time events over WebSocket — messages, members, presence.
        </Card>
        <Card href="/developers/docs/topics/oauth2" title="OAuth2" icon={<Users className="size-4" />}>
          Let users log in with SerikaCord and authorize your app.
        </Card>
        <Card href="/developers/docs/topics/webhooks" title="Webhooks" icon={<Webhook className="size-4" />}>
          Post messages into channels without a bot user.
        </Card>
        <Card href="/developers/docs/topics/permissions" title="Permissions" icon={<ShieldCheck className="size-4" />}>
          The bitwise permission system, identical to Discord.
        </Card>
      </CardGrid>

      <H2 id="support">Support</H2>
      <P>
        Stuck? The <Link2 href="/developers/docs/reference">API Reference</Link2> documents every route,
        and the <Link2 href="/developers/docs/topics/rate-limits">Rate Limits</Link2> page explains
        throttling. Bots that reach 100+ servers should read{" "}
        <Link2 href="/developers/docs/topics/bot-verification">Bot Verification</Link2>.
      </P>
    </DocPage>
  );
}
