import { DocPage, P, H2, UL, CodeBlock, Callout, InlineCode, Link2, Table } from "../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Quick Start",
  description:
    "Copy-paste quick start guides for SerikaCord bots with discord.js, discord.py, serika.js, Go and raw HTTP.",
  path: "/developers/docs/quick-start",
  keywords: ["SerikaCord quick start", "bot tutorial", "serika.js", "discord.js", "discord.py", "API examples"],
});

export default async function QuickStartDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Quick Start")} description={gt("Copy-paste examples in every major language. serika.js is the supported SDK; the REST API also works from any HTTP client.")}>
      <Callout type="info" title={gt("Prerequisites")}>
        {gt("You need a bot token from the")}{" "}<Link2 href="/developers/applications">{gt("Developer Portal")}</Link2>.
        {gt("See")}{" "}<Link2 href="/developers/docs/getting-started">{gt("Getting Started")}</Link2> {gt("if you don't have one yet.")}
      </Callout>

      <H2 id="cheat-sheet">{gt("One-line cheat sheet")}</H2>
      <Table headers={[gt("Channel"), gt("URL")]} rows={[
        ["REST API", "https://api.serika.chat/api/v10"],
        ["Gateway WebSocket", "wss://api.serika.chat/api/v10/gateway"],
        ["OAuth2 Authorize", "https://api.serika.chat/api/oauth2/authorize"],
        ["OAuth2 Token", "https://api.serika.chat/api/oauth2/token"],
        ["CDN (Discord paths)", "https://api.serika.chat/cdn-compat"],
        [gt("Auth header"), "Authorization: Bot YOUR_TOKEN"],
      ]} />

      <H2 id="nodejs">{gt("Node.js (serika.js)")}</H2>
      <P>
        {gt("serika.js is the official SerikaCord SDK. It provides a full REST client, Gateway WebSocket client, and TypeScript types out of the box — no base-URL patching needed.")}
      </P>
      <CodeBlock lang="bash">npm install @serikadev/serika.js</CodeBlock>
      <CodeBlock lang="javascript">{`import { SerikaClient, Intents } from "@serikadev/serika.js";

const client = new SerikaClient({
  token: process.env.BOT_TOKEN!,
  baseURL: "https://api.serika.chat",
});

// Gateway: listen for events
const gw = await client.connectGateway({
  intents: Intents.GUILDS | Intents.GUILD_MESSAGES | Intents.MESSAGE_CONTENT,
});

gw.onReady(() => console.log("Bot is ready!"));

gw.onDispatch((event, data) => {
  if (event === "MESSAGE_CREATE") {
    const msg = data;
    if (msg.author.bot) return;
    if (msg.content === "!ping") {
      client.bot.createMessage(msg.channel_id, { content: "Pong!" });
    }
  }
});`}</CodeBlock>

      <H2 id="discordjs">{gt("Node.js (discord.js v14)")}</H2>
      <P>
        {gt("discord.js works unmodified. Point its REST client at SerikaCord; the gateway URL comes from GET /gateway/bot, so it follows automatically. The cdn option makes avatar, icon and emoji URLs resolve.")}
      </P>
      <CodeBlock lang="bash">npm install discord.js</CodeBlock>
      <CodeBlock lang="javascript">{`import { Client, Events, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: enable it in the Developer Portal
  ],
  rest: {
    api: "https://api.serika.chat/api",        // discord.js adds /v10 itself
    cdn: "https://api.serika.chat/cdn-compat", // displayAvatarURL(), iconURL(), emoji URLs
  },
});

client.once(Events.ClientReady, (c) => {
  console.log(\`Logged in as \${c.user.tag} in \${c.guilds.cache.size} servers\`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.content === "!ping") await message.reply("Pong!");
});

client.login(process.env.BOT_TOKEN);`}</CodeBlock>
      <P>{gt("Deploying slash commands with the standalone REST client works the same way:")}</P>
      <CodeBlock lang="javascript">{`import { REST, Routes } from "discord.js";

const rest = new REST({ api: "https://api.serika.chat/api" }).setToken(process.env.BOT_TOKEN);
await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
  body: [{ name: "ping", description: "Replies with Pong!" }],
});`}</CodeBlock>

      <H2 id="python">{gt("Python (discord.py 2.x)")}</H2>
      <P>
        {gt("discord.py needs three overrides before the client starts: the REST base, the gateway URL and the CDN base.")}
      </P>
      <Callout type="danger" title={gt("Always set DEFAULT_GATEWAY")}>
        {gt("An unsharded discord.py client never asks SerikaCord for the gateway URL. Without the DiscordWebSocket.DEFAULT_GATEWAY line it connects to Discord's own gateway and sends your SerikaCord bot token there.")}
      </Callout>
      <CodeBlock lang="bash">{`pip install -U "discord.py>=2.4,<3"`}</CodeBlock>
      <CodeBlock lang="python">{`import os

import discord
import yarl
from discord.asset import Asset
from discord.gateway import DiscordWebSocket
from discord.http import Route

# 1. REST API
Route.BASE = "https://api.serika.chat/api/v10"
# 2. Gateway (required, see the warning above)
DiscordWebSocket.DEFAULT_GATEWAY = yarl.URL("wss://api.serika.chat/api/v10/gateway")
# 3. CDN: avatar / icon / emoji URLs
Asset.BASE = "https://api.serika.chat/cdn-compat"

intents = discord.Intents.default()
intents.message_content = True  # privileged: enable it in the Developer Portal

client = discord.Client(intents=intents)


@client.event
async def on_ready():
    print(f"Logged in as {client.user} in {len(client.guilds)} servers")


@client.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if message.content == "!ping":
        await message.reply("Pong!")


client.run(os.environ["BOT_TOKEN"])`}</CodeBlock>
      <P>
        {gt("The same three lines work with commands.Bot and app_commands. Put them at the top of your entry file, before any client is created.")}
      </P>

      <H2 id="other-libraries">{gt("Other libraries (not tested yet)")}</H2>
      <P>{gt("These libraries parse ids as 64-bit integers, which works for applications that use Discord-style ids (the default for new applications). We have not run them against SerikaCord yet.")}</P>
      <Table headers={[gt("Library"), gt("REST base"), gt("Gateway"), gt("CDN")]} rows={[
        ["JDA (Java)", "JDABuilder.setRestConfig(new RestConfig().setBaseUrl(\"https://api.serika.chat/api/v10/\"))", gt("From GET /gateway/bot"), gt("No override: image URLs point at Discord")],
        ["Serenity (Rust)", "HttpBuilder::new(token).proxy(\"https://api.serika.chat\")", gt("From GET /gateway/bot"), gt("No override")],
        ["DSharpPlus (C#)", gt("No documented base-URL option found; a reverse proxy in front of the HTTP client is the fallback"), gt("From GET /gateway/bot"), gt("No override")],
      ]} />
      <Callout type="info" title={gt("Differences from Discord")}>
        {gt("Voice media, monetization and a few other areas behave differently. See")}{" "}<Link2 href="/developers/docs/topics/differences">{gt("Differences from Discord")}</Link2> {gt("and the")}{" "}<Link2 href="/developers/docs/topics/compatibility">{gt("compatibility table")}</Link2>.
      </Callout>

      <H2 id="python-requests">{gt("Python (plain HTTP)")}</H2>
      <P>{gt("No library needed for simple scripts:")}</P>
      <CodeBlock lang="bash">pip install requests</CodeBlock>
      <CodeBlock lang="python">{`import os

import requests

API = "https://api.serika.chat/api/v10"
HEADERS = {"Authorization": "Bot " + os.environ["BOT_TOKEN"]}


def send_message(channel_id: str, content: str) -> dict:
    res = requests.post(
        f"{API}/channels/{channel_id}/messages",
        headers=HEADERS,
        json={"content": content},
        timeout=10,
    )
    res.raise_for_status()
    return res.json()


me = requests.get(f"{API}/users/@me", headers=HEADERS, timeout=10).json()
print("Logged in as", me["username"])
send_message("CHANNEL_ID", "Hello from Python!")`}</CodeBlock>

      <H2 id="raw-http">{gt("Raw HTTP / cURL")}</H2>
      <P>{gt("No library needed — the REST API speaks plain JSON:")}</P>
      <CodeBlock lang="bash">{`# Get bot user info
curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/users/@me

# Send a message
curl -X POST \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hello from cURL!"}' \\
  https://api.serika.chat/api/v10/channels/CHANNEL_ID/messages

# List channels in a guild
curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/guilds/GUILD_ID/channels

# Create a slash command
curl -X PUT \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '[{"name":"ping","description":"Pong!","type":1}]' \\
  https://api.serika.chat/api/v10/applications/APP_ID/commands`}</CodeBlock>

      <H2 id="raw-ws">{gt("Raw WebSocket (Node.js ws)")}</H2>
      <P>
        {gt("For the Gateway without a library, use any WebSocket client. This minimal example connects, identifies, heartbeats, and logs")}{" "}<InlineCode>MESSAGE_CREATE</InlineCode> {gt("events:")}
      </P>
      <CodeBlock lang="javascript">{`import WebSocket from "ws";

const ws = new WebSocket("wss://api.serika.chat/api/v10/gateway");
let heartbeatTimer;

ws.on("open", () => console.log("Connected to gateway"));

ws.on("message", (raw) => {
  const { op, d, t } = JSON.parse(raw.toString());

  // op 10 = HELLO
  if (op === 10) {
    const interval = d.heartbeat_interval;
    heartbeatTimer = setInterval(() => {
      ws.send(JSON.stringify({ op: 1, d: null })); // HEARTBEAT
    }, interval);

    // IDENTIFY
    ws.send(JSON.stringify({
      op: 2,
      d: {
        token: "Bot YOUR_TOKEN",
        intents: (1 << 0) | (1 << 9) | (1 << 15), // GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT
      },
    }));
  }

  // op 0 = DISPATCH
  if (op === 0 && t === "MESSAGE_CREATE") {
    console.log(\`[\${d.author.username}]: \${d.content}\`);
  }

  // op 11 = HEARTBEAT_ACK
  if (op === 11) {
    // Heartbeat acknowledged — connection is healthy
  }
});

ws.on("close", (code, reason) => {
  clearInterval(heartbeatTimer);
  console.log(\`Disconnected: \${code} \${reason}\`);
});`}</CodeBlock>

      <H2 id="go">{gt("Go (discordgo)")}</H2>
      <Callout type="warning" title={gt("Not tested yet")}>
        {gt("discordgo builds most endpoint URLs when it loads, so changing the base later may not reach every route. Check the requests your bot sends before relying on it.")}
      </Callout>
      <P>
        {gt("Using")}{" "}<InlineCode>discordgo</InlineCode> {gt("with SerikaCord:")}
      </P>
      <CodeBlock lang="go">{`package main

import (
  "fmt"
  "log"
  "os"

  "github.com/bwmarrin/discordgo"
)

func main() {
  // Point discordgo at SerikaCord
  discordgo.Endpoint = "https://api.serika.chat/api/v10/"
  discordgo.Gateway = "wss://api.serika.chat/api/v10/gateway"

  dg, err := discordgo.New("Bot " + os.Getenv("BOT_TOKEN"))
  if err != nil {
    log.Fatal(err)
  }

  dg.AddHandler(func(s *discordgo.Session, m *discordgo.MessageCreate) {
    if m.Author.Bot {
      return
    }
    if m.Content == "!ping" {
      s.ChannelMessageSend(m.ChannelID, "Pong!")
    }
  })

  dg.Identify.Intents = discordgo.IntentsGuilds |
    discordgo.IntentsGuildMessages | discordgo.IntentMessageContent

  if err := dg.Open(); err != nil {
    log.Fatal(err)
  }
  defer dg.Close()

  fmt.Println("Bot is running. Press Ctrl+C to stop.")
  select {}
}`}</CodeBlock>

      <Callout type="warning" title={gt("Token Security")}>
        {gt("Never commit your bot token to version control. Use environment variables and add")}{" "}
        <InlineCode>.env</InlineCode> {gt("to your")}{" "}<InlineCode>.gitignore</InlineCode>.
      </Callout>

      <H2 id="env-setup">{gt("Environment setup tips")}</H2>
      <Table headers={[gt("Language"), gt("Env var approach")]} rows={[
        ["Node.js", gt("Use dotenv: npm install dotenv, then require('dotenv').config()")],
        ["Python", gt("Use python-dotenv or os.environ['BOT_TOKEN']")],
        ["Go", gt("Use os.Getenv('BOT_TOKEN') or godotenv package")],
        [gt("Shell"), gt("export BOT_TOKEN='your_token' in your shell profile")],
      ]} />

      <H2 id="next-steps">{gt("Next Steps")}</H2>
      <UL>
        <li>{gt("Read the")}{" "}<Link2 href="/developers/docs/reference">{gt("API Reference")}</Link2> {gt("for all endpoints")}</li>
        <li>{gt("Learn about")}{" "}<Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2")}</Link2> {gt("for user authentication")}</li>
        <li>{gt("Understand")}{" "}<Link2 href="/developers/docs/topics/permissions">{gt("Permissions")}</Link2></li>
        <li>{gt("Connect to the")}{" "}<Link2 href="/developers/docs/topics/gateway">{gt("Gateway")}</Link2> {gt("for real-time events")}</li>
        <li>{gt("Add")}{" "}<Link2 href="/developers/docs/bots/slash-commands">{gt("slash commands")}</Link2> {gt("to your bot")}</li>
      </UL>
    </DocPage>
  );
}
