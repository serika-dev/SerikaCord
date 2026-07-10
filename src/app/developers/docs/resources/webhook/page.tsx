import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Webhook",
  description: "SerikaCord Webhook resource: object structure, CRUD endpoints, execute, edit/delete messages, and create parameters.",
  path: "/developers/docs/resources/webhook",
  keywords: ["SerikaCord webhook", "webhook object", "webhook endpoint", "webhook token"],
});

export default async function WebhookResourceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Webhook")} description={gt("Manage webhooks for sending messages and receiving event callbacks.")}>
      <P>
        {gt("See also the")}{" "}<Link2 href="/developers/docs/topics/webhooks">{gt("Webhooks topic")}</Link2> {gt("for detailed usage and examples.")}
      </P>

      <H2 id="webhook-object">{gt("Webhook Object")}</H2>
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

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/webhooks">{gt("Create webhook.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/webhooks">{gt("List channel webhooks.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/webhooks">{gt("List guild webhooks.")}</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}">{gt("Get webhook (no token needed for basic info).")}</Endpoint>
      <Endpoint method="GET" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Get webhook with token (includes avatar).")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}">{gt("Update webhook (auth token).")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Update webhook with token.")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}">{gt("Delete webhook.")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Delete webhook with token.")}</Endpoint>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}">{gt("Execute webhook.")}</Endpoint>
      <Endpoint method="POST" path="/webhooks/{webhook.id}/{webhook.token}?wait=true">{gt("Execute webhook and wait for message.")}</Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">{gt("Edit webhook message.")}</Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{webhook.id}/{webhook.token}/messages/{message.id}">{gt("Delete webhook message.")}</Endpoint>

      <H2 id="create-params">{gt("Create Parameters")}</H2>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["name", "string", gt("1-80 characters")],
        ["avatar", "data URI", gt("Base64 avatar image (optional)")],
      ]} />

      <Callout type="warning" title={gt("Token Security")}>
        {gt("The webhook token is only returned on creation and when fetching with the token. If lost, the webhook must be recreated.")}
      </Callout>
    </DocPage>
  );
}
