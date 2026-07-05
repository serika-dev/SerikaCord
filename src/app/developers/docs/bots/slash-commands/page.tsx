import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";

export default function SlashCommandsDoc() {
  return (
    <DocPage
      title="Slash Commands"
      description="Application commands let users invoke your bot with a leading slash. Register them once, then handle the resulting interaction."
    >
      <P>
        Slash commands are registered per-application, either <Strong>globally</Strong> or scoped to a
        single <Strong>guild</Strong>. Guild commands update instantly and are great for testing; global
        commands are available everywhere your app is installed.
      </P>

      <Callout type="info" title="Command types">
        <InlineCode>type: 1</InlineCode> is a <Strong>CHAT_INPUT</Strong> (slash) command. User and
        message context-menu commands use types <InlineCode>2</InlineCode> and <InlineCode>3</InlineCode>.
      </Callout>

      <H2 id="register">Registering commands</H2>

      <H3 id="global">Global commands</H3>
      <Endpoint method="PUT" path="/applications/{'{application.id}'}/commands">
        Bulk-overwrite your global commands. Send the full array; anything omitted is removed.
      </Endpoint>
      <CodeBlock lang="bash">{`curl -X PUT \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  https://api.serika.chat/api/v10/applications/APP_ID/commands \\
  -d '[
    {
      "name": "ping",
      "description": "Check that the bot is alive",
      "type": 1
    },
    {
      "name": "echo",
      "description": "Repeat something back",
      "type": 1,
      "options": [
        { "name": "text", "description": "What to say", "type": 3, "required": true }
      ]
    }
  ]'`}</CodeBlock>

      <H3 id="guild">Guild commands</H3>
      <Endpoint method="PUT" path="/applications/{'{application.id}'}/guilds/{'{guild.id}'}/commands">
        Same shape, scoped to one guild. Use this while iterating — changes apply immediately.
      </Endpoint>

      <H2 id="option-types">Option types</H2>
      <Table
        headers={["Type", "Name", "Description"]}
        rows={[
          ["1", "SUB_COMMAND", "A nested sub-command"],
          ["2", "SUB_COMMAND_GROUP", "A group of sub-commands"],
          ["3", "STRING", "A text value"],
          ["4", "INTEGER", "A whole number"],
          ["5", "BOOLEAN", "true / false"],
          ["6", "USER", "A user snowflake"],
          ["7", "CHANNEL", "A channel snowflake"],
          ["8", "ROLE", "A role snowflake"],
          ["10", "NUMBER", "A floating-point number"],
        ]}
      />

      <H2 id="manage">Managing individual commands</H2>
      <Endpoint method="GET" path="/applications/{'{application.id}'}/commands">Fetch all global commands.</Endpoint>
      <Endpoint method="POST" path="/applications/{'{application.id}'}/commands">Create a single command.</Endpoint>
      <Endpoint method="PATCH" path="/applications/{'{application.id}'}/commands/{'{command.id}'}">Edit a command.</Endpoint>
      <Endpoint method="DELETE" path="/applications/{'{application.id}'}/commands/{'{command.id}'}">Delete a command.</Endpoint>

      <H2 id="handling">Handling invocations</H2>
      <P>
        When a user runs your command, SerikaCord delivers an{" "}
        <Strong>APPLICATION_COMMAND interaction</Strong>. You receive it one of two ways:
      </P>
      <CodeBlock lang="text">{`Gateway libraries  → an INTERACTION_CREATE event on your socket
HTTP endpoint      → a signed POST to your Interactions Endpoint URL`}</CodeBlock>
      <P>
        See <Link2 href="/developers/docs/bots/interactions">Interactions</Link2> for the payload shape,
        signature verification, and how to respond.
      </P>

      <Callout type="info" title="Tip: test with a guild command first">
        Register to a single guild while developing so changes appear instantly, then promote to a global
        command when you ship.
      </Callout>
    </DocPage>
  );
}
