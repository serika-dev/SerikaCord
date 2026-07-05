import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";

export default function PermissionsDoc() {
  return (
    <DocPage title="Permissions" description="Understand SerikaCord's permission system for bots and users.">
      <P>
        Permissions in SerikaCord are bitwise flags, identical to Discord's system. They can be
        combined using bitwise OR operations.
      </P>

      <H2 id="permission-bits">Permission Bits</H2>
      <Table headers={["Bit", "Permission", "Description"]} rows={[
        ["1 << 0", "CREATE_INSTANT_INVITE", "Create instant invite"],
        ["1 << 1", "KICK_MEMBERS", "Kick members"],
        ["1 << 2", "BAN_MEMBERS", "Ban members"],
        ["1 << 3", "ADMINISTRATOR", "All permissions (implicitly)"],
        ["1 << 4", "MANAGE_CHANNELS", "Manage channels"],
        ["1 << 5", "MANAGE_GUILD", "Manage guild"],
        ["1 << 6", "ADD_REACTIONS", "Add reactions to messages"],
        ["1 << 7", "VIEW_AUDIT_LOG", "View audit log"],
        ["1 << 8", "PRIORITY_SPEAKER", "Priority speaker in voice"],
        ["1 << 9", "STREAM", "Stream in voice channel"],
        ["1 << 10", "VIEW_CHANNEL", "View channel"],
        ["1 << 11", "SEND_MESSAGES", "Send messages"],
        ["1 << 12", "SEND_TTS_MESSAGES", "Send TTS messages"],
        ["1 << 13", "MANAGE_MESSAGES", "Manage/delete messages"],
        ["1 << 14", "EMBED_LINKS", "Embed links in messages"],
        ["1 << 15", "ATTACH_FILES", "Attach files to messages"],
        ["1 << 16", "READ_MESSAGE_HISTORY", "Read message history"],
        ["1 << 17", "MENTION_EVERYONE", "Mention @everyone/@here"],
        ["1 << 18", "USE_EXTERNAL_EMOJIS", "Use external emojis"],
        ["1 << 19", "VIEW_GUILD_INSIGHTS", "View guild insights"],
        ["1 << 20", "CONNECT", "Connect to voice channel"],
        ["1 << 21", "SPEAK", "Speak in voice channel"],
        ["1 << 22", "MUTE_MEMBERS", "Mute members in voice"],
        ["1 << 23", "DEAFEN_MEMBERS", "Deafen members in voice"],
        ["1 << 24", "MOVE_MEMBERS", "Move members between voice channels"],
        ["1 << 25", "USE_VAD", "Use voice activity detection"],
        ["1 << 26", "CHANGE_NICKNAME", "Change own nickname"],
        ["1 << 27", "MANAGE_NICKNAMES", "Manage other members' nicknames"],
        ["1 << 28", "MANAGE_ROLES", "Manage roles"],
        ["1 << 29", "MANAGE_WEBHOOKS", "Manage webhooks"],
        ["1 << 30", "MANAGE_EMOJIS_AND_STICKERS", "Manage emojis and stickers"],
        ["1 << 31", "USE_APPLICATION_COMMANDS", "Use application commands"],
        ["1 << 32", "REQUEST_TO_SPEAK", "Request to speak in stage"],
        ["1 << 33", "MANAGE_EVENTS", "Manage guild events"],
        ["1 << 34", "MANAGE_THREADS", "Manage threads"],
        ["1 << 35", "CREATE_PUBLIC_THREADS", "Create public threads"],
        ["1 << 36", "CREATE_PRIVATE_THREADS", "Create private threads"],
        ["1 << 37", "USE_EXTERNAL_STICKERS", "Use external stickers"],
        ["1 << 38", "SEND_MESSAGES_IN_THREADS", "Send messages in threads"],
        ["1 << 39", "USE_EMBEDDED_ACTIVITIES", "Use embedded activities"],
        ["1 << 40", "MODERATE_MEMBERS", "Timeout members"],
        ["1 << 41", "VIEW_CREATOR_MONETIZATION_ANALYTICS", "View monetization analytics"],
        ["1 << 42", "USE_EXTERNAL_SOUNDS", "Use external sounds"],
        ["1 << 43", "SEND_VOICE_MESSAGES", "Send voice messages"],
      ]} />

      <H2 id="administrator">Administrator Permission</H2>
      <P>
        The <InlineCode>ADMINISTRATOR</InlineCode> permission (bit 3) grants all permissions implicitly.
        Use with caution.
      </P>

      <H2 id="calculating">Calculating Permissions</H2>
      <P>Combine permissions using bitwise OR:</P>
      <CodeBlock lang="javascript">{`// Send Messages + Read Message History + View Channel
const permissions = (1n << 10n) | (1n << 11n) | (1n << 16n);
// = 67648`}</CodeBlock>

      <H2 id="permission-hierarchy">Permission Hierarchy</H2>
      <UL>
        <li>Server owner always has all permissions</li>
        <li>Roles are ordered by position — higher roles manage lower ones</li>
        <li>Channel overwrites can restrict or grant permissions per-channel</li>
        <li>Administrator permission bypasses all overwrites</li>
      </UL>

      <H2 id="channel-overwrites">Channel Overwrites</H2>
      <P>Channel overwrites modify role or member permissions per-channel:</P>
      <CodeBlock lang="json">{`{
  "id": "role_or_member_id",
  "type": 0,  // 0 = role, 1 = member
  "allow": "1024",  // permissions to grant
  "deny": "0"       // permissions to remove
}`}</CodeBlock>

      <H2 id="bot-permissions">Bot Permissions in OAuth2</H2>
      <P>
        When inviting a bot via OAuth2, pass permissions as the <InlineCode>permissions</InlineCode>{" "}
        parameter in the authorize URL:
      </P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?client_id=ID&scope=bot&permissions=8`}</CodeBlock>
      <P>
        <InlineCode>permissions=8</InlineCode> is the Administrator permission. Use a{" "}
        <Link2 href="/developers/applications">permissions calculator</Link2> to generate the right value.
      </P>

      <Callout type="warning" title="Privileged Intents">
        Some permissions require <Strong>privileged gateway intents</Strong> to be enabled in the
        Developer Portal: <InlineCode>GUILD_PRESENCES</InlineCode>,{" "}
        <InlineCode>GUILD_MEMBERS</InlineCode>, and <InlineCode>MESSAGE_CONTENT</InlineCode>.
      </Callout>
    </DocPage>
  );
}
