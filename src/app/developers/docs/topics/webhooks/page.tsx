import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Webhooks",
  description:
    "SerikaCord webhooks: create, execute, edit, and delete webhooks. Send messages without a bot user, manage webhook tokens, and use embeds.",
  path: "/developers/docs/topics/webhooks",
  keywords: ["SerikaCord webhooks", "webhook execute", "channel webhook", "incoming webhook"],
});

export default async function WebhooksDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Webhooks")} description={gt("Use webhooks to send messages to channels without a bot user or gateway connection. Full CRUD, execution, and embed support.")}>
      <H2 id="what-are-webhooks">{gt("What Are Webhooks?")}</H2>
      <P>
        {gt("Webhooks are a way to post messages to channels without needing a bot user or gateway connection. They're ideal for CI/CD notifications, monitoring alerts, and integrations where a full bot would be overkill.")}
      </P>
      <P>
        {gt("A webhook has two parts: an")}{" "}<Strong>ID</Strong> {gt("and a")}{" "}<Strong>token</Strong>. {gt("The token is embedded in the webhook URL and serves as authentication — no")}{" "}<InlineCode>Authorization</InlineCode>{" "}
        {gt("header is needed to execute a webhook.")}
      </P>

      <H2 id="webhook-object">{gt("Webhook Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "type": 1,
  "guild_id": "1234567890",
  "channel_id": "1234567890",
  "name": "My Webhook",
  "avatar": null,
  "token": "webhook_token_here",
  "application_id": null,
  "url": "https://api.serika.chat/api/webhooks/123/abc"
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["id", "snowflake", gt("Webhook ID")],
        ["type", "integer", gt("1 = Incoming, 2 = Channel Follower, 3 = Application")],
        ["guild_id", "snowflake", gt("Guild ID the webhook is in (null for some types)")],
        ["channel_id", "snowflake", gt("Channel ID the webhook sends to")],
        ["name", "string", gt("Default username for messages")],
        ["avatar", "string?", gt("Default avatar hash")],
        ["token", "string", gt("Webhook token (only returned on creation)")],
        ["application_id", "snowflake?", gt("Application that created the webhook (for type 3)")],
        ["url", "string", gt("Full webhook URL (only returned on creation)")],
      ]} />

      <H2 id="webhook-types">{gt("Webhook Types")}</H2>
      <Table headers={[gt("Type"), gt("Value"), gt("Description")]} rows={[
        [gt("Incoming"), "1", gt("Can send messages to a channel via POST")],
        [gt("Channel Follower"), "2", gt("Follows announcements from another channel")],
        [gt("Application"), "3", gt("Used by applications for interaction follow-ups")],
      ]} />

      <H2 id="channel-webhooks">{gt("Channel Webhooks")}</H2>

      <H3 id="create">{gt("Create a Webhook")}</H3>
      <Endpoint method="POST" path="/channels/{channel.id}/webhooks">
        {gt("Requires")}{" "}<InlineCode>MANAGE_WEBHOOKS</InlineCode> {gt("permission.")}
      </Endpoint>
      <CodeBlock lang="json">{`{
  "name": "My Webhook",
  "avatar": "data:image/png;base64,..."
}`}</CodeBlock>
      <Table headers={[gt("Parameter"), gt("Required"), gt("Description")]} rows={[
        ["name", gt("Yes"), gt("1-80 character name for the webhook")],
        ["avatar", gt("No"), gt("Base64 data URI for the webhook avatar")],
      ]} />

      <H3 id="execute">{gt("Execute a Webhook")}</H3>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}">
        {gt("Send a message via webhook. No authentication header needed — the URL contains the token.")}
      </Endpoint>
      <CodeBlock lang="json">{`{
  "content": "Hello from a webhook!",
  "username": "Custom Name",
  "avatar_url": "https://example.com/avatar.png",
  "embeds": [{
    "title": "Embed Title",
    "description": "Embed description",
    "color": 0x8B5CF6,
    "fields": [
      { "name": "Field 1", "value": "Value 1", "inline": true }
    ],
    "footer": { "text": "Footer text" },
    "timestamp": "2025-01-01T00:00:00.000Z"
  }]
}`}</CodeBlock>
      <Table headers={[gt("Parameter"), gt("Required"), gt("Description")]} rows={[
        ["content", gt("One of content/embeds"), gt("Message text (max 2000 chars)")],
        ["embeds", gt("One of content/embeds"), gt("Array of embed objects (max 10)")],
        ["username", gt("No"), gt("Override the webhook's default username")],
        ["avatar_url", gt("No"), gt("Override the webhook's default avatar")],
        ["tts", gt("No"), gt("If true, message is sent as text-to-speech")],
        ["allowed_mentions", gt("No"), gt("Control which mentions are parsed")],
        ["components", gt("No"), gt("Message components (buttons, select menus)")],
        ["files", gt("No"), gt("Attachments (multipart/form-data)")],
      ]} />
      <P>{gt("Optional query parameters:")}</P>
      <Table headers={[gt("Parameter"), gt("Description")]} rows={[
        ["wait", gt("If true, waits and returns the message object (default: false)")],
        ["thread_id", gt("Send to a specific thread in the channel")],
        ["with_components", gt("Include components in the response")],
      ]} />
      <CodeBlock lang="bash">{`# Execute a webhook and wait for the message object
curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hello!"}' \\
  "https://api.serika.chat/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN?wait=true"`}</CodeBlock>

      <H3 id="edit-message">{gt("Edit a Webhook Message")}</H3>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        {gt("Edit a message sent by the webhook. Use")}{" "}<InlineCode>@original</InlineCode> {gt("as the message ID to edit the first message.")}
      </Endpoint>

      <H3 id="delete-message">{gt("Delete a Webhook Message")}</H3>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        {gt("Delete a message sent by the webhook. Use")}{" "}<InlineCode>@original</InlineCode> {gt("to delete the first message.")}
      </Endpoint>

      <H2 id="managing-webhooks">{gt("Managing Webhooks")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">{gt("List webhooks in a channel (requires MANAGE_WEBHOOKS).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List webhooks in a guild (requires MANAGE_WEBHOOKS).")}</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">{gt("Get a webhook by ID (requires token for avatar).")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}">{gt("Update a webhook (name, avatar, channel_id).")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Update a webhook using its token (no auth header needed).")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}">{gt("Delete a webhook (requires MANAGE_WEBHOOKS).")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Delete a webhook using its token (no auth header needed).")}</Endpoint>

      <H2 id="embeds">{gt("Embeds")}</H2>
      <P>
        {gt("Webhooks can include rich embeds. Each embed can have a title, description, color, fields, footer, image, thumbnail, and timestamp:")}
      </P>
      <CodeBlock lang="json">{`{
  "title": "Build Status",
  "description": "The build completed successfully.",
  "url": "https://ci.example.com/build/42",
  "color": 0x00FF00,
  "fields": [
    { "name": "Duration", "value": "2m 34s", "inline": true },
    { "name": "Commit", "value": "abc1234", "inline": true }
  ],
  "thumbnail": { "url": "https://example.com/thumb.png" },
  "image": { "url": "https://example.com/screenshot.png" },
  "footer": { "text": "CI Bot", "icon_url": "https://example.com/icon.png" },
  "timestamp": "2025-01-01T12:00:00.000Z"
}`}</CodeBlock>

      <Callout type="warning" title={gt("Webhook Token Security")}>
        {gt("The webhook token is the only authentication needed to send messages. Keep it secret — anyone with the URL can post messages. If a token is compromised, delete and recreate the webhook.")}
      </Callout>

      <Callout type="info" title={gt("Webhooks vs Bots")}>
        {gt("Webhooks are")}{" "}<Strong>{gt("outbound only")}</Strong> — {gt("they can send messages but cannot read messages, join voice, or receive gateway events. If you need to read or react to messages, use a bot instead. You can combine both: a bot for reading events and a webhook for posting to channels the bot doesn't have access to.")}
      </Callout>
    </DocPage>
  );
}
