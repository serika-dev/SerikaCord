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
        ["name", gt("Yes"), gt("1-80 character name for the webhook. May not contain clyde or discord, nor serika, system, staff, admin or moderator")],
        ["avatar", gt("No"), gt("Image data as a data URI (PNG, JPEG, GIF or WebP), uploaded to SerikaCord's storage like Discord does. One of SerikaCord's own CDN URLs or null also works; other URLs are rejected")],
      ]} />
      <P>{gt("A channel can have up to 15 webhooks; creating one more answers 30007.")}</P>

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
        ["components", gt("No"), gt("Message components; only used with ?with_components=true. Application-owned webhooks may send buttons and selects, other webhooks link buttons and layout components")],
        ["flags", gt("No"), gt("SUPPRESS_EMBEDS, SUPPRESS_NOTIFICATIONS and IS_COMPONENTS_V2")],
        ["thread_name", gt("No"), gt("In a forum channel: create a post with this title")],
        ["applied_tags", gt("No"), gt("With thread_name: up to 5 of the forum's tag ids, applied when the post is created (like Discord, they are not used when posting into an existing thread)")],
        ["poll", gt("No"), gt("A Discord poll create request (question, answers, duration, allow_multiselect)")],
        ["files[n]", gt("No"), gt("Files as multipart/form-data, with the JSON body in payload_json")],
      ]} />
      <P>{gt("Optional query parameters:")}</P>
      <Table headers={[gt("Parameter"), gt("Description")]} rows={[
        ["wait", gt("If true, waits and returns the message object (default: false)")],
        ["thread_id", gt("Send to a specific thread in the channel")],
        ["with_components", gt("Use the components field (Discord ignores it without this)")],
      ]} />
      <P>
        {gt("With flags set to 32768 (IS_COMPONENTS_V2) and ?with_components=true, a webhook can post a Components V2 layout (containers, sections, galleries, files) instead of content and embeds. See")}{" "}<Link2 href="/developers/docs/resources/message#components-v2">{gt("Components V2")}</Link2>.
      </P>
      <P>
        {gt("The username and avatar_url overrides are kept with the message, so it shows the same name after a reload. Old webhook URLs of the form /api/webhooks/CHANNEL_ID/TOKEN keep working.")}
      </P>
      <CodeBlock lang="bash">{`# Execute a webhook and wait for the message object
curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Hello!"}' \\
  "https://api.serika.chat/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN?wait=true"`}</CodeBlock>

      <H3 id="edit-message">{gt("Edit a Webhook Message")}</H3>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        {gt("Edit a message sent by the webhook (content, embeds, components, attachments, flags). For interaction tokens,")}{" "}<InlineCode>@original</InlineCode> {gt("is the interaction's first response.")}
      </Endpoint>

      <H3 id="delete-message">{gt("Delete a Webhook Message")}</H3>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        {gt("Delete a message sent by the webhook.")}
      </Endpoint>

      <H2 id="slack-compatible">{gt("Slack-Compatible Webhooks")}</H2>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}/slack">
        {gt("Accepts a Slack incoming-webhook payload, so tools that only speak Slack can post to SerikaCord.")}
      </Endpoint>
      <Table headers={[gt("Field"), gt("Description")]} rows={[
        ["text", gt("Message text. Slack mrkdwn is converted to markdown: links, bold, strikethrough and HTML entities. Special mentions such as here, channel and everyone become plain words and never ping")],
        ["username", gt("Overrides the webhook's name for this message")],
        ["icon_url", gt("Overrides the webhook's avatar (http or https URL)")],
        ["attachments", gt("Each attachment becomes an embed (up to 10): color, author, title and link, text, fields, image, thumbnail, footer and ts. Attachment pretext is added to the message text")],
      ]} />
      <P>
        {gt("Attachment colors take good, warning, danger or a hex color. The route answers 200 with the text ok, like Slack, or the message object with ?wait=true. ?thread_id posts into a thread. A form post with the JSON in a payload field works too. In a forum channel, pass ?thread_id; a Slack payload can't start a new post.")}
      </P>
      <CodeBlock lang="bash">{`curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"text":"Deploy *finished* <https://ci.example.com/42|build 42>","attachments":[{"color":"good","title":"Production","text":"All checks passed"}]}' \\
  "https://api.serika.chat/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN/slack"`}</CodeBlock>

      <H2 id="github-compatible">{gt("GitHub-Compatible Webhooks")}</H2>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}/github">
        {gt("Accepts GitHub webhook deliveries and posts them as embeds under the name GitHub. The event name is read from the X-GitHub-Event header.")}
      </Endpoint>
      <Table headers={[gt("Event"), gt("Posted for")]} rows={[
        ["push", gt("New commits (up to 5 listed), or a force-push with no new commits")],
        ["create, delete", gt("A branch or tag created or deleted")],
        ["issues", gt("opened, closed, reopened")],
        ["issue_comment", gt("created (on an issue or pull request)")],
        ["pull_request", gt("opened, closed, merged, reopened")],
        ["pull_request_review", gt("submitted (approved, changes requested, or commented)")],
        ["pull_request_review_comment", gt("created")],
        ["commit_comment", gt("Every comment")],
        ["release", gt("published")],
        ["star, watch", gt("A new star")],
        ["fork", gt("A new fork")],
        ["member", gt("added")],
        ["public", gt("The repository was made public")],
        ["discussion", gt("created, answered")],
        ["discussion_comment", gt("created")],
        ["check_run, check_suite", gt("completed, with the conclusion and branch")],
      ]} />
      <P>
        {gt("Every other event or action, including GitHub's ping, is accepted with 204 and posts nothing, so GitHub's delivery log stays green. A wrong webhook id or token answers 404 (10015). Both application/json and form posts (JSON in the payload field) are accepted, and ?wait=true and ?thread_id work as on the normal execute route.")}
      </P>
      <P>
        {gt("To set it up in GitHub, open the repository's Settings, then Webhooks, then Add webhook. Use the webhook URL with /github added as the Payload URL and application/json as the content type, then pick the events you want. The same can be done through GitHub's API:")}
      </P>
      <CodeBlock lang="bash">{`curl -X POST \\
  -H "Authorization: Bearer GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github+json" \\
  -d '{
    "name": "web",
    "active": true,
    "events": ["push", "pull_request", "issues", "release"],
    "config": {
      "url": "https://api.serika.chat/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN/github",
      "content_type": "json"
    }
  }' \\
  "https://api.github.com/repos/OWNER/REPO/hooks"

# Send a test delivery yourself
curl -X POST \\
  -H "Content-Type: application/json" \\
  -H "X-GitHub-Event: star" \\
  -d '{"action":"created","repository":{"full_name":"owner/repo","html_url":"https://github.com/owner/repo"},"sender":{"login":"octocat"}}' \\
  "https://api.serika.chat/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN/github"`}</CodeBlock>
      <Callout type="info" title={gt("Versioned and Unversioned URLs")}>
        {gt("The Slack and GitHub routes work with and without the version prefix: /api/webhooks/ID/TOKEN/github and /api/v10/webhooks/ID/TOKEN/github are the same endpoint.")}
      </Callout>

      <H2 id="managing-webhooks">{gt("Managing Webhooks")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">{gt("List webhooks in a channel (requires MANAGE_WEBHOOKS).")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List webhooks in a guild (requires MANAGE_WEBHOOKS).")}</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">{gt("Get a webhook by ID (requires token for avatar).")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}">{gt("Update a webhook (name, avatar, channel_id). avatar takes image data, one of our CDN URLs, or null to remove it.")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Update a webhook's name or avatar using its token (no auth header needed; channel_id needs a bot token).")}</Endpoint>
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
