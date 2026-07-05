import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";

export default function WebhooksDoc() {
  return (
    <DocPage title="Webhooks" description="Use webhooks to receive HTTP callbacks for events or send messages without a bot.">
      <H2 id="what-are-webhooks">What Are Webhooks?</H2>
      <P>
        Webhooks are a way to post messages to channels without needing a bot user or gateway
        connection. They're also used to receive HTTP callbacks for certain events.
      </P>

      <H2 id="channel-webhooks">Channel Webhooks</H2>
      <P>Channel webhooks can send messages to a specific channel via HTTP POST.</P>

      <H3 id="create">Create a Webhook</H3>
      <Endpoint method="POST" path="/channels/{channel.id}/webhooks">
        Requires <InlineCode>MANAGE_WEBHOOKS</InlineCode> permission.
      </Endpoint>
      <CodeBlock lang="json">{`{
  "name": "My Webhook",
  "avatar": "data:image/png;base64,..."
}`}</CodeBlock>

      <H3 id="execute">Execute a Webhook</H3>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}">
        Send a message via webhook. No authentication required — the URL contains the token.
      </Endpoint>
      <CodeBlock lang="json">{`{
  "content": "Hello from a webhook!",
  "username": "Custom Name",
  "avatar_url": "https://...",
  "embeds": [{
    "title": "Embed Title",
    "description": "Embed description",
    "color": 0x8B5CF6
  }]
}`}</CodeBlock>

      <P>Optional query parameters:</P>
      <Table headers={["Parameter", "Description"]} rows={[
        ["wait", "Wait for message to send (returns message object)"],
        ["thread_id", "Send to a specific thread"],
        ["with_components", "Include components in response"],
      ]} />

      <H3 id="edit-message">Edit a Webhook Message</H3>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        Edit a message sent by the webhook.
      </Endpoint>

      <H3 id="delete-message">Delete a Webhook Message</H3>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">
        Delete a message sent by the webhook.
      </Endpoint>

      <H2 id="webhook-object">Webhook Object</H2>
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

      <H2 id="webhook-types">Webhook Types</H2>
      <Table headers={["Type", "Value", "Description"]} rows={[
        ["Incoming", "1", "Can send messages to a channel"],
        ["Channel Follower", "2", "Follows announcements from another channel"],
        ["Application", "3", "Used by applications for interactions"],
      ]} />

      <Callout type="warning" title="Webhook Token Security">
        The webhook token is the only authentication needed to send messages. Keep it secret — anyone
        with the URL can post messages.
      </Callout>

      <H2 id="managing-webhooks">Managing Webhooks</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">List webhooks in a channel.</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">List webhooks in a guild.</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">Get a webhook (requires token for avatar).</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}">Update a webhook.</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}">Delete a webhook.</Endpoint>
    </DocPage>
  );
}
