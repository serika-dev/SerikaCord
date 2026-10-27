import { DocPage, P, H2, H3, CodeBlock, Callout, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Application Role Connection Metadata",
  description: "SerikaCord Application Role Connection Metadata: metadata types, object structure, endpoints, limits and the user's role connection.",
  path: "/developers/docs/resources/application-role-connection-metadata",
  keywords: ["SerikaCord role connection", "role connection metadata", "application metadata", "linked roles"],
});

export default async function ApplicationRoleConnectionMetadataDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Application Role Connection Metadata")} description={gt("Configure role connection metadata for your application to link external accounts with guild roles.")}>
      <P>
        {gt("Application Role Connection Metadata lets your app describe the values it knows about a user (for example a player level or an account creation date). Each user then gets a role connection from your app holding their values. This is Discord's linked roles API, with the same routes, limits and validation.")}
      </P>

      <Callout type="warning" title={gt("Not used for roles yet")}>
        {gt("SerikaCord stores and returns metadata records and user role connections, but no server setting reads them yet: a server cannot require a role connection value to grant a role. The Linked roles option in a server's role settings is a different feature (roles that come with another role).")}
      </Callout>

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
  "type": 2,
  "key": "level",
  "name": "Player Level",
  "name_localizations": { "fr": "Niveau du joueur" },
  "description": "Your player level in the game",
  "description_localizations": { "fr": "Votre niveau dans le jeu" }
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Rules")]} rows={[
        ["type", gt("An integer from 1 to 8 (see Metadata Types).")],
        ["key", gt("1 to 50 characters of a-z, 0-9 and underscore. Unique within the application.")],
        ["name", gt("1 to 100 characters.")],
        ["description", gt("1 to 200 characters.")],
        ["name_localizations / description_localizations", gt("Optional. Keys must be Discord locale codes; values follow the same length limits as name and description.")],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/applications/{application.id}/role-connections/metadata">
        {gt("List the application's metadata records. Bot token of that application.")}
      </Endpoint>
      <Endpoint method="PUT" path="/applications/{application.id}/role-connections/metadata">
        {gt("Replace all metadata records with the array you send (up to 5). Bot token of that application. Returns the stored records.")}
      </Endpoint>

      <Callout type="info" title={gt("Limit")}>
        {gt("Each application can have up to 5 metadata records. Each key must be unique and 1-50 characters.")}
      </Callout>

      <H2 id="user-role-connection">{gt("User Role Connection")}</H2>
      <P>
        {gt("A user's role connection is set by your app with that user's OAuth2 access token. The token must carry the role_connections.write scope and belong to the application in the path; a token of another application answers 403 Missing Access.")}
      </P>
      <CodeBlock lang="json">{`{
  "platform_name": "My Game",
  "platform_username": "seika#ranked",
  "metadata": {
    "level": "42",
    "joined_at": "2024-03-01T00:00:00.000Z",
    "verified": "1"
  }
}`}</CodeBlock>
      <Endpoint method="GET" path="/users/@me/applications/{application.id}/role-connection">
        {gt("Get the token user's role connection for the application. Only values for the app's current metadata keys are returned.")}
      </Endpoint>
      <Endpoint method="PUT" path="/users/@me/applications/{application.id}/role-connection">
        {gt("Update the token user's role connection and return it. Fields you leave out keep their stored value; metadata, when sent, replaces all stored values.")}
      </Endpoint>
      <Endpoint method="DELETE" path="/users/@me/applications/{application.id}/role-connection">
        {gt("Delete the token user's role connection. Returns 204.")}
      </Endpoint>

      <H3 id="user-role-connection-rules">{gt("Validation")}</H3>
      <Table headers={[gt("Field"), gt("Rules")]} rows={[
        ["platform_name", gt("Up to 50 characters. null or an empty string clears it.")],
        ["platform_username", gt("Up to 100 characters. null or an empty string clears it.")],
        ["metadata", gt("An object keyed by your metadata keys. An unknown key is an error. Values are at most 100 characters and must match the record's type. null clears all values.")],
      ]} />
      <Table headers={[gt("Types"), gt("Value format")]} rows={[
        ["1-4", gt("A 64-bit integer, as a number or a string. Stored as a string.")],
        ["5-6", gt("An ISO 8601 date or date-time string. Stored as an ISO 8601 date-time.")],
        ["7-8", gt("A boolean (true, false, 1, 0 or the same as strings). Stored as \"1\" or \"0\".")],
      ]} />
      <P>
        {gt("A rejected value answers 50035 Invalid Form Body with the failing key in the errors object. A missing role_connections.write scope answers 403 with code 50026.")}
      </P>

      <H2 id="verification-url">{gt("Verification URL")}</H2>
      <P>
        {gt("Set")} <InlineCode>role_connections_verification_url</InlineCode> {gt("with")} <Link2 href="/developers/docs/resources/application#edit-current-application">{gt("Edit Current Application")}</Link2>. {gt("It is stored and returned on the application object. SerikaCord does not link to it from any page yet, so send users to your own authorization flow directly.")}
      </P>
    </DocPage>
  );
}
