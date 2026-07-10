import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Slash Commands",
  description:
    "Register and handle slash commands on SerikaCord. Learn global vs guild-scoped commands, command options, subcommands, and interaction responses.",
  path: "/developers/docs/bots/slash-commands",
  keywords: [
    "SerikaCord slash commands",
    "application commands",
    "register commands",
    "command options",
    "bot commands",
  ],
});

export default async function SlashCommandsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Slash Commands")}
      description={gt("Application commands let users invoke your bot with a leading slash. Register them once, then handle the resulting interaction.")}
    >
      <P>
        {gt("Slash commands are registered per-application, either")}{" "}<Strong>{gt("globally")}</Strong> {gt("or scoped to a")}{" "}
        <Strong>{gt("guild")}</Strong>. {gt("Guild commands update instantly and are great for testing; global commands are available everywhere your app is installed.")}
      </P>

      <Callout type="info" title={gt("Command types")}>
        <InlineCode>type: 1</InlineCode> {gt("is a")}{" "}<Strong>CHAT_INPUT</Strong> {gt("(slash) command. User and message context-menu commands use types")}{" "}<InlineCode>2</InlineCode> {gt("and")} <InlineCode>3</InlineCode>.
      </Callout>

      <H2 id="command-object">{gt("Command Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "application_id": "APP_ID",
  "name": "ping",
  "description": "Check that the bot is alive",
  "options": [],
  "default_permission": true,
  "type": 1,
  "version": "1"
}`}</CodeBlock>

      <H2 id="register">{gt("Registering commands")}</H2>

      <H3 id="global">{gt("Global commands")}</H3>
      <Endpoint method="PUT" path="/applications/{'{application.id}'}/commands">
        {gt("Bulk-overwrite your global commands. Send the full array; anything omitted is removed.")}
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
      <P>
        {gt("You can also create commands one at a time with")}{" "}<InlineCode>POST</InlineCode>, {gt("update them with")}{" "}
        <InlineCode>PATCH</InlineCode>, {gt("or delete them with")}{" "}<InlineCode>DELETE</InlineCode>.
      </P>

      <H3 id="guild">{gt("Guild commands")}</H3>
      <Endpoint method="PUT" path="/applications/{'{application.id}'}/guilds/{'{guild.id}'}/commands">
        {gt("Same shape, scoped to one guild. Use this while iterating — changes apply immediately.")}
      </Endpoint>
      <CodeBlock lang="bash">{`curl -X PUT \\
  -H "Authorization: Bot YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  https://api.serika.chat/api/v10/applications/APP_ID/guilds/GUILD_ID/commands \\
  -d '[
    {
      "name": "test",
      "description": "A test command",
      "type": 1
    }
  ]'`}</CodeBlock>
      <P>
        {gt("Guild commands are deleted and recreated on each bulk overwrite. The current implementation removes all existing guild commands and creates new ones from the provided array.")}
      </P>

      <H2 id="option-types">{gt("Option types")}</H2>
      <Table headers={[gt("Type"), gt("Name"), gt("Description")]} rows={[
        ["1", "SUB_COMMAND", gt("A nested sub-command")],
        ["2", "SUB_COMMAND_GROUP", gt("A group of sub-commands")],
        ["3", "STRING", gt("A text value")],
        ["4", "INTEGER", gt("A whole number (-2^53 to 2^53)")],
        ["5", "BOOLEAN", "true / false"],
        ["6", "USER", gt("A user snowflake")],
        ["7", "CHANNEL", gt("A channel snowflake")],
        ["8", "ROLE", gt("A role snowflake")],
        ["9", "MENTIONABLE", gt("A user or role snowflake")],
        ["10", "NUMBER", gt("A floating-point number")],
        ["11", "ATTACHMENT", gt("A file attachment")],
      ]} />

      <H2 id="option-structure">{gt("Option structure")}</H2>
      <CodeBlock lang="json">{`{
  "name": "user",
  "description": "The user to look up",
  "type": 6,
  "required": true,
  "choices": [
    { "name": "Me", "value": "1234567890" }
  ],
  "channel_types": [0, 5],
  "min_value": 0,
  "max_value": 100,
  "autocomplete": false
}`}</CodeBlock>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["name", "string", gt("1-32 characters, lowercase, no spaces")],
        ["description", "string", gt("1-100 characters")],
        ["type", "integer", gt("One of the option types above")],
        ["required", "boolean", gt("Whether the user must provide this (default: false)")],
        ["choices", "array", gt("Pre-defined choices the user can pick from")],
        ["channel_types", "array", gt("For CHANNEL type: restrict to specific channel types")],
        ["min_value / max_value", "number", gt("For INTEGER/NUMBER: constrain the range")],
        ["autocomplete", "boolean", gt("Enable autocomplete suggestions (default: false)")],
      ]} />

      <H2 id="subcommands">{gt("Subcommands and groups")}</H2>
      <P>
        {gt("Use")}{" "}<InlineCode>SUB_COMMAND</InlineCode> {gt("(type 1) and")}{" "}<InlineCode>SUB_COMMAND_GROUP</InlineCode>{" "}
        {gt("(type 2) to organize complex commands:")}
      </P>
      <CodeBlock lang="json">{`{
  "name": "config",
  "description": "Configure the bot",
  "type": 1,
  "options": [
    {
      "name": "set",
      "description": "Set a configuration value",
      "type": 1,
      "options": [
        { "name": "key", "description": "Config key", "type": 3, "required": true },
        { "name": "value", "description": "Config value", "type": 3, "required": true }
      ]
    },
    {
      "name": "reset",
      "description": "Reset all configuration",
      "type": 1
    }
  ]
}`}</CodeBlock>
      <P>
        {gt("Users invoke this as")}{" "}<InlineCode>/config set key: value</InlineCode> {gt("or")}{" "}
        <InlineCode>/config reset</InlineCode>.
      </P>

      <H2 id="manage">{gt("Managing individual commands")}</H2>
      <Endpoint method="GET" path="/applications/{'{application.id}'}/commands">{gt("Fetch all global commands.")}</Endpoint>
      <Endpoint method="POST" path="/applications/{'{application.id}'}/commands">{gt("Create a single command.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{'{application.id}'}/commands/{'{command.id}'}">{gt("Get a single command.")}</Endpoint>
      <Endpoint method="PATCH" path="/applications/{'{application.id}'}/commands/{'{command.id}'}">{gt("Edit a command.")}</Endpoint>
      <Endpoint method="DELETE" path="/applications/{'{application.id}'}/commands/{'{command.id}'}">{gt("Delete a command.")}</Endpoint>
      <Endpoint method="GET" path="/applications/{'{application.id}'}/guilds/{'{guild.id}'}/commands">{gt("Fetch all guild commands.")}</Endpoint>
      <Endpoint method="PUT" path="/applications/{'{application.id}'}/guilds/{'{guild.id}'}/commands">{gt("Bulk overwrite guild commands.")}</Endpoint>

      <H2 id="handling">{gt("Handling invocations")}</H2>
      <P>
        {gt("When a user runs your command, SerikaCord delivers an")}{" "}
        <Strong>{gt("APPLICATION_COMMAND interaction")}</Strong>. {gt("You receive it one of two ways:")}
      </P>
      <Table headers={[gt("Mode"), gt("How it works"), gt("Response time limit")]} rows={[
        [gt("Gateway"), gt("INTERACTION_CREATE event on your WebSocket"), gt("3 seconds to acknowledge, 15 min to respond")],
        [gt("HTTP endpoint"), gt("Signed POST to your Interactions Endpoint URL"), gt("3 seconds to respond")],
      ]} />
      <P>
        {gt("See")}{" "}<Link2 href="/developers/docs/bots/interactions">{gt("Interactions")}</Link2> {gt("for the payload shape, signature verification, and how to respond.")}
      </P>

      <H2 id="limits">{gt("Limits")}</H2>
      <Table headers={[gt("Limit"), gt("Value")]} rows={[
        [gt("Max global commands per application"), "100"],
        [gt("Max guild commands per application per guild"), "100"],
        [gt("Command name length"), gt("1-32 characters")],
        [gt("Command description length"), gt("1-100 characters")],
        [gt("Options per command"), gt("Up to 25")],
        [gt("Choices per option"), gt("Up to 25")],
        [gt("Subcommand groups per command"), gt("Up to 1 level deep")],
      ]} />

      <Callout type="info" title={gt("Tip: test with a guild command first")}>
        {gt("Register to a single guild while developing so changes appear instantly, then promote to a global command when you ship.")}
      </Callout>
    </DocPage>
  );
}
