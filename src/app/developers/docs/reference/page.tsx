import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../DocPage";

export default function ReferenceDoc() {
  return (
    <DocPage title="API Reference" description="Complete reference for the SerikaCord REST API, Gateway, and data structures.">
      <P>
        The SerikaCord API is a 1:1 mirror of the Discord API. All routes, parameters, and response
        structures are identical. This page covers the core reference. For specific resource details,
        see the <Link2 href="/developers/docs/resources/application">Resources</Link2> section.
      </P>

      <H2 id="base-url">Base URL</H2>
      <CodeBlock lang="bash">https://api.serika.chat/api/v10</CodeBlock>

      <H2 id="authentication">Authentication</H2>
      <P>There are two types of authentication:</P>
      <Table
        headers={["Type", "Header", "Use Case"]}
        rows={[
          ["Bot Token", "Authorization: Bot <token>", "Bot API requests"],
          ["Bearer Token", "Authorization: Bearer <token>", "OAuth2 user requests"],
        ]}
      />

      <H2 id="api-versioning">API Versioning</H2>
      <P>
        The API version is part of the URL path. The current version is <InlineCode>v10</InlineCode>.
        Deprecated versions are maintained for backward compatibility.
      </P>
      <Table
        headers={["Version", "Status", "Deprecation Date"]}
        rows={[
          ["v10", "Stable", "—"],
          ["v9", "Deprecated", "TBD"],
          ["v8", "Deprecated", "TBD"],
        ]}
      />

      <H2 id="request-format">Request Format</H2>
      <P>
        All request bodies use <InlineCode>application/json</InlineCode> unless otherwise noted (e.g.,
        file uploads use <InlineCode>multipart/form-data</InlineCode>).
      </P>

      <H2 id="response-format">Response Format</H2>
      <P>All responses are JSON. Successful responses return the requested data or <InlineCode>204 No Content</InlineCode>.</P>

      <H2 id="error-codes">Error Codes</H2>
      <P>Errors return a JSON body with a code and message:</P>
      <CodeBlock lang="json">{`{
  "code": 50001,
  "message": "Missing Access"
}`}</CodeBlock>
      <P>See <Link2 href="/developers/docs/topics/opcodes-and-status-codes">Opcodes & Status Codes</Link2> for the full list.</P>

      <H2 id="common-endpoints">Common Endpoints</H2>

      <H3 id="user-endpoints">User</H3>
      <Endpoint method="GET" path="/users/@me">Get the current authenticated user.</Endpoint>
      <Endpoint method="GET" path="/users/{user.id}">Get a user by ID.</Endpoint>
      <Endpoint method="PATCH" path="/users/@me">Update the current user.</Endpoint>

      <H3 id="guild-endpoints">Guild</H3>
      <Endpoint method="POST" path="/guilds">Create a new guild.</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}">Get a guild.</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}">Update a guild.</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}">Delete a guild.</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/channels">List channels in a guild.</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/members">List members in a guild.</Endpoint>

      <H3 id="channel-endpoints">Channel</H3>
      <Endpoint method="GET" path="/channels/{channel.id}">Get a channel.</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}">Update a channel.</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}">Delete a channel.</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/messages">List messages in a channel.</Endpoint>
      <Endpoint method="POST" path="/channels/{channel.id}/messages">Create a message.</Endpoint>

      <H3 id="message-endpoints">Message</H3>
      <Endpoint method="GET" path="/channels/{channel.id}/messages/{message.id}">Get a message.</Endpoint>
      <Endpoint method="PATCH" path="/channels/{channel.id}/messages/{message.id}">Edit a message.</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/messages/{message.id}">Delete a message.</Endpoint>

      <H3 id="application-endpoints">Application</H3>
      <Endpoint method="GET" path="/applications/@me">Get the current application.</Endpoint>
      <Endpoint method="PUT" path="/applications/{application.id}/commands">Overwrite application commands.</Endpoint>
      <Endpoint method="POST" path="/interactions/{interaction.id}/{interaction.token}/callback">Respond to an interaction.</Endpoint>

      <H2 id="gateway">Gateway</H2>
      <P>
        Connect to the Gateway via WebSocket to receive real-time events:
      </P>
      <CodeBlock lang="bash">wss://api.serika.chat/api/v10/gateway</CodeBlock>
      <P>
        See <Link2 href="/developers/docs/topics/gateway">Gateway</Link2> for connection details and
        event reference.
      </P>

      <H2 id="snowflakes">Snowflake IDs</H2>
      <P>
        All SerikaCord IDs are <Strong>Snowflakes</Strong> — 64-bit integers encoded as strings. They
        encode a timestamp, worker ID, process ID, and increment.
      </P>
      <CodeBlock lang="text">{`Bit layout (64 bits):
[63: 42] Timestamp (ms since epoch)
[41: 17] Worker ID (5 bits) + Process ID (5 bits) + Internal (10 bits)
[16:  0] Increment (12 bits)`}</CodeBlock>

      <H2 id="iso8601">ISO 8601 Timestamps</H2>
      <P>
        All timestamps in the API are ISO 8601 strings (e.g.,{" "}
        <InlineCode>2026-07-05T14:30:00.000Z</InlineCode>).
      </P>

      <Callout type="info" title="Discord Compatibility Note">
        Since SerikaCord mirrors the Discord API 1:1, you can use the official Discord documentation
        as a supplementary reference. Any Discord.js or Discord.py library works with SerikaCord by
        changing the base URL.
      </Callout>
    </DocPage>
  );
}
