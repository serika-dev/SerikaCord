import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { MarkdownLivePreview, TimestampLivePreview } from "./LivePreview";

export const metadata = buildMetadata({
  title: "Message Formatting",
  description:
    "Format SerikaCord messages with markdown, mentions, emojis, timestamps, embeds, components, attachments, and allowed_mentions.",
  path: "/developers/docs/topics/message-formatting",
  keywords: ["SerikaCord message formatting", "markdown", "mentions", "embeds", "components"],
});

export default async function MessageFormattingDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Message Formatting")} description={gt("Format messages with markdown, mentions, emojis, and rich embeds.")}>
      <H2 id="markdown">{gt("Markdown Support")}</H2>
      <P>{gt("SerikaCord supports standard markdown plus some extensions:")}</P>
      <MarkdownLivePreview />

      <H2 id="mentions">{gt("Mentions")}</H2>
      <P>{gt("Mentions use special syntax in message content:")}</P>
      <Table headers={[gt("Type"), gt("Syntax")]} rows={[
        [gt("User"), "<@user_id>"],
        [gt("User (nickname)"), "<@!user_id>"],
        [gt("Channel"), "<#channel_id>"],
        [gt("Role"), "<@&role_id>"],
        [gt("Slash command"), "</command_name:command_id>"],
        [gt("Emoji"), "<:emoji_name:emoji_id>"],
        [gt("Animated emoji"), "<a:emoji_name:emoji_id>"],
        [gt("Timestamp"), "<t:timestamp:format>"],
      ]} />

      <H2 id="timestamps">{gt("Timestamp Formatting")}</H2>
      <P>{gt("Use")}{" "}<InlineCode>&lt;t:timestamp:format&gt;</InlineCode> {gt("for localized timestamps. The timestamp is a Unix epoch in seconds:")}</P>
      <TimestampLivePreview />
      <P>{gt("The")}{" "}<InlineCode>C</InlineCode> {gt("format also supports optional parameters inside square brackets:")}</P>
      <Table headers={[gt("Option"), gt("Syntax"), gt("Description")]} rows={[
        [gt("end text"), "<t:timestamp:C[end:00:00:00 (Passed)]>", gt("Text to display when the countdown reaches zero")],
        [gt("color"), "<t:timestamp:C[color:#FF0000]>", gt("Custom hex color for the countdown text (default: accent color)")],
      ]} />
      <P>{gt("Multiple options can be combined:")}{" "}<InlineCode>&lt;t:timestamp:C[end:Done!][color:#FF0000]&gt;</InlineCode></P>

      <H2 id="embeds">{gt("Embeds")}</H2>
      <P>{gt("Rich embeds can be attached to messages:")}</P>
      <CodeBlock lang="json">{`{
  "embeds": [{
    "title": "Embed Title",
    "description": "Embed description text",
    "url": "https://serika.dev",
    "color": 0x8B5CF6,
    "footer": { "text": "Footer text", "icon_url": "https://..." },
    "image": { "url": "https://..." },
    "thumbnail": { "url": "https://..." },
    "author": { "name": "Author name", "icon_url": "https://..." },
    "fields": [
      { "name": "Field 1", "value": "Value 1", "inline": true },
      { "name": "Field 2", "value": "Value 2", "inline": true }
    ],
    "timestamp": "2026-07-05T14:30:00.000Z"
  }]
}`}</CodeBlock>

      <H2 id="embed-limits">{gt("Embed Limits")}</H2>
      <Table headers={[gt("Field"), gt("Limit")]} rows={[
        [gt("Total embed characters"), "6000"],
        [gt("Title"), gt("256 characters")],
        [gt("Description"), gt("4096 characters")],
        [gt("Fields per embed"), "25"],
        [gt("Field name"), gt("256 characters")],
        [gt("Field value"), gt("1024 characters")],
        [gt("Footer text"), gt("2048 characters")],
        [gt("Author name"), gt("256 characters")],
        [gt("Embeds per message"), "10"],
      ]} />
      <Callout type="warning" title={gt("Total character limit")}>
        {gt("The 6000-character limit applies to the")}{" "}<Strong>{gt("sum of all text fields")}</Strong> {gt("across all embeds in a message, not per embed.")}
      </Callout>

      <H2 id="components">{gt("Message Components")}</H2>
      <P>{gt("Interactive components like buttons and select menus:")}</P>
      <Table headers={[gt("Component Type"), gt("Value"), gt("Description")]} rows={[
        [gt("Action Row"), "1", gt("Container for other components (max 5 per row)")],
        [gt("Button"), "2", gt("Clickable button (max 25 per message)")],
        [gt("String Select"), "3", gt("Dropdown menu for text options")],
        [gt("User Select"), "5", gt("Dropdown for selecting users")],
        [gt("Role Select"), "6", gt("Dropdown for selecting roles")],
        [gt("Mentionable Select"), "7", gt("Dropdown for users or roles")],
        [gt("Channel Select"), "8", gt("Dropdown for selecting channels")],
      ]} />
      <P>{gt("Button styles:")}</P>
      <Table headers={[gt("Style"), gt("Value"), gt("Description")]} rows={[
        [gt("Primary"), "1", gt("Blurple button")],
        [gt("Secondary"), "2", gt("Grey button")],
        [gt("Success"), "3", gt("Green button")],
        [gt("Danger"), "4", gt("Red button")],
        [gt("Link"), "5", gt("Link button (navigates to URL, no custom_id)")],
      ]} />
      <CodeBlock lang="json">{`{
  "components": [{
    "type": 1,
    "components": [{
      "type": 2,
      "style": 1,
      "label": "Click me!",
      "custom_id": "my_button"
    }]
  }]
}`}</CodeBlock>

      <H2 id="attachments">{gt("Attachments")}</H2>
      <P>
        {gt("Files can be attached using")}{" "}<InlineCode>multipart/form-data</InlineCode>. {gt("Reference them in the message content using")}{" "}<InlineCode>attachment://filename.ext</InlineCode>.
      </P>

      <H2 id="allowed-mentions">{gt("Allowed Mentions")}</H2>
      <P>
        {gt("Control which mentions are parsed in a message using the")}{" "}
        <InlineCode>allowed_mentions</InlineCode> {gt("field:")}
      </P>
      <CodeBlock lang="json">{`{
  "content": "Hello <@123>!",
  "allowed_mentions": {
    "parse": ["users"],
    "users": ["123"]
  }
}`}</CodeBlock>
    </DocPage>
  );
}
