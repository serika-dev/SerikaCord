import { DocPage, P, H2, CodeBlock, Callout, InlineCode, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Audit Log",
  description: "SerikaCord Audit Log resource: entry object, action types, query parameters, and retention policy.",
  path: "/developers/docs/resources/audit-log",
  keywords: ["SerikaCord audit log", "audit entry", "action types", "guild audit"],
});

export default async function AuditLogDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Audit Log")} description={gt("View audit logs to track administrative actions in a guild.")}>
      <P>
        {gt("Audit logs record administrative actions taken in a guild, such as member kicks, role changes, channel modifications, and more.")}
      </P>

      <H2 id="endpoint">{gt("Endpoint")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/audit-logs">
        {gt("Requires")}{" "}<InlineCode>VIEW_AUDIT_LOG</InlineCode> {gt("permission. Supports query params:")}
        <InlineCode>user_id</InlineCode>, <InlineCode>action_type</InlineCode>,{" "}
        <InlineCode>before</InlineCode>, <InlineCode>after</InlineCode>, <InlineCode>limit</InlineCode>.
      </Endpoint>

      <H2 id="audit-log-entry">{gt("Audit Log Entry Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "user_id": "1234567890",
  "target_id": "1234567890",
  "action_type": 20,
  "changes": [...],
  "reason": "Spam"
}`}</CodeBlock>

      <H2 id="action-types">{gt("Action Types")}</H2>
      <Table headers={[gt("Action"), gt("Value")]} rows={[
        ["GUILD_UPDATE", "1"],
        ["CHANNEL_CREATE", "10"],
        ["CHANNEL_UPDATE", "11"],
        ["CHANNEL_DELETE", "12"],
        ["CHANNEL_OVERWRITE_CREATE", "13"],
        ["CHANNEL_OVERWRITE_UPDATE", "14"],
        ["CHANNEL_OVERWRITE_DELETE", "15"],
        ["MEMBER_KICK", "20"],
        ["MEMBER_PRUNE", "21"],
        ["MEMBER_BAN_ADD", "22"],
        ["MEMBER_BAN_REMOVE", "23"],
        ["MEMBER_UPDATE", "24"],
        ["MEMBER_ROLE_UPDATE", "25"],
        ["MEMBER_MOVE", "26"],
        ["MEMBER_DISCONNECT", "27"],
        ["BOT_ADD", "28"],
        ["ROLE_CREATE", "30"],
        ["ROLE_UPDATE", "31"],
        ["ROLE_DELETE", "32"],
        ["INVITE_CREATE", "40"],
        ["INVITE_UPDATE", "41"],
        ["INVITE_DELETE", "42"],
        ["WEBHOOK_CREATE", "50"],
        ["WEBHOOK_UPDATE", "51"],
        ["WEBHOOK_DELETE", "52"],
        ["EMOJI_CREATE", "60"],
        ["EMOJI_UPDATE", "61"],
        ["EMOJI_DELETE", "62"],
        ["STICKER_CREATE", "70"],
        ["STICKER_UPDATE", "71"],
        ["STICKER_DELETE", "72"],
        ["GUILD_SCHEDULED_EVENT_CREATE", "80"],
        ["GUILD_SCHEDULED_EVENT_UPDATE", "81"],
        ["GUILD_SCHEDULED_EVENT_DELETE", "82"],
        ["STAGE_INSTANCE_CREATE", "83"],
        ["STAGE_INSTANCE_UPDATE", "84"],
        ["STAGE_INSTANCE_DELETE", "85"],
        ["THREAD_CREATE", "110"],
        ["THREAD_UPDATE", "111"],
        ["THREAD_DELETE", "112"],
        ["APPLICATION_COMMAND_PERMISSION_UPDATE", "121"],
        ["SOUNDBOARD_SOUND_CREATE", "130"],
        ["SOUNDBOARD_SOUND_UPDATE", "131"],
        ["SOUNDBOARD_SOUND_DELETE", "132"],
        ["AUTO_MODERATION_RULE_CREATE", "140"],
        ["AUTO_MODERATION_RULE_UPDATE", "141"],
        ["AUTO_MODERATION_RULE_DELETE", "142"],
        ["AUTO_MODERATION_BLOCK_MESSAGE", "143"],
      ]} />

      <Callout type="info" title={gt("Retention")}>
        {gt("Audit logs are retained for 90 days. Entries are returned in reverse chronological order.")}
      </Callout>
      <P>
        <InlineCode>before</InlineCode> {gt("and")} <InlineCode>after</InlineCode> {gt("take entry ids;")}{" "}
        <InlineCode>target_id</InlineCode> {gt("filters by target. The response also lists the users, webhooks, threads, integrations and AutoMod rules the entries refer to.")}
      </P>

      <H2 id="auto-moderation">{gt("Auto Moderation")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/auto-moderation/rules">{gt("List AutoMod rules. Requires Manage Server.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/auto-moderation/rules/{rule.id}">{gt("Get an AutoMod rule.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/auto-moderation/rules">{gt("Create an AutoMod rule. A timeout action also needs Moderate Members.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/auto-moderation/rules/{rule.id}">{gt("Update an AutoMod rule (the trigger type can't change).")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/auto-moderation/rules/{rule.id}">{gt("Delete an AutoMod rule.")}</Endpoint>
      <Callout type="warning" title={gt("Supported Rules")}>
        {gt("SerikaCord supports message rules (event type 1) with keyword (1), spam (3) and mention spam (5) triggers, and block, alert and timeout actions. Keyword presets, member profile rules, regex patterns and blocking member interactions are not supported. The link filter appears as a keyword rule whose allow list holds the allowed domains.")}
      </Callout>
    </DocPage>
  );
}
