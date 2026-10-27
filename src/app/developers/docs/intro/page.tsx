import { DocPage, P, H2, UL, CodeBlock, Callout, Strong, InlineCode, Link2, CardGrid, Card } from "../DocPage";
import { Bot, Zap, Cable, KeyRound, Webhook, TerminalSquare, ShieldCheck, Users } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Developer Documentation",
  description:
    "Get started with the SerikaCord API. Build Discord-compatible bots, apps, and integrations. Learn authentication, gateway events, webhooks, and slash commands.",
  path: "/developers/docs/intro",
  keywords: [
    "SerikaCord API docs",
    "bot documentation",
    "Discord-compatible API",
    "gateway",
    "webhooks",
    "OAuth2",
  ],
});

export default async function IntroDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("SerikaCord Developer Docs")}
      description={gt("Build bots, apps, and integrations on SerikaCord, whose bot API follows Discord v10. If you have built a Discord bot, most concepts carry over.")}
    >
      <Callout type="info" title={gt("Discord API Compatibility")}>
        {gt("SerikaCord follows Discord v10 for REST routes, gateway opcodes, OAuth2 flows and data structures: every non-deprecated route in Discord's API spec has a SerikaCord counterpart. The official")} <InlineCode>serika.js</InlineCode> {gt("SDK handles everything natively.")} {gt("New applications get Discord-style numeric ids, so discord.js and discord.py run unmodified once their REST, gateway and CDN base URLs point at SerikaCord. See Differences from Discord and the compatibility table for what behaves differently.")}
      </Callout>

      <H2 id="start-here">{gt("Start here")}</H2>
      <CardGrid>
        <Card href="/developers/docs/getting-started" title={gt("Getting Started")} icon={<Zap className="size-4" />}>
          {gt("Create an app, get a token, and ping a channel — end to end in five minutes.")}
        </Card>
        <Card href="/developers/docs/bots/overview" title={gt("Bots Overview")} icon={<Bot className="size-4" />}>
          {gt("What a bot is on SerikaCord, how it authenticates, and how it receives events.")}
        </Card>
        <Card href="/developers/docs/quick-start" title={gt("Quick Start")} icon={<TerminalSquare className="size-4" />}>
          {gt("Copy-paste code for serika.js, Python and raw HTTP.")}
        </Card>
        <Card href="/developers/docs/reference" title={gt("API Reference")} icon={<Cable className="size-4" />}>
          {gt("Every REST endpoint, versioned like Discord under")} <InlineCode>/v10</InlineCode>.
        </Card>
      </CardGrid>

      <H2 id="base-url">{gt("Base URL & endpoints")}</H2>
      <P>{gt("Every request goes to the dedicated bot API host. The version lives in the path, just like Discord.")}</P>
      <CodeBlock lang="bash">{`REST     https://api.serika.chat/api/v10
Gateway  wss://api.serika.chat/api/v10/gateway
OAuth2   https://api.serika.chat/api/oauth2/authorize`}</CodeBlock>

      <H2 id="authentication">{gt("Authentication")}</H2>
      <P>
        {gt("Bot requests carry a bot token in the")} <InlineCode>Authorization</InlineCode> {gt("header with the")}{" "}
        <InlineCode>Bot</InlineCode> {gt("prefix. Grab one from the")}{" "}
        <Link2 href="/developers/applications">{gt("Developer Portal")}</Link2> → {gt("your app →")} <Strong>{gt("Bot")}</Strong>.
      </P>
      <CodeBlock lang="bash">Authorization: Bot YOUR_BOT_TOKEN_HERE</CodeBlock>

      <H2 id="explore">{gt("Explore")}</H2>
      <CardGrid>
        <Card href="/developers/docs/bots/slash-commands" title={gt("Slash Commands")} icon={<TerminalSquare className="size-4" />}>
          {gt("Register commands users can invoke with")} <InlineCode>/</InlineCode>.
        </Card>
        <Card href="/developers/docs/bots/interactions" title={gt("Interactions")} icon={<KeyRound className="size-4" />}>
          {gt("Receive signed command events over HTTP and respond.")}
        </Card>
        <Card href="/developers/docs/topics/gateway" title={gt("Gateway")} icon={<Cable className="size-4" />}>
          {gt("Real-time events over WebSocket — messages, members, presence.")}
        </Card>
        <Card href="/developers/docs/topics/oauth2" title={gt("OAuth2")} icon={<Users className="size-4" />}>
          {gt("Let users log in with SerikaCord and authorize your app.")}
        </Card>
        <Card href="/developers/docs/topics/webhooks" title={gt("Webhooks")} icon={<Webhook className="size-4" />}>
          {gt("Post messages into channels without a bot user.")}
        </Card>
        <Card href="/developers/docs/topics/permissions" title={gt("Permissions")} icon={<ShieldCheck className="size-4" />}>
          {gt("The bitwise permission system, identical to Discord.")}
        </Card>
      </CardGrid>

      <H2 id="support">{gt("Support")}</H2>
      <P>
        {gt("Stuck? The")}{" "}<Link2 href="/developers/docs/reference">{gt("API Reference")}</Link2> {gt("documents every route, and the")}{" "}
        <Link2 href="/developers/docs/topics/rate-limits">{gt("Rate Limits")}</Link2> {gt("page explains throttling. Bots that reach 100+ servers should read")}{" "}
        <Link2 href="/developers/docs/topics/bot-verification">{gt("Bot Verification")}</Link2>.
      </P>

      <H2 id="what-is-serikacord">{gt("What is SerikaCord?")}</H2>
      <P>
        {gt("SerikaCord is a self-hosted, Discord-compatible chat platform. It implements the Discord v10 bot API — REST routes, Gateway WebSocket protocol, OAuth2 flows, and data structures — so that any bot built for Discord can be pointed at SerikaCord by changing two URLs:")}
      </P>
      <CodeBlock lang="javascript">{`// serika.js (npm @serikadev/serika.js) — zero config needed, baseURL is built in
import { SerikaClient, Intents } from "@serikadev/serika.js";

const client = new SerikaClient({ token: process.env.BOT_TOKEN });
const gateway = await client.connectGateway({
  intents: Intents.GUILDS | Intents.GUILD_MESSAGES,
  waitForReady: true,
});`}</CodeBlock>
      <P>
        {gt("The server runs a single-process architecture: a Next.js web app and the bot Gateway share the same port. The REST API is served by an")}{" "}<InlineCode>Elysia</InlineCode> {gt("router under")}{" "}
        <InlineCode>/api/v10/*</InlineCode>, {gt("and the Gateway WebSocket is upgraded at")}{" "}
        <InlineCode>/api/v10/gateway</InlineCode>. {gt("For horizontal scaling, a standalone Gateway server")}
        (<InlineCode>scripts/gateway.ts</InlineCode>) {gt("can run separately with Redis-based event fan-out.")}
      </P>

      <H2 id="features">{gt("Supported features")}</H2>
      <P>{gt("The SerikaCord bot API implements the following Discord v10 features:")}</P>
      <UL>
        <li>{gt("Bot tokens and OAuth2 (authorization code, client credentials, refresh tokens, bot install, OpenID Connect, gdm.join, guilds.join)")}</li>
        <li>{gt("Users, guilds, channels, roles, members, bans, prune, onboarding, welcome screen, widget, templates, join requests and incident actions")}</li>
        <li>{gt("Messages with files, replies, forwards, polls, components v1 and v2, reactions, pins, typing and guild message search")}</li>
        <li>{gt("Threads and forums, including forum posts, tags and thread search")}</li>
        <li>{gt("Emojis, stickers, application emojis and the server soundboard")}</li>
        <li>{gt("Webhooks, including Slack- and GitHub-compatible execute")}</li>
        <li>{gt("Audit log, auto moderation and scheduled events")}</li>
        <li>{gt("Application commands, interactions (gateway or Ed25519-signed HTTP), autocomplete, modals and context menus")}</li>
        <li>{gt("Voice states, stage instances and voice channel status (bots can't send or receive audio)")}</li>
        <li>{gt("Linked roles metadata, lobbies and invite target users")}</li>
        <li>{gt("Gateway: zlib-stream compression, resume with replay, sharding, presence, op 8 member chunks, intents and Discord's close codes and rate limits")}</li>
        <li>{gt("Redis-based cross-instance event fan-out for multi-server deployments")}</li>
      </UL>
    </DocPage>
  );
}
