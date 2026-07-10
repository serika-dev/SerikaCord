import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Permissions",
  description:
    "SerikaCord permissions: bitwise flags, administrator permission, permission hierarchy, channel overwrites, OAuth2 bot permissions, and privileged intents.",
  path: "/developers/docs/topics/permissions",
  keywords: ["SerikaCord permissions", "bitwise flags", "permission hierarchy", "channel overwrites", "OAuth2"],
});

export default async function PermissionsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Permissions")} description={gt("Understand SerikaCord's permission system for bots and users.")}>
      <P>
        {gt("Permissions in SerikaCord are bitwise flags, identical to Discord's system. They can be combined using bitwise OR operations.")}
      </P>

      <H2 id="permission-bits">{gt("Permission Bits")}</H2>
      <Table headers={[gt("Bit"), gt("Permission"), gt("Description")]} rows={[
        ["1 << 0", "CREATE_INSTANT_INVITE", gt("Create instant invite")],
        ["1 << 1", "KICK_MEMBERS", gt("Kick members")],
        ["1 << 2", "BAN_MEMBERS", gt("Ban members")],
        ["1 << 3", "ADMINISTRATOR", gt("All permissions (implicitly)")],
        ["1 << 4", "MANAGE_CHANNELS", gt("Manage channels")],
        ["1 << 5", "MANAGE_GUILD", gt("Manage guild")],
        ["1 << 6", "ADD_REACTIONS", gt("Add reactions to messages")],
        ["1 << 7", "VIEW_AUDIT_LOG", gt("View audit log")],
        ["1 << 8", "PRIORITY_SPEAKER", gt("Priority speaker in voice")],
        ["1 << 9", "STREAM", gt("Stream in voice channel")],
        ["1 << 10", "VIEW_CHANNEL", gt("View channel")],
        ["1 << 11", "SEND_MESSAGES", gt("Send messages")],
        ["1 << 12", "SEND_TTS_MESSAGES", gt("Send TTS messages")],
        ["1 << 13", "MANAGE_MESSAGES", gt("Manage/delete messages")],
        ["1 << 14", "EMBED_LINKS", gt("Embed links in messages")],
        ["1 << 15", "ATTACH_FILES", gt("Attach files to messages")],
        ["1 << 16", "READ_MESSAGE_HISTORY", gt("Read message history")],
        ["1 << 17", "MENTION_EVERYONE", gt("Mention @everyone/@here")],
        ["1 << 18", "USE_EXTERNAL_EMOJIS", gt("Use external emojis")],
        ["1 << 19", "VIEW_GUILD_INSIGHTS", gt("View guild insights")],
        ["1 << 20", "CONNECT", gt("Connect to voice channel")],
        ["1 << 21", "SPEAK", gt("Speak in voice channel")],
        ["1 << 22", "MUTE_MEMBERS", gt("Mute members in voice")],
        ["1 << 23", "DEAFEN_MEMBERS", gt("Deafen members in voice")],
        ["1 << 24", "MOVE_MEMBERS", gt("Move members between voice channels")],
        ["1 << 25", "USE_VAD", gt("Use voice activity detection")],
        ["1 << 26", "CHANGE_NICKNAME", gt("Change own nickname")],
        ["1 << 27", "MANAGE_NICKNAMES", gt("Manage other members' nicknames")],
        ["1 << 28", "MANAGE_ROLES", gt("Manage roles")],
        ["1 << 29", "MANAGE_WEBHOOKS", gt("Manage webhooks")],
        ["1 << 30", "MANAGE_EMOJIS_AND_STICKERS", gt("Manage emojis and stickers")],
        ["1 << 31", "USE_APPLICATION_COMMANDS", gt("Use application commands")],
        ["1 << 32", "REQUEST_TO_SPEAK", gt("Request to speak in stage")],
        ["1 << 33", "MANAGE_EVENTS", gt("Manage guild events")],
        ["1 << 34", "MANAGE_THREADS", gt("Manage threads")],
        ["1 << 35", "CREATE_PUBLIC_THREADS", gt("Create public threads")],
        ["1 << 36", "CREATE_PRIVATE_THREADS", gt("Create private threads")],
        ["1 << 37", "USE_EXTERNAL_STICKERS", gt("Use external stickers")],
        ["1 << 38", "SEND_MESSAGES_IN_THREADS", gt("Send messages in threads")],
        ["1 << 39", "USE_EMBEDDED_ACTIVITIES", gt("Use embedded activities")],
        ["1 << 40", "MODERATE_MEMBERS", gt("Timeout members")],
        ["1 << 41", "VIEW_CREATOR_MONETIZATION_ANALYTICS", gt("View monetization analytics")],
        ["1 << 42", "USE_EXTERNAL_SOUNDS", gt("Use external sounds")],
        ["1 << 43", "SEND_VOICE_MESSAGES", gt("Send voice messages")],
      ]} />

      <H2 id="administrator">{gt("Administrator Permission")}</H2>
      <P>
        {gt("The")} <InlineCode>ADMINISTRATOR</InlineCode> {gt("permission (bit 3) grants all permissions implicitly. Use with caution.")}
      </P>

      <H2 id="calculating">{gt("Calculating Permissions")}</H2>
      <P>{gt("Combine permissions using bitwise OR:")}</P>
      <CodeBlock lang="javascript">{`// Send Messages + Read Message History + View Channel
const permissions = (1n << 10n) | (1n << 11n) | (1n << 16n);
// = 67648`}</CodeBlock>

      <H2 id="permission-hierarchy">{gt("Permission Hierarchy")}</H2>
      <UL>
        <li>{gt("Server owner always has all permissions")}</li>
        <li>{gt("Roles are ordered by position — higher roles manage lower ones")}</li>
        <li>{gt("Channel overwrites can restrict or grant permissions per-channel")}</li>
        <li>{gt("Administrator permission bypasses all overwrites")}</li>
      </UL>

      <H2 id="channel-overwrites">{gt("Channel Overwrites")}</H2>
      <P>{gt("Channel overwrites modify role or member permissions per-channel:")}</P>
      <CodeBlock lang="json">{`{
  "id": "role_or_member_id",
  "type": 0,  // 0 = role, 1 = member
  "allow": "1024",  // permissions to grant
  "deny": "0"       // permissions to remove
}`}</CodeBlock>

      <H2 id="bot-permissions">{gt("Bot Permissions in OAuth2")}</H2>
      <P>
        {gt("When inviting a bot via OAuth2, pass permissions as the")} <InlineCode>permissions</InlineCode>{" "}
        {gt("parameter in the authorize URL:")}
      </P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?client_id=ID&scope=bot&permissions=8`}</CodeBlock>
      <P>
        <InlineCode>permissions=8</InlineCode> {gt("is the Administrator permission. Use a")}{" "}
        <Link2 href="/developers/applications">{gt("permissions calculator")}</Link2> {gt("to generate the right value.")}
      </P>

      <Callout type="warning" title={gt("Privileged Intents")}>
        {gt("Some permissions require")}{" "}<Strong>{gt("privileged gateway intents")}</Strong> {gt("to be enabled in the Developer Portal:")} <InlineCode>GUILD_PRESENCES</InlineCode>,{" "}
        <InlineCode>GUILD_MEMBERS</InlineCode>, {gt("and")} <InlineCode>MESSAGE_CONTENT</InlineCode>.
      </Callout>
    </DocPage>
  );
}
