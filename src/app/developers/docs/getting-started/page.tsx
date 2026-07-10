import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Steps, Step, Table } from "../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Getting Started with the SerikaCord API",
  description:
    "Create your first SerikaCord bot in minutes. Set up an application, enable a bot user, get your token, and send your first message with discord.js or any Discord-compatible library.",
  path: "/developers/docs/getting-started",
  keywords: [
    "SerikaCord bot tutorial",
    "create bot",
    "bot token",
    "discord.js SerikaCord",
    "API getting started",
  ],
});

export default async function GettingStartedDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Getting Started")}
      description={gt("From zero to a running bot that replies in a channel. This walkthrough uses discord.js, but any Discord-compatible library works the same way.")}
    >
      <Callout type="info" title={gt("What you'll need")}>
        {gt("A SerikaCord account, Node.js 18+ (or Python 3.9+), and about five minutes. No prior Discord bot experience is required, but if you have built a Discord bot before, the process is identical — only the base URL changes.")}
      </Callout>

      <H2 id="overview">{gt("How SerikaCord bots work")}</H2>
      <P>
        {gt("A SerikaCord bot is an")}{" "}<Strong>{gt("application")}</Strong>{" "}{gt("with a")}{" "}<Strong>{gt("bot user")}</Strong>{" "}{gt("attached to it. The application holds metadata (name, icon, OAuth2 config, slash commands); the bot user is the account that appears in member lists and authors messages. The bot authenticates over two channels:")}
      </P>
      <UL>
        <li><Strong>{gt("REST API")}</Strong> — {gt("HTTP requests to")} <InlineCode>https://api.serika.chat/api/v10</InlineCode> {gt("for creating messages, managing channels, fetching guild data, etc.")}</li>
        <li><Strong>{gt("Gateway")}</Strong> — {gt("a persistent WebSocket connection to")} <InlineCode>wss://api.serika.chat/api/v10/gateway</InlineCode> {gt("that streams real-time events like")} <InlineCode>MESSAGE_CREATE</InlineCode> {gt("and")} <InlineCode>GUILD_MEMBER_ADD</InlineCode>.</li>
      </UL>
      <P>
        {gt("Both channels use the same")}{" "}<Strong>{gt("bot token")}</Strong>{" "}{gt("for authentication, passed in the")}{" "}
        <InlineCode>Authorization: Bot &lt;token&gt;</InlineCode> {gt("header for REST and in the")}{" "}
        <InlineCode>IDENTIFY</InlineCode> {gt("payload for the Gateway.")}
      </P>

      <H2 id="walkthrough">{gt("Step-by-step walkthrough")}</H2>
      <Steps>
        <Step n={1} title={gt("Create an application")}>
          <P>
            {gt("Open the")}{" "}<Link2 href="/developers/applications">{gt("Developer Portal")}</Link2>{" "}{gt("and click")}{" "}
            <Strong>{gt("Create")}</Strong>. {gt("Name your app and confirm. This is your bot's top-level identity — the name and icon here are what users see when they install your bot.")}
          </P>
          <P>
            {gt("You'll be taken to the")}{" "}<Strong>{gt("General Information")}</Strong>{" "}{gt("page. Note the")}{" "}
            <Strong>{gt("Application ID")}</Strong>{" "}{gt("(a snowflake) — you'll need it for OAuth2 URLs and slash command registration.")}
          </P>
        </Step>

        <Step n={2} title={gt("Enable the bot & copy the token")}>
          <P>
            {gt("Go to the")}{" "}<Strong>{gt("Bot")}</Strong>{" "}{gt("tab and click")}{" "}<Strong>{gt("Enable Bot")}</Strong>. {gt("This provisions:")}
          </P>
          <UL>
            <li>{gt("A")}{" "}<Strong>{gt("bot user")}</Strong> — {gt("a real user account with")} <InlineCode>bot: true</InlineCode> {gt("that can join servers and send messages.")}</li>
            <li>{gt("A")}{" "}<Strong>{gt("bot token")}</Strong> — {gt("a secret string used for authentication. Copy it now; you can always reset it later.")}</li>
            <li>{gt("An")}{" "}<Strong>{gt("Ed25519 public key")}</Strong> — {gt("used to verify signed interaction webhooks (see")}{" "}<Link2 href="/developers/docs/bots/interactions">{gt("Interactions")}</Link2>).</li>
          </UL>
          <Callout type="danger" title={gt("Treat the token like a password")}>
            {gt("Anyone with your token has full control of your bot. Never commit it to version control, never hard-code it in client-side code, and never share it in screenshots. If it leaks, reset it from the Bot tab — the old token stops working immediately.")}
          </Callout>
        </Step>

        <Step n={3} title={gt("Turn on the intents you need")}>
          <P>
            {gt("Still on the")}{" "}<Strong>{gt("Bot")}</Strong>{" "}{gt("tab, scroll to")}{" "}<Strong>{gt("Privileged Gateway Intents")}</Strong>:
          </P>
          <Table headers={[gt("Intent"), gt("Flag"), gt("When you need it")]} rows={[
            [gt("Presence"), "1 << 8", gt("You want to track online/offline status of members")],
            [gt("Server Members"), "1 << 1", gt("You need the full member list or member join/leave events")],
            [gt("Message Content"), "1 << 15", gt("You read the text of messages (not just commands/interactions)")],
          ]} />
          <P>
            {gt("Enable")}{" "}<Strong>{gt("Message Content Intent")}</Strong>{" "}{gt("if your bot reads message text (e.g. prefix commands like")}{" "}<InlineCode>!ping</InlineCode>). {gt("Then request the same intents in your code's")}{" "}
            <InlineCode>IDENTIFY</InlineCode> {gt("payload — enabling them in the portal is necessary but not sufficient; your code must also declare them.")}
          </P>
          <Callout type="warning" title={gt("Privileged intents and verification")}>
            {gt("Bots in 100+ servers must be")}{" "}<Link2 href="/developers/docs/topics/bot-verification">{gt("verified")}</Link2>{" "}{gt("to use privileged intents. You'll need to justify why your bot needs each one.")}
          </Callout>
        </Step>

        <Step n={4} title={gt("Invite the bot to a server")}>
          <P>
            {gt("On the")}{" "}<Strong>{gt("Installation")}</Strong>{" "}{gt("tab (or")}{" "}<Strong>OAuth2 → URL Generator</Strong>), {gt("pick the")}{" "}
            <InlineCode>bot</InlineCode> {gt("and")} <InlineCode>applications.commands</InlineCode> {gt("scopes. Choose the permissions your bot needs (e.g.")}{" "}<Strong>{gt("Administrator")}</Strong> = {gt("permission value")}{" "}
            <InlineCode>8</InlineCode>, {gt("or granular permissions like")}{" "}<Strong>{gt("Send Messages")}</Strong>{" "}{gt("and")}{" "}
            <Strong>{gt("Read Message History")}</Strong>). {gt("Then open the generated install URL:")}
          </P>
          <CodeBlock lang="bash">{`https://api.serika.chat/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=8`}</CodeBlock>
          <P>
            {gt("Select the server you want to add the bot to and click")}{" "}<Strong>{gt("Authorize")}</Strong>. {gt("The bot appears in the member list immediately.")}
          </P>
          <Callout type="info" title={gt("Permission integer")}>
            {gt("The")}{" "}<InlineCode>permissions</InlineCode> {gt("parameter is a bitwise OR of permission flags. For example,")}{" "}
            <InlineCode>Send Messages (2048) + Read Message History (65536) = 67584</InlineCode>. {gt("Use the")}{" "}
            <Link2 href="/developers/docs/topics/permissions">{gt("Permissions")}</Link2> {gt("page for the full flag list.")}
          </Callout>
        </Step>

        <Step n={5} title={gt("Write the bot")}>
          <P>
            {gt("Point any Discord library at SerikaCord by overriding the REST and gateway URLs. For")}{" "}
            <InlineCode>discord.js</InlineCode> v14+:
          </P>
          <CodeBlock lang="javascript">{`import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Point discord.js at SerikaCord instead of Discord
client.rest.setBaseURL("https://api.serika.chat/api/v10");
client.options.ws.url = "wss://api.serika.chat/api/v10/gateway";

client.once("ready", () => console.log(\`Logged in as \${client.user.tag}\`));

client.on("messageCreate", (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!ping") msg.reply("Pong! 🏓");
});

client.login(process.env.BOT_TOKEN);`}</CodeBlock>
          <P>
            {gt("The two lines that make it a SerikaCord bot instead of a Discord bot are")}{" "}
            <InlineCode>client.rest.setBaseURL(...)</InlineCode> {gt("and")}{" "}
            <InlineCode>client.options.ws.url = ...</InlineCode>. {gt("Everything else — intents, events, the message API — is identical to Discord.")}
          </P>
        </Step>

        <Step n={6} title={gt("Run it")}>
          <CodeBlock lang="bash">{`# Store the token in an environment variable
export BOT_TOKEN="your_token_here"
node bot.js`}</CodeBlock>
          <P>
            {gt("You should see")}{" "}<InlineCode>Logged in as YourBotName#0</InlineCode>. {gt("Type")}{" "}
            <InlineCode>!ping</InlineCode> {gt("in a channel your bot can see. It should reply")}{" "}
            <InlineCode>Pong! 🏓</InlineCode>.
          </P>
          <Callout type="warning" title={gt("Keep your token out of git")}>
            {gt("Load it from an environment variable or a")}{" "}<InlineCode>.env</InlineCode> {gt("file (use")}{" "}
            <InlineCode>dotenv</InlineCode>), {gt("and add")}{" "}<InlineCode>.env</InlineCode> {gt("to your")}{" "}
            <InlineCode>.gitignore</InlineCode>. {gt("If a token is ever exposed, reset it immediately from the Bot tab.")}
          </Callout>
        </Step>
      </Steps>

      <H2 id="python">{gt("Prefer Python?")}</H2>
      <P>
        {gt("Using")}{" "}<InlineCode>discord.py</InlineCode> {gt("with SerikaCord is equally straightforward:")}
      </P>
      <CodeBlock lang="python">{`import os, discord

# Point discord.py at SerikaCord
discord.http.Route.BASE = "https://api.serika.chat/api/v10"

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

@client.event
async def on_ready():
    print(f"Logged in as {client.user}")

@client.event
async def on_message(message):
    if message.author.bot:
        return
    if message.content == "!ping":
        await message.reply("Pong! 🏓")

client.run(os.environ["BOT_TOKEN"])`}</CodeBlock>

      <H2 id="raw-http">{gt("Raw HTTP / cURL")}</H2>
      <P>
        {gt("No library? No problem. The REST API speaks plain JSON over HTTP. You can send a message with a single")}{" "}<InlineCode>curl</InlineCode>:
      </P>
      <CodeBlock lang="bash">{`# Get the bot's user info
curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/users/@me

# Send a message to a channel
curl -X POST \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hello from cURL!"}' \\
  https://api.serika.chat/api/v10/channels/CHANNEL_ID/messages`}</CodeBlock>
      <P>
        {gt("For real-time events without a library, connect to the Gateway with any WebSocket client and follow the")}{" "}
        <Link2 href="/developers/docs/topics/gateway">{gt("Gateway protocol")}</Link2>.
      </P>

      <H2 id="architecture">{gt("Understanding the architecture")}</H2>
      <P>
        {gt("SerikaCord runs a single-process server that handles both the Next.js web app and the bot Gateway on the same port. This means:")}
      </P>
      <UL>
        <li>{gt("The REST API is served at")}{" "}<InlineCode>/api/*</InlineCode> {gt("by an")}{" "}<InlineCode>Elysia</InlineCode> {gt("router that intercepts all HTTP methods.")}</li>
        <li>{gt("The Gateway WebSocket is upgraded at")}{" "}<InlineCode>/api/v10/gateway</InlineCode> {gt("on the same port.")}</li>
        <li>{gt("SSE (Server-Sent Events) streams for the web client are served at")}{" "}<InlineCode>/api/channels/:id/stream</InlineCode> {gt("and")}{" "}<InlineCode>/api/dms/:id/stream</InlineCode> — {gt("these are internal to the web app and not part of the bot API.")}</li>
        <li>{gt("The bot API is Discord v10-compatible, served under")}{" "}<InlineCode>/api/v10/*</InlineCode>.</li>
      </UL>

      <H2 id="troubleshooting">{gt("Troubleshooting")}</H2>
      <Table headers={[gt("Problem"), gt("Cause"), gt("Solution")]} rows={[
        ["401: Unauthorized", gt("Invalid or missing token"), gt("Ensure the Authorization header is 'Bot '<token>'' and the token hasn't been reset")],
        ["4004 Authentication failed", gt("Gateway identify with bad token"), gt("Double-check the token; reset it from the Bot tab if needed")],
        ["403: Missing Access", gt("Bot lacks permissions in the channel/guild"), gt("Re-invite with more permissions or have an admin adjust roles")],
        ["10003: Unknown Channel", gt("Channel ID doesn't exist or bot can't see it"), gt("Ensure the bot is in the server and has access to the channel")],
        ["50006: Cannot send an empty message", gt("No content, embeds, attachments, or sticker_ids"), gt("Provide at least one of: content, embeds, attachments, sticker_ids")],
        [gt("Bot doesn't respond to !ping"), gt("Message Content Intent not enabled"), gt("Enable it on the Bot tab AND in your code's intents")],
        [gt("Gateway disconnects immediately"), gt("Intents mismatch or invalid session"), gt("Check that privileged intents are enabled in the portal")],
      ]} />

      <H2 id="next">{gt("Where to go next")}</H2>
      <UL>
        <li>{gt("Add")}{" "}<Link2 href="/developers/docs/bots/slash-commands">{gt("slash commands")}</Link2> {gt("for a modern command interface")}</li>
        <li>{gt("Learn the full")}{" "}<Link2 href="/developers/docs/topics/gateway">{gt("Gateway protocol")}</Link2> — {gt("opcodes, heartbeats, resuming")}</li>
        <li>{gt("Browse the complete")}{" "}<Link2 href="/developers/docs/reference">{gt("API Reference")}</Link2> {gt("for every endpoint")}</li>
        <li>{gt("Understand")}{" "}<Link2 href="/developers/docs/topics/permissions">{gt("Permissions")}</Link2> {gt("for fine-grained access control")}</li>
        <li>{gt("Set up")}{" "}<Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2")}</Link2> {gt("to let users log in with SerikaCord")}</li>
        <li>{gt("Read the")}{" "}<Link2 href="/developers/docs/quick-start">{gt("Quick Start")}</Link2> {gt("for copy-paste examples in multiple languages")}</li>
      </UL>
    </DocPage>
  );
}
