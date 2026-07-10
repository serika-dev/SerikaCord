import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Application",
  description: "SerikaCord Application resource: object structure, endpoints, flags, install parameters, and custom install URL.",
  path: "/developers/docs/resources/application",
  keywords: ["SerikaCord application", "app object", "application flags", "install params"],
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
  "team": null,
  "bot_public": true,
  "bot_require_code_grant": false,
  "terms_of_service_url": null,
  "privacy_policy_url": null,
  "verify_key": "abc123",
  "flags": 0,
  "install_params": {
    "scopes": ["bot", "applications.commands"],
    "permissions": "8"
  }
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/applications/{application.id}">{gt("Get an application.")}</Endpoint>
      <Endpoint method="GET" path="/applications/@me">{gt("Get the current application (bot token auth).")}</Endpoint>
      <Endpoint method="PATCH" path="/applications/{application.id}">{gt("Update an application.")}</Endpoint>

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
    </DocPage>
  );
}
