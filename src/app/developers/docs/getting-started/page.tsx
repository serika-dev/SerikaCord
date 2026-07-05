import { DocPage, P, H2, CodeBlock, Callout, Strong, InlineCode, Link2, Steps, Step } from "../DocPage";

export default function GettingStartedDoc() {
  return (
    <DocPage
      title="Getting Started"
      description="From zero to a running bot that replies in a channel. This walkthrough uses discord.js, but any Discord-compatible library works the same way."
    >
      <Callout type="info" title="What you'll need">
        A SerikaCord account, Node.js 18+ (or Python 3.9+), and about five minutes.
      </Callout>

      <H2 id="walkthrough">Walkthrough</H2>
      <Steps>
        <Step n={1} title="Create an application">
          <P>
            Open the <Link2 href="/developers/applications">Developer Portal</Link2> and click{" "}
            <Strong>Create</Strong>. Name your app and confirm. This is your bot&apos;s top-level identity.
          </P>
        </Step>

        <Step n={2} title="Enable the bot & copy the token">
          <P>
            Go to the <Strong>Bot</Strong> tab and click <Strong>Enable Bot</Strong>. This provisions the
            bot user and its token. Copy the token now and store it somewhere safe — you&apos;ll only see it
            once (you can always reset it later).
          </P>
        </Step>

        <Step n={3} title="Turn on the intents you need">
          <P>
            Still on the <Strong>Bot</Strong> tab, enable <Strong>Message Content Intent</Strong> if your
            bot reads message text. Then request it in your code&apos;s <InlineCode>IDENTIFY</InlineCode>.
          </P>
        </Step>

        <Step n={4} title="Invite the bot to a server">
          <P>
            On the <Strong>Installation</Strong> tab, pick the <InlineCode>bot</InlineCode> and{" "}
            <InlineCode>applications.commands</InlineCode> scopes plus any permissions, then open the
            generated install URL. It looks like:
          </P>
          <CodeBlock lang="bash">{`https://api.serika.chat/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot+applications.commands&permissions=8`}</CodeBlock>
        </Step>

        <Step n={5} title="Write the bot">
          <P>Point any Discord library at SerikaCord by overriding the REST and gateway URLs:</P>
          <CodeBlock lang="javascript">{`import { Client, GatewayIntentBits } from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Point discord.js at SerikaCord
client.rest.setBaseURL("https://api.serika.chat/api/v10");
client.options.ws.url = "wss://api.serika.chat/api/v10/gateway";

client.once("ready", () => console.log(\`Logged in as \${client.user.tag}\`));

client.on("messageCreate", (msg) => {
  if (msg.author.bot) return;
  if (msg.content === "!ping") msg.reply("Pong! 🏓");
});

client.login(process.env.BOT_TOKEN);`}</CodeBlock>
        </Step>

        <Step n={6} title="Run it">
          <CodeBlock lang="bash">{`BOT_TOKEN=your_token_here node bot.js`}</CodeBlock>
          <P>
            Type <InlineCode>!ping</InlineCode> in a channel your bot can see. It should reply{" "}
            <InlineCode>Pong! 🏓</InlineCode>.
          </P>
        </Step>
      </Steps>

      <Callout type="warning" title="Keep your token out of git">
        Load it from an environment variable, and add <InlineCode>.env</InlineCode> to your{" "}
        <InlineCode>.gitignore</InlineCode>. If a token is ever exposed, reset it immediately.
      </Callout>

      <H2 id="python">Prefer Python?</H2>
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

      <H2 id="next">Where to go next</H2>
      <P>
        Add <Link2 href="/developers/docs/bots/slash-commands">slash commands</Link2>, learn the{" "}
        <Link2 href="/developers/docs/topics/gateway">gateway protocol</Link2>, or browse the full{" "}
        <Link2 href="/developers/docs/reference">API Reference</Link2>.
      </P>
    </DocPage>
  );
}
