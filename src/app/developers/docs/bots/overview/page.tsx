import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, CardGrid, Card, Table } from "../../DocPage";
import { Zap, TerminalSquare, Cable, KeyRound } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Bots Overview",
  description:
    "Learn how SerikaCord bots work: applications, bot users, tokens, intents, public keys, and the gateway. A Discord-compatible bot guide for SerikaCord developers.",
  path: "/developers/docs/bots/overview",
  keywords: [
    "SerikaCord bots",
    "bot user",
    "bot token",
    "gateway intents",
    "Discord bot compatibility",
  ],
});

export default async function BotsOverviewDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Bots Overview")}
      description={gt("A bot is an automated user backed by an application. It authenticates with a bot token, calls the REST API, and receives real-time events over the gateway.")}
    >
      <P>
        {gt("On SerikaCord, every bot is powered by an")}{" "}<Strong>{gt("application")}</Strong> {gt("you create in the")}{" "}
        <Link2 href="/developers/applications">{gt("Developer Portal")}</Link2>. {gt("Enabling a bot on that application provisions a dedicated bot")}{" "}<Strong>{gt("user")}</Strong>, {gt("a secret")}{" "}<Strong>{gt("token")}</Strong>,
        {gt("and an")}{" "}<Strong>{gt("Ed25519 keypair")}</Strong> {gt("used to verify interaction requests.")}
      </P>

      <Callout type="info" title={gt("Same mental model as Discord")}>
        {gt("Application → Bot user → Token → Gateway + REST. If you've internalised how Discord bots work, nothing here is new — only the host name changes to")}{" "}
        <InlineCode>api.serika.chat</InlineCode>.
      </Callout>

      <H2 id="anatomy">{gt("Anatomy of a bot")}</H2>
      <Table headers={[gt("Component"), gt("Description"), gt("Where to find it")]} rows={[
        [gt("Application"), gt("The top-level container. Holds name, icon, description, OAuth2 config, and slash commands."), gt("Developer Portal → your app")],
        [gt("Bot User"), gt("A real user account with bot: true. Appears in member lists and authors messages."), gt("Created when you enable the bot on the Bot tab")],
        [gt("Bot Token"), gt("Secret string for API authentication. Passed as Authorization: Bot '<token>'."), gt("Bot tab → Reset Token")],
        [gt("Public Key"), gt("Ed25519 key used to verify signed interaction webhooks."), gt("Bot tab → Public Key")],
        [gt("Intents"), gt("Bitwise flags that control which Gateway events the bot receives."), gt("Bot tab → Privileged Gateway Intents + code")],
      ]} />

      <H2 id="two-ways">{gt("Two ways a bot receives events")}</H2>
      <CardGrid>
        <Card href="/developers/docs/topics/gateway" title={gt("Gateway (WebSocket)")} icon={<Cable className="size-4" />}>
          {gt("A persistent connection that streams events like")} <InlineCode>MESSAGE_CREATE</InlineCode> {gt("and")}{" "}
          <InlineCode>GUILD_MEMBER_ADD</InlineCode> {gt("as they happen. This is how libraries like serika.js run.")}
        </Card>
        <Card href="/developers/docs/bots/interactions" title={gt("Interactions (HTTP)")} icon={<KeyRound className="size-4" />}>
          {gt("A signed HTTP POST we send to your Interactions Endpoint URL whenever a user invokes a command. No persistent connection required.")}
        </Card>
      </CardGrid>
      <P>
        {gt("You can use both simultaneously — many bots use the Gateway for message events and HTTP for slash command interactions.")}
      </P>

      <H2 id="authentication">{gt("Authentication")}</H2>
      <P>{gt("Every REST call includes your bot token:")}</P>
      <CodeBlock lang="bash">{`curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/users/@me`}</CodeBlock>
      <P>
        {gt("The token can be prefixed with")} <InlineCode>Bot </InlineCode> {gt("or sent bare — both are accepted. Internally, SerikaCord looks up the")} <InlineCode>Application</InlineCode> {gt("by")}{" "}
        <InlineCode>botToken</InlineCode>, {gt("then resolves the associated bot")} <InlineCode>User</InlineCode>.
      </P>
      <P>{gt("For the Gateway, the token goes in the")} <InlineCode>IDENTIFY</InlineCode> {gt("payload:")}</P>
      <CodeBlock lang="json">{`{
  "op": 2,
  "d": {
    "token": "Bot YOUR_TOKEN",
    "intents": 513
  }
}`}</CodeBlock>
      <Callout type="danger" title={gt("Treat your token like a password")}>
        {gt("Anyone with your token controls your bot. Never commit it. If it leaks, reset it from the")}{" "}
        <Strong>{gt("Bot")}</Strong> {gt("tab — the old token stops working immediately.")}
      </Callout>

      <H2 id="intents">{gt("Gateway intents")}</H2>
      <P>
        {gt("Intents let you subscribe to only the events you need. Pass them in the gateway")}{" "}
        <InlineCode>IDENTIFY</InlineCode> {gt("payload. Privileged intents (Message Content, Server Members, Presence) are toggled per-application on the")}{" "}<Strong>{gt("Bot")}</Strong> {gt("tab.")}
      </P>
      <H3 id="common-intents">{gt("Common intents")}</H3>
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
      <Callout type="warning" title={gt("Privileged intents require verification")}>
        {gt("Bots in 100+ servers must be")}{" "}
        <Link2 href="/developers/docs/topics/bot-verification">{gt("verified")}</Link2> {gt("to use privileged intents. Enable them in the Developer Portal and justify why your bot needs them.")}
      </Callout>

      <H2 id="permissions">{gt("Permissions")}</H2>
      <P>
        {gt("What a bot can do inside a server is governed by the same bitwise permission system as Discord. You request a permission integer at install time; server admins can adjust roles afterward. See")}{" "}
        <Link2 href="/developers/docs/topics/permissions">{gt("Permissions")}</Link2>.
      </P>

      <H2 id="rate-limits">{gt("Rate Limits")}</H2>
      <P>
        {gt("The API enforces per-route, per-bot rate limits. Responses include rate limit headers:")}
      </P>
      <Table headers={[gt("Header"), gt("Description")]} rows={[
        ["X-RateLimit-Limit", gt("Maximum requests per bucket")],
        ["X-RateLimit-Remaining", gt("Remaining requests in current window")],
        ["X-RateLimit-Reset", gt("Unix timestamp when the bucket resets")],
        ["X-RateLimit-Reset-After", gt("Seconds until reset")],
        ["X-RateLimit-Bucket", gt("Bucket identifier")],
      ]} />
      <P>
        {gt("When rate limited, the API returns")}{" "}<InlineCode>429 Too Many Requests</InlineCode> {gt("with a")}{" "}
        <InlineCode>retry_after</InlineCode> {gt("field. See")}{" "}
        <Link2 href="/developers/docs/topics/rate-limits">{gt("Rate Limits")}</Link2> {gt("for details.")}
      </P>

      <H2 id="bot-vs-user">{gt("Bot Users vs Regular Users")}</H2>
      <Table headers={[gt("Property"), gt("Regular User"), gt("Bot User")]} rows={[
        [gt("bot field"), "false", "true"],
        [gt("discriminator"), gt("varies"), "0"],
        [gt("verified"), gt("varies"), "true"],
        [gt("Can join servers"), gt("Yes (up to 100/200)"), gt("Yes (via OAuth2 invite)")],
        [gt("Can use OAuth2 user endpoints"), gt("Yes"), gt("Limited (users/@me, users/@me/channels)")],
        [gt("Can be DM'd"), gt("Yes"), gt("Yes (if DM channel exists)")],
        [gt("Rate limits"), gt("Per-user"), gt("Per-bot (typically higher)")],
      ]} />

      <H2 id="next">{gt("Next steps")}</H2>
      <CardGrid>
        <Card href="/developers/docs/getting-started" title={gt("Getting Started")} icon={<Zap className="size-4" />}>
          {gt("Build and run your first bot step by step.")}
        </Card>
        <Card href="/developers/docs/bots/slash-commands" title={gt("Slash Commands")} icon={<TerminalSquare className="size-4" />}>
          {gt("Register and handle")} <InlineCode>/</InlineCode> {gt("commands.")}
        </Card>
      </CardGrid>
    </DocPage>
  );
}
