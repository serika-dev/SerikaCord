import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table, Endpoint } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Bot Interactions",
  description:
    "Handle SerikaCord bot interactions via gateway or HTTP webhooks. Learn about interaction payloads, signatures, response types, and verified delivery.",
  path: "/developers/docs/bots/interactions",
  keywords: [
    "SerikaCord interactions",
    "bot webhooks",
    "interaction payload",
    "Ed25519 signature",
    "gateway interactions",
  ],
});

export default async function InteractionsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Interactions")}
      description={gt("An interaction is what your app receives when a user invokes one of its commands. You can handle interactions over the gateway, or over HTTP with a signed webhook.")}
    >
      <H2 id="delivery">{gt("Two delivery modes")}</H2>
      <Table headers={[gt("Mode"), gt("How it works"), gt("Best for")]} rows={[
        [gt("Gateway"), gt("INTERACTION_CREATE dispatch event on your WebSocket"), gt("Bots already connected to the Gateway")],
        [gt("HTTP endpoint"), gt("Signed POST to your Interactions Endpoint URL"), gt("Serverless bots, lightweight bots without persistent connections")],
      ]} />
      <P>
        {gt("Like Discord, an app with an Interactions Endpoint URL gets interactions only over HTTP; without one they arrive as INTERACTION_CREATE on the gateway. The endpoint must be a public https URL (private and local addresses are refused) and must answer a signed PING. Requests time out after 3 seconds and redirects are not followed.")}
      </P>

      <H2 id="rules">{gt("Response rules")}</H2>
      <UL>
        <li>{gt("Acknowledge within 3 seconds, once. A late callback gets 10062 (Unknown interaction), a second one 40060 (Interaction has already been acknowledged).")}</li>
        <li>{gt("The token works for 15 minutes for followups and edits, on any server instance (tokens live in Redis). After that the webhook routes return 10015.")}</li>
        <li>{gt("Add ?with_response=true to the callback to get an InteractionCallbackResponse with the created or updated message instead of 204.")}</li>
        <li>{gt("Type 5 shows \"<your bot> is thinking…\" until you edit @original (or send the first followup, which completes it).")}</li>
        <li>{gt("flags: 64 (EPHEMERAL) messages are shown only to the user who ran the interaction, are never stored in the channel, and can be edited or deleted by id for 15 minutes.")}</li>
        <li>{gt("Types 10 (premium required, deprecated) and 12 (launch activity) are rejected with 50035.")}</li>
      </UL>

      <H2 id="interaction-types">{gt("Interaction Types")}</H2>
      <Table headers={[gt("Type"), gt("Name"), gt("Description")]} rows={[
        ["1", "PING", gt("Sent to verify your endpoint is valid (HTTP mode only)")],
        ["2", "APPLICATION_COMMAND", gt("User invoked a slash command or context menu command")],
        ["3", "MESSAGE_COMPONENT", gt("User clicked a button, select menu, or other component")],
        ["4", "APPLICATION_COMMAND_AUTOCOMPLETE", gt("User is typing in an autocomplete option")],
        ["5", "MODAL_SUBMIT", gt("User submitted a modal form")],
      ]} />

      <H2 id="verifying">{gt("Verifying signatures (HTTP mode)")}</H2>
      <P>
        {gt("Every POST includes two headers. You")}{" "}<Strong>{gt("must")}</Strong> {gt("verify them and reject anything that fails with")}{" "}<InlineCode>401</InlineCode> — {gt("this proves the request came from SerikaCord.")}
      </P>
      <Table headers={[gt("Header"), gt("Meaning")]} rows={[
        ["X-Signature-Ed25519", gt("Hex signature of (timestamp + raw body)")],
        ["X-Signature-Timestamp", gt("Unix timestamp used in the signed message")],
      ]} />
      <P>
        {gt("Verify against the")}{" "}<Strong>{gt("Public Key")}</Strong> {gt("shown on your Bot tab (a 64-char hex string):")}
      </P>
      <CodeBlock lang="javascript">{`import nacl from "tweetnacl";

function verify(req, rawBody, PUBLIC_KEY) {
  const sig = req.headers["x-signature-ed25519"];
  const ts = req.headers["x-signature-timestamp"];
  return nacl.sign.detached.verify(
    Buffer.from(ts + rawBody),
    Buffer.from(sig, "hex"),
    Buffer.from(PUBLIC_KEY, "hex"),
  );
}`}</CodeBlock>
      <Callout type="warning" title={gt("Endpoint validation")}>
        {gt("When you save an Interactions Endpoint URL, we immediately send a signed")}{" "}
        <InlineCode>PING</InlineCode> (<InlineCode>type: 1</InlineCode>). {gt("Your endpoint must verify the signature and reply")}{" "}<InlineCode>{`{ "type": 1 }`}</InlineCode> {gt("or the URL is rejected.")}
      </Callout>

      <H2 id="responding">{gt("Responding")}</H2>
      <P>{gt("Reply to the POST with an interaction response object. The common types:")}</P>
      <Table headers={[gt("Type"), gt("Name"), gt("Effect")]} rows={[
        ["1", "PONG", gt("Acknowledge a PING (validation only)")],
        ["4", "CHANNEL_MESSAGE_WITH_SOURCE", gt("Reply with a message immediately")],
        ["5", "DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE", gt("Show a loading state, follow up later")],
        ["6", "DEFERRED_UPDATE_MESSAGE", gt("Acknowledge a component interaction, update later")],
        ["7", "UPDATE_MESSAGE", gt("Update the message the component was attached to")],
        ["8", "APPLICATION_COMMAND_AUTOCOMPLETE_RESULT", gt("Respond to autocomplete with choices")],
        ["9", "MODAL", gt("Show a modal popup to the user")],
      ]} />

      <H3 id="example">{gt("Example handler (Express)")}</H3>
      <CodeBlock lang="javascript">{`app.post("/interactions", express.raw({ type: "application/json" }), (req, res) => {
  const rawBody = req.body.toString();
  if (!verify(req, rawBody, PUBLIC_KEY)) {
    return res.status(401).send("invalid request signature");
  }

  const interaction = JSON.parse(rawBody);

  // PING → PONG (endpoint validation)
  if (interaction.type === 1) {
    return res.json({ type: 1 });
  }

  // APPLICATION_COMMAND → reply
  if (interaction.type === 2) {
    return res.json({
      type: 4,
      data: { content: \`Hello, <@\${interaction.member?.user?.id}>!\` },
    });
  }

  // APPLICATION_COMMAND_AUTOCOMPLETE → return choices
  if (interaction.type === 4) {
    const focused = interaction.data.options.find(o => o.focused);
    return res.json({
      type: 8,
      data: {
        choices: [
          { name: "Option A", value: "a" },
          { name: "Option B", value: "b" },
        ],
      },
    });
  }
});`}</CodeBlock>

      <H2 id="payload">{gt("Interaction payload")}</H2>
      <P>{gt("The full payload for an")} <InlineCode>APPLICATION_COMMAND</InlineCode> {gt("interaction:")}</P>
      <CodeBlock lang="json">{`{
  "id": "1180000000000000000",
  "application_id": "1170000000000000000",
  "type": 2,
  "token": "aW50ZXJhY3Rpb24...",
  "channel_id": "1160000000000000000",
  "guild_id": "1150000000000000000",
  "member": {
    "user": {
      "id": "1140000000000000000",
      "username": "seika",
      "global_name": "Seika",
      "bot": false
    },
    "roles": ["role_id"],
    "nick": null,
    "joined_at": "2025-01-01T00:00:00.000Z"
  },
  "data": {
    "id": "1130000000000000000",
    "name": "echo",
    "type": 1,
    "options": [
      { "name": "text", "type": 3, "value": "hi there" }
    ]
  }
}`}</CodeBlock>
      <Table headers={["Field", "Type", "Description"]} rows={[
        ["guild / channel", "object", gt("Partial guild and channel (the channel carries the invoker's permissions)")],
        ["app_permissions", "string", gt("Your bot's permissions in the channel")],
        ["locale / guild_locale", "string", gt("The invoker's language and the server's")],
        ["context", "integer", gt("0 server, 1 DM with your bot, 2 group DM")],
        ["authorizing_integration_owners", "object", gt("Who installed the app: key \"0\" maps to the server id")],
        ["entitlements", "array", gt("Always empty (no monetization yet)")],
        ["attachment_size_limit", "integer", gt("Largest file you may upload in the response, in bytes")],
        ["message", "object", gt("The message a clicked component is on (component interactions)")],
        ["id", "snowflake", "Interaction ID — used to respond"],
        ["application_id", "snowflake", "Your application ID"],
        ["type", "integer", "Interaction type (see table above)"],
        ["token", "string", "Interaction token — used for follow-up calls"],
        ["channel_id", "snowflake", "Channel the interaction happened in"],
        ["guild_id", "snowflake", "Guild the interaction happened in (null for DMs)"],
        ["member", "object", "Guild member who triggered it (null in DMs)"],
        ["user", "object", "User who triggered it (present in DMs)"],
        ["data", "object", "Command data: name, options, resolved, etc."],
      ]} />

      <H3 id="subcommand-options">{gt("Subcommand option nesting")}</H3>
      <P>
        {gt("When a command uses subcommands, the chosen subcommand appears as a single option (type 1), and the leaf option values are nested inside its")}{" "}<InlineCode>options</InlineCode> {gt("array. Named options may arrive in any order, and their")}{" "}<InlineCode>value</InlineCode> {gt("is coerced to the JSON type implied by the option type (integer, number, boolean, or string).")}
      </P>
      <CodeBlock lang="json">{`"data": {
  "id": "1130000000000000000",
  "name": "amq",
  "type": 1,
  "options": [
    {
      "name": "start",
      "type": 1,
      "options": [
        { "name": "rounds", "type": 4, "value": 5 },
        { "name": "mode", "type": 3, "value": "audio" }
      ]
    }
  ]
}`}</CodeBlock>

      <H2 id="followups">{gt("Follow-up messages")}</H2>
      <P>
        {gt("After the initial response, you can send follow-up messages using the interaction token:")}
      </P>
      <Endpoint method="POST" path="/interactions/{'{interaction.id}'}/{'{interaction.token}'}/callback">
        {gt("Initial interaction response (must be within 3 seconds).")}
      </Endpoint>
      <Endpoint method="PATCH" path="/webhooks/{'{application.id}'}/{'{interaction.token}'}/messages/@original">
        {gt("Edit the original response.")}
      </Endpoint>
      <Endpoint method="POST" path="/webhooks/{'{application.id}'}/{'{interaction.token}'}">
        {gt("Send a follow-up message.")}
      </Endpoint>
      <Endpoint method="DELETE" path="/webhooks/{'{application.id}'}/{'{interaction.token}'}/messages/{'{message.id}'}">
        {gt("Delete a follow-up message.")}
      </Endpoint>
      <P>
        {gt("GET, PATCH and DELETE work on messages/@original and on followup ids; ephemeral messages included. No Authorization header is needed: the interaction token is the credential.")}
      </P>
      <CodeBlock lang="bash">{`# Send a follow-up message
curl -X POST \\
  -H "Content-Type: application/json" \\
  -d '{"content":"Follow-up message!"}' \\
  https://api.serika.chat/api/v10/webhooks/APP_ID/INTERACTION_TOKEN`}</CodeBlock>

      <H2 id="message-components">{gt("Message components")}</H2>
      <P>
        {gt("Interactions can include buttons and select menus in responses. When a user clicks a button or selects from a menu, you receive a")}{" "}<InlineCode>MESSAGE_COMPONENT</InlineCode> {gt("interaction (type 3) with")}{" "}<InlineCode>data.custom_id</InlineCode> {gt("identifying which component was used.")}
      </P>
      <CodeBlock lang="json">{`{
  "type": 4,
  "data": {
    "content": "Click a button!",
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 2,
            "style": 1,
            "label": "Yes",
            "custom_id": "btn_yes"
          },
          {
            "type": 2,
            "style": 4,
            "label": "No",
            "custom_id": "btn_no"
          }
        ]
      }
    ]
  }
}`}</CodeBlock>

      <H3 id="component-reference">{gt("Supported components")}</H3>
      <Table headers={[gt("Type"), gt("Component"), gt("Notes")]} rows={[
        ["1", "Action row", gt("Up to 5 buttons or one select menu; up to 5 rows")],
        ["2", "Button", gt("Styles 1-5 (5 = link, http(s) only). Premium buttons are not supported")],
        ["3, 5, 6, 7, 8", gt("Select menus"), gt("String, user, role, mentionable and channel selects, min_values / max_values")],
        ["9, 10, 11", gt("Section, text display, thumbnail"), gt("Components v2 (message flag 1 << 15, IS_COMPONENTS_V2)")],
        ["12, 13, 14, 17", gt("Media gallery, file, separator, container"), gt("Components v2; media can be https URLs or attachment://name")],
      ]} />
      <P>
        {gt("Components are accepted on bot messages, interaction responses, followups and application-owned webhooks, validated against Discord's limits (custom_id up to 100 characters, labels up to 80, 40 components and 4,000 characters of text display in v2), and stored with the message. A user's click is checked against the stored message: unknown or disabled components never reach your app.")}
      </P>
      <P>
        {gt("Buttons and selects inside Components V2 layouts (containers and section accessories) send the same MESSAGE_COMPONENT interactions. Rules, limits and a full example payload are in")}{" "}<Link2 href="/developers/docs/resources/message#components-v2">{gt("Components V2")}</Link2>.
      </P>

      <H2 id="modals">{gt("Modals")}</H2>
      <P>
        {gt("Respond with type")}{" "}<InlineCode>9</InlineCode> {gt("to show a modal popup. The user fills it in and submits, triggering a")}{" "}<InlineCode>MODAL_SUBMIT</InlineCode> {gt("interaction (type 5):")}
      </P>
      <CodeBlock lang="json">{`{
  "type": 9,
  "data": {
    "title": "Feedback Form",
    "custom_id": "feedback_modal",
    "components": [
      {
        "type": 1,
        "components": [
          {
            "type": 4,
            "custom_id": "feedback_text",
            "style": 2,
            "label": "Your feedback",
            "required": true
          }
        ]
      }
    ]
  }
}`}</CodeBlock>

      <P>
        {gt("Modals can use label components (type 18) wrapping a text input, a select menu, a radio group, a checkbox group or a checkbox, plus text displays. The submitted values are checked against your modal (required fields, lengths, choices) before you get MODAL_SUBMIT, and each modal can be submitted once.")}
      </P>

      <H2 id="autocomplete">{gt("Autocomplete")}</H2>
      <P>
        {gt("Options with autocomplete: true send APPLICATION_COMMAND_AUTOCOMPLETE (type 4) while the user types, with the option being typed marked focused. Answer with type 8 and up to 25 choices of the option's type.")}
      </P>

      <H2 id="context-menus">{gt("Context menu commands")}</H2>
      <P>
        {gt("User commands (type 2) appear when someone right-clicks a member, message commands (type 3) when they right-click a message. The interaction's data.target_id is the user or message, and data.resolved carries it.")}
      </P>

      <Callout type="info" title={gt("Prefer the gateway?")}>
        {gt("If you use a full library like serika.js, you generally don't need an HTTP endpoint — interactions arrive on your socket. The HTTP path exists for serverless and lightweight bots. Learn to register commands in")}{" "}<Link2 href="/developers/docs/bots/slash-commands">{gt("Slash Commands")}</Link2>.
      </Callout>
    </DocPage>
  );
}
