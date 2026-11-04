import { DocPage, P, H2, H3, UL, Callout, Strong, InlineCode, CodeBlock, Table, Steps, Step } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Activities",
  description: "Run Discord Embedded App SDK Activities on SerikaCord: what is compatible, what differs, and how to point an existing Activity at SerikaCord.",
  path: "/developers/docs/activities/overview",
  keywords: ["Activities", "Embedded App SDK", "discordsays", "SerikaCord Activities", "entry point command"],
});

export default async function ActivitiesOverviewDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Activities")}
      description={gt("Web apps (games, watch-together, whiteboards) that run inside SerikaCord calls and chats, built with Discord's Embedded App SDK.")}
    >
      <P>
        {gt("SerikaCord runs Activities built for Discord's Embedded App SDK. Use the stock")} <InlineCode>@discord/embedded-app-sdk</InlineCode> {gt("package unchanged. In most cases you only change your client ID and the API base URL your backend calls.")}
      </P>

      <Callout type="info" title={gt("Where Activities run")}>
        {gt("In server voice channels, DM calls and group DM calls (everyone in the call can join), and straight from text chats: server channels, DMs and group DMs. A text-chat launch posts a Game Invitation card with a Play button that anyone in the chat can use.")}
      </Callout>

      <H2 id="setup">{gt("Point an existing Activity at SerikaCord")}</H2>
      <Steps>
        <Step n={1} title={gt("Create an application and enable Activities")}>
          {gt("In the Developer Portal open your application, go to Activities, turn on Enable Activities and add your URL mappings exactly as on Discord. The root mapping (\"/\") is your Activity's page. Turning it on creates a Launch entry point command.")}
        </Step>
        <Step n={2} title={gt("Use the SerikaCord client ID")}>
          {gt("Pass your SerikaCord application's client ID to new DiscordSDK(clientId). Your Activity is served at https://<client_id>.waifu.ws through our proxy, the same way Discord serves it at <app_id>.discordsays.com.")}
        </Step>
        <Step n={3} title={gt("Change your backend's API base URL")}>
          {gt("Your token exchange (authorize → code → POST /oauth2/token) and any REST calls go to SerikaCord's Discord-compatible API instead of discord.com/api. Use your SerikaCord client secret.")}
        </Step>
        <Step n={4} title={gt("Launch it")}>
          {gt("Start it from the rocket button in a call, from \"Start an Activity\" in the chat's + menu, or with your app's /launch command.")}
        </Step>
      </Steps>

      <CodeBlock lang="ts">{`// Server: exchange the code from discordSdk.commands.authorize()
const res = await fetch("https://serika.chat/api/v10/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: process.env.SERIKA_CLIENT_ID!,
    client_secret: process.env.SERIKA_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
  }),
});
const { access_token } = await res.json();
// Client: await discordSdk.commands.authenticate({ access_token });`}</CodeBlock>

      <H2 id="compatibility">{gt("What's compatible")}</H2>
      <Table
        headers={[gt("Area"), gt("On SerikaCord")]}
        rows={[
          [gt("SDK handshake and events"), gt("The stock SDK works unchanged: READY, ERROR, VOICE_STATE_UPDATE, SPEAKING_START / STOP, ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, CURRENT_USER_UPDATE, CURRENT_GUILD_MEMBER_UPDATE, ORIENTATION_UPDATE, ACTIVITY_LAYOUT_MODE_UPDATE, THERMAL_STATE_UPDATE.")],
          [gt("Commands"), gt("authorize, authenticate, getChannel, getChannelPermissions, getInstanceConnectedParticipants, getUser, setActivity, openExternalLink (always asks the user), openInviteDialog (copies a link), openShareMomentDialog (copies the link), setOrientationLockState, getPlatformBehaviors, encourageHardwareAcceleration, userSettingsGetLocale, setConfig, captureLog. Unknown commands fail with 4002 INVALID_COMMAND, like Discord.")],
          [gt("Scopes"), gt("Checked like Discord: getChannel needs guilds (in servers), getChannelPermissions needs guilds.members.read, setActivity needs rpc.activities.write, voice and speaking events need rpc.voice.read, user events and the locale need identify.")],
          [gt("URL mappings"), gt("Same prefix / target rules, including {name} parameters. /.proxy/<path> and /<path> both work. The root mapping is matched last.")],
          [gt("Entry point command"), gt("type 4 (PRIMARY_ENTRY_POINT) with handler 2 (SerikaCord launches it and posts a Game Invitation) or handler 1 (your app gets the interaction and can answer with callback type 12, LAUNCH_ACTIVITY).")],
          [gt("REST"), gt("GET /applications/{id}/activity-instances/{instance_id} returns the running instance (application_id, instance_id, launch_id, location, users). GUILD_CREATE lists running instances in embedded_activities.")],
          [gt("Ids"), gt("Everything the SDK hands you (user, channel and guild ids) uses your app's id format, the same ids the bot API and OAuth2 /users/@me return.")],
        ]}
      />

      <H2 id="differences">{gt("What's different")}</H2>
      <UL>
        <li><Strong>{gt("Origin:")}</Strong> {gt("https://<client_id>.waifu.ws instead of discordsays.com. Hard-coded discordsays.com URLs in your code need changing.")}</li>
        <li><Strong>{gt("Direct API calls:")}</Strong> {gt("your frame may call SerikaCord's API (/api/v10, /api/oauth2) with its own OAuth2 token. Cookies are never sent, so the frame can't act as the signed-in user. Everything else goes through your URL mappings.")}</li>
        <li><Strong>{gt("Monetization:")}</Strong> {gt("getSkus and getEntitlements return empty lists and startPurchase is not available.")}</li>
        <li><Strong>{gt("Age gate:")}</Strong> {gt("people see an 18+ warning and must confirm it before they launch or join an age-restricted Activity.")}</li>
        <li><Strong>{gt("Cookies:")}</Strong> {gt("the proxy strips Cookie and Set-Cookie. Keep session state in your access token or in local storage.")}</li>
        <li><Strong>{gt("Not available yet:")}</Strong> {gt("quests, initiateImageUpload, shareLink, inviteUserEmbedded, requestProxyTicketRefresh and getRelationships (returns an empty list).")}</li>
      </UL>

      <H2 id="commands">{gt("Your own command name (e.g. /wordle)")}</H2>
      <P>
        {gt("Enabling Activities creates an entry point command called launch. Rename it with the application commands API (PATCH /applications/{id}/commands/{command_id} with a new name), and people can type /wordle or pick it from the command list. With handler 2 SerikaCord launches the Activity and posts a Game Invitation; with handler 1 your app gets the interaction and answers with LAUNCH_ACTIVITY (type 12).")}
      </P>

      <H2 id="status-messages">{gt("Status messages and Play buttons")}</H2>
      <P>
        {gt("Like Wordle's daily results, your bot can post (and edit) normal messages in the chat: text, an image of the results, and a button. When someone clicks the button your app receives a component interaction; answer it with callback type 12 (LAUNCH_ACTIVITY) and SerikaCord opens the Activity for them. No Game Invitation is added in that case: your message is the invitation.")}
      </P>
      <CodeBlock lang="ts">{`// Post a results message with a "Play now!" button (bot token)
await fetch(\`https://serika.chat/api/v10/channels/\${channelId}/messages\`, {
  method: "POST",
  headers: { Authorization: \`Bot \${BOT_TOKEN}\`, "Content-Type": "application/json" },
  body: JSON.stringify({
    content: "**Your group is on a 2 day streak!** 🔥 Here are yesterday's results: 👑 4/6",
    components: [{ type: 1, components: [{ type: 2, style: 1, label: "Play now!", custom_id: "play" }] }],
  }),
});

// When the button is clicked (INTERACTION_CREATE, type 3): launch the Activity
await fetch(\`https://serika.chat/api/v10/interactions/\${interaction.id}/\${interaction.token}/callback\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: 12 }),
});`}</CodeBlock>

      <H2 id="layout">{gt("Where your Activity appears")}</H2>
      <UL>
        <li>{gt("Launched in a text chat: docked above the messages, with a bar to collapse, minimize, leave or pop it out.")}</li>
        <li>{gt("Launched in a call: it fills the call stage, with everyone's tiles below.")}</li>
        <li>{gt("Elsewhere in the app it keeps running in a mini player, and in browsers it can pop out into its own window. ACTIVITY_LAYOUT_MODE_UPDATE tells you when it's in the mini player (layout_mode 1).")}</li>
      </UL>

      <H2 id="proxy">{gt("The proxy")}</H2>
      <H3 id="proxy-limits">{gt("Limits")}</H3>
      <UL>
        <li>{gt("Upstreams are always reached over HTTPS / WSS. Targets must be public domain names; private and internal addresses are refused.")}</li>
        <li>{gt("Request bodies up to 25 MB, 30 seconds per upstream response, WebSocket messages up to 1 MB.")}</li>
        <li>{gt("Redirects to your mapped hosts are rewritten onto the proxy; redirects elsewhere are refused.")}</li>
        <li>{gt("Your pages are served with a Content-Security-Policy that allows only your own origin (plus SerikaCord's API and CDN). Load external resources through a URL mapping.")}</li>
      </UL>
      <Callout type="warning" title={gt("Security")}>
        {gt("Your Activity runs on a separate site in a sandboxed frame. It never receives a SerikaCord session, and everything that changes state is checked on the server against the user's grants and permissions.")}
      </Callout>
    </DocPage>
  );
}
