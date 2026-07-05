import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";

export default function WebhookResourceDoc() {
  return (
    <DocPage title="Webhook" description="Manage webhooks for sending messages and receiving event callbacks.">
      <P>
        See also the <Link2 href="/developers/docs/topics/webhooks">Webhooks topic</Link2> for
        detailed usage and examples.
      </P>

      <H2 id="webhook-object">Webhook Object</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "type": 1,
  "guild_id": "1234567890",
  "channel_id": "1234567890",
  "name": "My Webhook",
  "avatar": null,
  "token": "webhook_token",
  "url": "https://api.serika.chat/api/webhooks/123/abc",
  "application_id": null,
  "source_channel": null,
  "source_guild": null
}`}</CodeBlock>

      <H2 id="endpoints">Endpoints</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/webhooks">Create webhook.</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">List channel webhooks.</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">List guild webhooks.</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">Get webhook (no token needed for basic info).</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}/{webhook.token}">Get webhook with token (includes avatar).</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}">Update webhook (auth token).</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}">Update webhook with token.</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}">Delete webhook.</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}">Delete webhook with token.</Endpoint>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}">Execute webhook.</Endpoint>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}?wait=true">Execute webhook and wait for message.</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">Edit webhook message.</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">Delete webhook message.</Endpoint>

      <H2 id="create-params">Create Parameters</H2>
      <Table headers={["Field", "Type", "Description"]} rows={[
        ["name", "string", "1-80 characters"],
        ["avatar", "data URI", "Base64 avatar image (optional)"],
      ]} />

      <Callout type="warning" title="Token Security">
        The webhook token is only returned on creation and when fetching with the token. If lost, the
        webhook must be recreated.
      </Callout>
    </DocPage>
  );
}
