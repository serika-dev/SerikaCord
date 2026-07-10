import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Message",
  description: "SerikaCord Message resource: object structure, message types, flags, endpoints for CRUD, bulk delete, and message limits.",
  path: "/developers/docs/resources/message",
  keywords: ["SerikaCord message", "message object", "message types", "message flags", "bulk delete"],
});

export default async function MessageDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Message")} description={gt("Send, edit, and manage messages across channels.")}>
      <H2 id="message-object">{gt("Message Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "channel_id": "1234567890",
  "author": { "id": "123", "username": "user", "bot": false },
  "content": "Hello world!",
  "timestamp": "2026-07-05T14:30:00.000Z",
  "edited_timestamp": null,
  "tts": false,
  "mention_everyone": false,
  "mentions": [],
  "mention_roles": [],
  "attachments": [],
  "embeds": [],
  "reactions": [],
  "pinned": false,
  "type": 0,
  "flags": 0
}`}</CodeBlock>

      <H2 id="message-types">{gt("Message Types")}</H2>
      <Table headers={[gt("Type"), gt("Value")]} rows={[
        [gt("Default"), "0"],
        [gt("Recipient Add"), "1"],
        [gt("Recipient Remove"), "2"],
        [gt("Call"), "3"],
        [gt("Channel Name Change"), "4"],
        [gt("Channel Icon Change"), "5"],
        [gt("Channel Pinned Message"), "6"],
        [gt("User Join"), "7"],
        [gt("Guild Boost"), "8"],
        [gt("Guild Boost Tier 1"), "9"],
        [gt("Guild Boost Tier 2"), "10"],
        [gt("Guild Boost Tier 3"), "11"],
        [gt("Channel Follow Add"), "12"],
        [gt("Guild Discovery Disqualified"), "14"],
        [gt("Reply"), "19"],
        [gt("Application Command"), "20"],
        [gt("Thread Starter Message"), "21"],
        [gt("Guild Invite Reminder"), "22"],
        [gt("ContextMenu Command"), "23"],
        [gt("Auto Moderation Action"), "24"],
      ]} />

      <H2 id="message-flags">{gt("Message Flags")}</H2>
      <Table headers={[gt("Flag"), gt("Value"), gt("Description")]} rows={[
        [gt("Crossposted"), "1 << 0", gt("Published to followed channels")],
        [gt("Is Crosspost"), "1 << 1", gt("Received from another channel")],
        [gt("Suppress Embeds"), "1 << 2", gt("Embeds hidden")],
        [gt("Source Message Deleted"), "1 << 3"],
        [gt("Urgent"), "1 << 4"],
        [gt("Has Thread"), "1 << 5", gt("Message has a thread")],
        [gt("Ephemeral"), "1 << 6", gt("Only visible to author")],
        [gt("Loading"), "1 << 7", gt("Deferred interaction response")],
        [gt("Failed to Mention Roles in Thread"), "1 << 8"],
        [gt("Suppress Notifications"), "1 << 12", gt("No push notification")],
        [gt("Is Voice Message"), "1 << 13"],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/messages">{gt("Create a message.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages">{gt("List messages (max 100 per request).")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}">{gt("Get a message.")}</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}/messages/{message.id}">{gt("Edit a message.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}">{gt("Delete a message.")}</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages/bulk-delete">{gt("Bulk delete (2-100, within 14 days).")}</Endpoint>

      <H2 id="creating-messages">{gt("Creating Messages")}</H2>
      <CodeBlock lang="json">{`{
  "content": "Hello!",
  "tts": false,
  "embeds": [],
  "components": [],
  "reply_to_message_id": "1234567890",
  "allowed_mentions": { "parse": ["users"] }
}`}</CodeBlock>

      <Callout type="warning" title={gt("Message Limits")}>
        {gt("Messages have a 2000 character limit for content, 4096 for embed descriptions, and 6000 total for embeds. Files up to 25 MB (or 500 MB for boosted servers).")}
      </Callout>
    </DocPage>
  );
}
