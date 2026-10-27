import { DocPage, P, H2, H3, CodeBlock, Callout, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Application",
  description: "SerikaCord Application resource: object structure, endpoints, editable fields, flags, install parameters, custom install URL and Activities attachments.",
  path: "/developers/docs/resources/application",
  keywords: ["SerikaCord application", "app object", "application flags", "install params", "edit current application"],
});

export default async function ApplicationDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Application")} description={gt("Manage your SerikaCord application, including commands, handlers, and metadata.")}>
      <H2 id="application-object">{gt("Application Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "name": "My App",
  "icon": null,
  "description": "A cool app",
  "summary": "",
  "type": null,
  "bot_public": true,
  "bot_require_code_grant": false,
  "verify_key": "abc123",
  "team": null,
  "flags": 0,
  "approximate_guild_count": 3,
  "redirect_uris": ["https://your-site.com/callback"],
  "interactions_endpoint_url": null,
  "role_connections_verification_url": null,
  "event_webhooks_url": null,
  "event_webhooks_status": 1,
  "event_webhooks_types": [],
  "explicit_content_filter": 0,
  "tags": ["moderation"],
  "install_params": {
    "scopes": ["bot", "applications.commands"],
    "permissions": "8"
  },
  "integration_types_config": {
    "0": {
      "oauth2_install_params": {
        "scopes": ["bot", "applications.commands"],
        "permissions": "8"
      }
    }
  },
  "custom_install_url": "https://your-site.com/install"
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/applications/@me">{gt("Get the current application (bot token auth). Also served at /oauth2/applications/@me.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{application.id}">{gt("Get an application. A bot can only read its own application.")}</Endpoint>
      <Endpoint method="PATCH" path="/applications/@me">{gt("Edit the current application (bot token auth). Returns the updated application object.")}</Endpoint>
      <Endpoint method="PATCH" path="/applications/{application.id}">{gt("Same as PATCH /applications/@me, for your own application id only. Any other id answers 403 Missing Access.")}</Endpoint>
      <Endpoint method="POST" path="/applications/{application.id}/attachment">{gt("Upload a file for an Activity. See Activities attachments below.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{application.id}/activity-instances/{instance_id}">{gt("Always answers 404: SerikaCord does not run Embedded App activities, so there are no activity instances.")}</Endpoint>

      <H2 id="edit-current-application">{gt("Edit Current Application")}</H2>
      <P>
        {gt("PATCH reads the same fields Discord lets an app edit. Send only the fields you want to change. Every invalid field is reported together in one 50035 Invalid Form Body response, and nothing is saved in that case.")}
      </P>
      <Table headers={[gt("Field"), gt("Rules")]} rows={[
        ["description", gt("Up to 400 characters. null clears it.")],
        ["icon / cover_image", gt("Image data (a data:image/...;base64 URI). The image is uploaded and checked by Trust & Safety like other uploads; a blocked image is refused. null removes it.")],
        ["interactions_endpoint_url", gt("An https URL. Before it is saved, SerikaCord sends it a signed PING and expects a PONG, the same check the Developer Portal runs. A failed check answers APPLICATION_INTERACTION_ENDPOINT_URL_INVALID. null clears it.")],
        ["custom_install_url", gt("An http or https URL, up to 2048 characters. null or an empty string clears it.")],
        ["install_params", gt("Default install scopes and permissions. Scopes may be bot, applications.commands, applications.commands.permissions.update, identify, email, guilds, guilds.join, guilds.members.read, connections, messages.read and webhook.incoming. Permissions need the bot scope.")],
        ["integration_types_config", gt("Read for the guild install type (key 0): its oauth2_install_params is treated like install_params. Apps are installed to servers only.")],
        ["flags", gt("Only the privileged intent bits are read. Setting the regular or the _LIMITED bit for presence, guild members or message content turns that intent on; leaving both off turns it off. Other bits are ignored.")],
        ["tags", gt("Up to 5 tags of 1 to 20 characters.")],
        ["role_connections_verification_url", gt("An http or https URL. Stored and returned; see Application Role Connection Metadata.")],
        ["event_webhooks_url", gt("An https URL. Stored and returned.")],
        ["event_webhooks_types", gt("Event types from Discord's list (APPLICATION_AUTHORIZED, ENTITLEMENT_CREATE, LOBBY_MESSAGE_CREATE and so on). Stored and returned.")],
        ["event_webhooks_status", gt("Only 1 (disabled) is accepted. 2 (enabled) is refused with 50035 because SerikaCord does not deliver webhook events.")],
        ["explicit_content_filter", gt("0 or 1. Stored and returned.")],
        ["max_participants", gt("An integer of -1 or more. Stored and returned. null clears it.")],
        ["type", gt("Cannot be changed. Only null is accepted.")],
        ["team_id", gt("Must match the application's current team (or be null when it has none). Moving an app to another team answers APPLICATION_TEAM_TRANSFER_UNSUPPORTED; do that in the Developer Portal.")],
      ]} />
      <CodeBlock lang="bash">{`curl -X PATCH https://api.serika.chat/api/v10/applications/@me \\
  -H "Authorization: Bot YOUR_BOT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"description": "Moderation and fun commands", "tags": ["moderation", "fun"]}'`}</CodeBlock>
      <Callout type="warning" title={gt("Webhook events are not delivered")}>
        {gt("SerikaCord stores event_webhooks_url and event_webhooks_types so existing tools keep working, but it never sends webhook events. Keep event_webhooks_status at 1.")}
      </Callout>

      <H2 id="application-flags">{gt("Application Flags")}</H2>
      <Table headers={[gt("Flag"), gt("Value"), gt("Description")]} rows={[
        [gt("Application Auto Moderation Rule Create"), "1 << 6", gt("Can create auto mod rules")],
        [gt("Gateway Presence"), "1 << 12", gt("Uses presence intent (verified)")],
        [gt("Gateway Presence Limited"), "1 << 13", gt("Presence intent (unverified)")],
        [gt("Gateway Guild Members"), "1 << 14", gt("Uses members intent (verified)")],
        [gt("Gateway Guild Members Limited"), "1 << 15", gt("Members intent (unverified)")],
        [gt("Verification Pending Guild Limit"), "1 << 16", gt("Pending verification")],
        [gt("Embedded"), "1 << 17", gt("Embedded app")],
        [gt("Gateway Message Content"), "1 << 18", gt("Uses message content intent (verified)")],
        [gt("Gateway Message Content Limited"), "1 << 19", gt("Message content intent (unverified)")],
        [gt("Application Command Badge"), "1 << 23", gt("Has slash commands")],
      ]} />

      <H2 id="install-params">{gt("Install Parameters")}</H2>
      <P>
        {gt("Configure default scopes and permissions for your application's install link:")}
      </P>
      <CodeBlock lang="json">{`{
  "install_params": {
    "scopes": ["bot", "applications.commands"],
    "permissions": "8"
  }
}`}</CodeBlock>

      <H2 id="custom-install-url">{gt("Custom Install URL")}</H2>
      <P>
        {gt("Set a custom install URL to override the default OAuth2 flow:")}
      </P>
      <CodeBlock lang="json">{`{
  "custom_install_url": "https://your-site.com/install"
}`}</CodeBlock>

      <H2 id="activities-attachments">{gt("Activities Attachments")}</H2>
      <P>
        {gt("POST /applications/.../attachment takes a multipart form with one file field named file. The file goes through the same upload path as chat attachments: the same file type rules, size limit, Trust & Safety scan and upload rate limit. Your bot token, or any OAuth2 access token issued to this application, may call it.")}
      </P>
      <CodeBlock lang="json">{`{
  "attachment": {
    "id": "1300000000000000000",
    "filename": "screenshot.png",
    "size": 48213,
    "url": "https://cdn.serika.chat/...",
    "proxy_url": "https://cdn.serika.chat/...",
    "content_type": "image/png",
    "width": 1280,
    "height": 720,
    "ephemeral": true
  }
}`}</CodeBlock>
      <P>{gt("width and height are only present for images. An oversized file answers 413 with code 40005; any other rejected file answers 50035.")}</P>

      <H3 id="activity-instances">{gt("Activity instances")}</H3>
      <P>
        {gt("Embedded App activities do not run on SerikaCord, so Get Application Activity Instance answers 404 for every instance id. Your own application id is still required; another app's id answers 403.")}
      </P>
      <P>
        {gt("See also")} <Link2 href="/developers/docs/resources/application-role-connection-metadata">{gt("Application Role Connection Metadata")}</Link2> {gt("and")} <Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2")}</Link2>.
      </P>
    </DocPage>
  );
}
