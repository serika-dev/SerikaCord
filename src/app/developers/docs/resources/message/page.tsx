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
        [gt("Is Components V2"), "1 << 15", gt("The message is laid out with components only (see Components V2 below); can't be removed once set")],
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

      <H2 id="components-v2">{gt("Components V2")}</H2>
      <P>
        {gt("Set the IS_COMPONENTS_V2 flag (1 << 15, 32768) to build the whole message from layout components, exactly like Discord. It works on bot messages (create and edit), interaction responses and followups (including ephemeral ones), and webhooks (with ?with_components=true). The same payload you send to Discord works here.")}
      </P>
      <Table headers={[gt("Type"), gt("Component"), gt("Rules")]} rows={[
        ["17", gt("Container"), gt("Top level only (no nested containers). Holds action rows, sections, text displays, media galleries, files and separators. accent_color 0x000000-0xFFFFFF or null, spoiler")],
        ["9", gt("Section"), gt("1 to 3 text displays plus one accessory: a thumbnail or a button")],
        ["10", gt("Text Display"), gt("Markdown text with mentions, emoji and timestamps")],
        ["11", gt("Thumbnail"), gt("Only as a section accessory. media.url, description (up to 1024), spoiler")],
        ["12", gt("Media Gallery"), gt("1 to 10 items, each with media.url, description (up to 1024) and spoiler")],
        ["13", gt("File"), gt("file.url must be attachment://filename of a file uploaded with the message; spoiler. The response adds name and size")],
        ["14", gt("Separator"), gt("divider (default true) and spacing 1 (small, default) or 2 (large)")],
        ["1", gt("Action Row"), gt("Up to 5 buttons or one select menu, as without the flag")],
      ]} />
      <UL>
        <li>{gt("content, embeds, poll and sticker_ids must be empty or absent. A v2 message without components is empty (50006).")}</li>
        <li>{gt("Up to 40 components in total, counting nested ones and section accessories, and up to 4000 characters across all text displays.")}</li>
        <li>{gt("Every component has a numeric id. Leave it out (or send 0) and it is assigned in order, skipping the ids you set; ids must be unique 32-bit integers.")}</li>
        <li>{gt("Media URLs must be http(s) or attachment://filename. External images are shown through an image proxy, never loaded straight from your host by every viewer.")}</li>
        <li>{gt("Attachments are only shown through file, media gallery and thumbnail components.")}</li>
        <li>{gt("The flag can't be removed on edit. Editing a v2 message keeps it even if you leave flags out, and turning it on requires clearing content and embeds.")}</li>
        <li>{gt("Webhooks that don't belong to an application may only send non-interactive components (layouts and link buttons).")}</li>
      </UL>
      <P>
        {gt("Errors come back as 50035 Invalid Form Body with the path of the bad field, for example components.0.components.1.accessory.media.url.")}
      </P>
      <CodeBlock lang="json">{`{
  "flags": 32768,
  "components": [
    {
      "type": 17,
      "accent_color": 5793266,
      "components": [
        { "type": 10, "content": "# Weekly report\nEverything you need, in one card." },
        {
          "type": 9,
          "components": [
            { "type": 10, "content": "**Uptime** 99.98%" },
            { "type": 10, "content": "-# Updated <t:1767225600:R>" }
          ],
          "accessory": { "type": 11, "media": { "url": "attachment://chart.png" }, "description": "Uptime chart" }
        },
        { "type": 14, "divider": true, "spacing": 1 },
        {
          "type": 12,
          "items": [
            { "media": { "url": "https://example.com/a.png" }, "description": "Before" },
            { "media": { "url": "https://example.com/b.png" }, "description": "After", "spoiler": true }
          ]
        },
        { "type": 13, "file": { "url": "attachment://report.pdf" } },
        {
          "type": 1,
          "components": [
            { "type": 2, "style": 1, "label": "Acknowledge", "custom_id": "report_ack" },
            { "type": 2, "style": 5, "label": "Dashboard", "url": "https://example.com/dashboard" }
          ]
        }
      ]
    }
  ]
}`}</CodeBlock>
      <P>
        {gt("Send it as multipart/form-data with files[0] = chart.png and files[1] = report.pdf and the JSON above in payload_json, so the attachment:// references resolve.")}
      </P>

      <Callout type="warning" title={gt("Message Limits")}>
        {gt("Messages have a 2000 character limit for content, 4096 for embed descriptions, and 6000 total for embeds. Files up to 25 MB (or 500 MB for boosted servers).")}
      </Callout>
    </DocPage>
  );
}
