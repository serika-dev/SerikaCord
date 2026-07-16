import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Quick Start",
  description:
    "Copy-paste quick start guides for SerikaCord bots in Node.js, Python, Go, and raw HTTP. Get running in any language.",
  path: "/developers/docs/quick-start",
  keywords: ["SerikaCord quick start", "bot tutorial", "serika.js", "API examples"],
});

export default async function QuickStartDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Quick Start")} description={gt("Copy-paste examples in every major language. Use serika.js natively, or point any Discord-compatible library at SerikaCord with a one-line base-URL change.")}>
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

      <H2 id="python">{gt("Python (discord.py — compatible)")}</H2>
      <P>
        {gt("Since SerikaCord is API-compatible with Discord, you can also use")}{" "}<InlineCode>discord.py</InlineCode> {gt("with a base-URL override:")}
      </P>
      <CodeBlock lang="bash">pip install discord.py</CodeBlock>
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
        await message.reply("Pong!")

client.run(os.environ["BOT_TOKEN"])`}</CodeBlock>

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
