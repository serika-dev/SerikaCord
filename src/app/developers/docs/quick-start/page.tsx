import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2 } from "../DocPage";

export default function QuickStartDoc() {
  return (
    <DocPage title="Quick Start" description="Get your first SerikaCord bot running in under 5 minutes.">
      <H2 id="prerequisites">Prerequisites</H2>
      <UL>
        <li>A SerikaCord account</li>
        <li>Node.js 18+ or Python 3.9+ (or any language with HTTP/WebSocket support)</li>
        <li>A bot token from the <Link2 href="/developers/applications">Developer Portal</Link2></li>
      </UL>

      <H2 id="create-application">Step 1: Create an Application</H2>
      <P>
        Go to the <Link2 href="/developers/applications">Applications page</Link2> and click{" "}
        <Strong>"Create a New Application"</Strong>. Give it a name and click Create.
      </P>

      <H2 id="configure-bot">Step 2: Configure Your Bot</H2>
      <P>
        Navigate to the <Strong>Bot</Strong> tab in your application settings. Here you can:
      </P>
      <UL>
        <li>Copy your bot token (keep it secret!)</li>
        <li>Toggle "Public Bot" to allow others to invite it</li>
        <li>Enable privileged gateway intents if needed</li>
      </UL>

      <H2 id="invite-bot">Step 3: Invite Your Bot</H2>
      <P>
        Go to the <Strong>Installation</Strong> tab, select your scopes and permissions, and copy the
        install link. Open it in your browser to add the bot to your server.
      </P>
      <P>A typical install URL looks like:</P>
      <CodeBlock lang="bash">https://api.serika.chat/api/oauth2/authorize?client_id=YOUR_APP_ID&amp;scope=bot+applications.commands&amp;permissions=8</CodeBlock>

      <H2 id="first-bot">Step 4: Write Your First Bot</H2>

      <H3 id="nodejs">Node.js (serika.js)</H3>
      <P>
        Since SerikaCord is API-compatible with Discord, you can use Discord.js with a custom gateway
        and REST endpoint:
      </P>
      <CodeBlock lang="javascript">{`import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// Point to SerikaCord's API
client.rest.setBaseURL("https://api.serika.chat/api/v10");
client.options.ws.url = "wss://api.serika.chat/api/v10/gateway";

client.on("ready", () => {
  console.log(\`Logged in as \${client.user.tag}\`);
});

client.on("messageCreate", (msg) => {
  if (msg.content === "!ping") {
    msg.reply("Pong!");
  }
});

client.login("YOUR_BOT_TOKEN");`}</CodeBlock>

      <H3 id="python">Python (serika.py)</H3>
      <P>Using discord.py with SerikaCord endpoints:</P>
      <CodeBlock lang="python">{`import discord

client = discord.Client()

@client.event
async def on_ready():
    print(f"Logged in as {client.user}")

@client.event
async def on_message(message):
    if message.content == "!ping":
        await message.reply("Pong!")

# Set custom API base URL
discord.http.Route.BASE = "https://api.serika.chat/api/v10"
client.run("YOUR_BOT_TOKEN")`}</CodeBlock>

      <H3 id="raw-http">Raw HTTP / cURL</H3>
      <P>You can also make direct REST API calls:</P>
      <CodeBlock lang="bash">{`curl -H "Authorization: Bot YOUR_TOKEN" \\
  https://api.serika.chat/api/v10/users/@me`}</CodeBlock>

      <Callout type="warning" title="Token Security">
        Never commit your bot token to version control. Use environment variables and add it to your{" "}
        <InlineCode>.gitignore</InlineCode> and <InlineCode>.env</InlineCode> files.
      </Callout>

      <H2 id="next-steps">Next Steps</H2>
      <UL>
        <li>Read the <Link2 href="/developers/docs/reference">API Reference</Link2> for all endpoints</li>
        <li>Learn about <Link2 href="/developers/docs/topics/oauth2">OAuth2</Link2> for user authentication</li>
        <li>Understand <Link2 href="/developers/docs/topics/permissions">Permissions</Link2></li>
        <li>Connect to the <Link2 href="/developers/docs/topics/gateway">Gateway</Link2> for real-time events</li>
      </UL>
    </DocPage>
  );
}
