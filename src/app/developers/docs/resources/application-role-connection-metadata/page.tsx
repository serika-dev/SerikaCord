import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Application Role Connection Metadata",
  description: "SerikaCord Application Role Connection Metadata: metadata types, object structure, endpoints, and limits for linking external accounts with guild roles.",
  path: "/developers/docs/resources/application-role-connection-metadata",
  keywords: ["SerikaCord role connection", "role connection metadata", "application metadata"],
});

export default async function ApplicationRoleConnectionMetadataDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Application Role Connection Metadata")} description={gt("Configure role connection metadata for your application to link external accounts with guild roles.")}>
      <P>
        {gt("Application Role Connection Metadata allows your app to define metadata that can be used by guilds to configure role requirements based on external account data.")}
      </P>

      <H2 id="metadata-types">{gt("Metadata Types")}</H2>
      <Table headers={[gt("Type"), gt("Value"), gt("Description")]} rows={[
        [gt("Integer Less Than or Equal"), "1", gt("Role requirement: metadata value <= threshold")],
        [gt("Integer Greater Than or Equal"), "2", gt("Role requirement: metadata value >= threshold")],
        [gt("Integer Equal"), "3", gt("Role requirement: metadata value == threshold")],
        [gt("Integer Not Equal"), "4", gt("Role requirement: metadata value != threshold")],
        [gt("Date Time Less Than or Equal"), "5", gt("Role requirement: date <= threshold")],
        [gt("Date Time Greater Than or Equal"), "6", gt("Role requirement: date >= threshold")],
        [gt("Boolean Equal"), "7", gt("Role requirement: boolean == threshold")],
        [gt("Boolean Not Equal"), "8", gt("Role requirement: boolean != threshold")],
      ]} />

      <H2 id="metadata-object">{gt("Metadata Object")}</H2>
      <CodeBlock lang="json">{`{
  "key": "level",
  "name": "Player Level",
  "description": "Your player level in the game",
  "type": 2
}`}</CodeBlock>

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/applications/{application.id}/role-connections/metadata">
        {gt("List all role connection metadata records for an application.")}
      </Endpoint>
      <Endpoint method="PUT" path="/applications/{application.id}/role-connections/metadata">
        {gt("Update role connection metadata records. Up to 5 records per application.")}
      </Endpoint>

      <Callout type="info" title={gt("Limit")}>
        {gt("Each application can have up to 5 metadata records. Each key must be unique and 1-50 characters.")}
      </Callout>
    </DocPage>
  );
}
