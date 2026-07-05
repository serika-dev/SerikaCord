import { DocPage, P, H2, H3, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";

export default function InteractionsDoc() {
  return (
    <DocPage
      title="Interactions"
      description="An interaction is what your app receives when a user invokes one of its commands. You can handle interactions over the gateway, or over HTTP with a signed webhook."
    >
      <H2 id="delivery">Two delivery modes</H2>
      <P>
        <Strong>Gateway:</Strong> if your bot holds a WebSocket connection, interactions arrive as{" "}
        <InlineCode>INTERACTION_CREATE</InlineCode> dispatch events. Nothing else to configure.
      </P>
      <P>
        <Strong>HTTP endpoint:</Strong> set an <Strong>Interactions Endpoint URL</Strong> on the{" "}
        <Strong>Bot</Strong> tab and we&apos;ll POST each interaction to it, signed with your
        application&apos;s Ed25519 key. This lets a bot run without a persistent connection.
      </P>

      <H2 id="verifying">Verifying signatures (HTTP mode)</H2>
      <P>
        Every POST includes two headers. You <Strong>must</Strong> verify them and reject anything that
        fails with <InlineCode>401</InlineCode> — this proves the request came from SerikaCord.
      </P>
      <Table
        headers={["Header", "Meaning"]}
        rows={[
          ["X-Signature-Ed25519", "Hex signature of (timestamp + raw body)"],
          ["X-Signature-Timestamp", "Unix timestamp used in the signed message"],
        ]}
      />
      <P>
        Verify against the <Strong>Public Key</Strong> shown on your Bot tab (a 64-char hex string):
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
      <Callout type="warning" title="Endpoint validation">
        When you save an Interactions Endpoint URL, we immediately send a signed{" "}
        <InlineCode>PING</InlineCode> (<InlineCode>type: 1</InlineCode>). Your endpoint must verify the
        signature and reply <InlineCode>{`{ "type": 1 }`}</InlineCode> or the URL is rejected.
      </Callout>

      <H2 id="responding">Responding</H2>
      <P>Reply to the POST with an interaction response object. The common types:</P>
      <Table
        headers={["Type", "Name", "Effect"]}
        rows={[
          ["1", "PONG", "Acknowledge a PING (validation only)"],
          ["4", "CHANNEL_MESSAGE_WITH_SOURCE", "Reply with a message immediately"],
          ["5", "DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE", "Show a loading state, follow up later"],
        ]}
      />
      <H3 id="example">Example handler (Express)</H3>
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
});`}</CodeBlock>

      <H2 id="payload">Interaction payload</H2>
      <CodeBlock lang="json">{`{
  "id": "1180000000000000000",
  "application_id": "1170000000000000000",
  "type": 2,
  "token": "aW50ZXJhY3Rpb24…",
  "channel_id": "1160000000000000000",
  "guild_id": "1150000000000000000",
  "member": { "user": { "id": "1140000000000000000", "username": "seika" } },
  "data": {
    "id": "1130000000000000000",
    "name": "echo",
    "type": 1,
    "options": [ { "name": "text", "type": 3, "value": "hi there" } ]
  }
}`}</CodeBlock>

      <Callout type="info" title="Prefer the gateway?">
        If you use a full library like discord.js, you generally don&apos;t need an HTTP endpoint —
        interactions arrive on your socket. The HTTP path exists for serverless and lightweight bots.
        Learn to register commands in <Link2 href="/developers/docs/bots/slash-commands">Slash Commands</Link2>.
      </Callout>
    </DocPage>
  );
}
