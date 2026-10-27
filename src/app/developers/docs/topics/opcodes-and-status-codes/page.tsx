import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Opcodes & Status Codes",
  description:
    "SerikaCord Gateway opcodes, Gateway close codes, HTTP status codes, and JSON error codes. Complete reference for all API and Gateway codes.",
  path: "/developers/docs/topics/opcodes-and-status-codes",
  keywords: ["SerikaCord opcodes", "status codes", "error codes", "gateway close codes", "HTTP status"],
});

export default async function OpcodesDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Opcodes & Status Codes")} description={gt("Gateway opcodes, close codes, and HTTP status codes used by the SerikaCord API.")}>
      <H2 id="gateway-opcodes">{gt("Gateway Opcodes")}</H2>
      <Table headers={[gt("Opcode"), gt("Name"), gt("Direction"), gt("Description")]} rows={[
        ["0", "Dispatch", "Server→Client", gt("Dispatches an event")],
        ["1", "Heartbeat", "Both", gt("Maintains connection; the server may ask for an immediate beat")],
        ["2", "Identify", "Client→Server", gt("Initial authentication")],
        ["3", "Presence Update", "Client→Server", gt("Update the bot's status and activities")],
        ["4", "Voice State Update", "Client→Server", gt("Join/leave voice (answered with VOICE_SERVER_UPDATE endpoint null)")],
        ["6", "Resume", "Client→Server", gt("Resume a session and replay missed events")],
        ["7", "Reconnect", "Server→Client", gt("Server requests reconnect and resume")],
        ["8", "Request Guild Members", "Client→Server", gt("Request members, answered with GUILD_MEMBERS_CHUNK")],
        ["9", "Invalid Session", "Server→Client", gt("Session invalidated")],
        ["10", "Hello", "Server→Client", gt("Heartbeat interval")],
        ["11", "Heartbeat ACK", "Server→Client", gt("Heartbeat acknowledged")],
        ["31", "Request Soundboard Sounds", "Client→Server", gt("Request soundboard sounds, answered with SOUNDBOARD_SOUNDS")],
      ]} />
      <P>{gt("Op 43 (Request Channel Info) is not implemented and closes the connection with 4001.")}</P>

      <H2 id="gateway-close-codes">{gt("Gateway Close Codes")}</H2>
      <Table headers={[gt("Code"), gt("Description"), gt("Can Resume?")]} rows={[
        ["4000", gt("Unknown error"), gt("Yes")],
        ["4001", gt("Unknown opcode"), gt("Yes")],
        ["4002", gt("Decode error"), gt("Yes")],
        ["4003", gt("Not authenticated"), gt("Yes")],
        ["4004", gt("Authentication failed"), gt("No")],
        ["4005", gt("Already authenticated"), gt("Yes")],
        ["4007", gt("Invalid seq"), gt("No")],
        ["4008", gt("Rate limited"), gt("Yes")],
        ["4009", gt("Session timed out"), gt("Yes")],
        ["4010", gt("Invalid shard"), gt("No")],
        ["4011", gt("Sharding required"), gt("No")],
        ["4012", gt("Invalid API version"), gt("No")],
        ["4013", gt("Invalid intent(s)"), gt("No")],
        ["4014", gt("Disallowed intent(s)"), gt("No")],
      ]} />

      <H2 id="http-status-codes">{gt("HTTP Status Codes")}</H2>
      <Table headers={[gt("Code"), gt("Name"), gt("Description")]} rows={[
        ["200", "OK", gt("Request succeeded")],
        ["201", "Created", gt("Resource created")],
        ["204", "No Content", gt("Success, no body")],
        ["304", "Not Modified", gt("Cached resource still valid")],
        ["400", "Bad Request", gt("Malformed request")],
        ["401", "Unauthorized", gt("Missing/invalid auth token")],
        ["403", "Forbidden", gt("Lacking permissions")],
        ["404", "Not Found", gt("Resource doesn't exist")],
        ["405", "Method Not Allowed", gt("HTTP method not supported")],
        ["410", "Gone", gt("Resource permanently removed")],
        ["412", "Precondition Failed", gt("If-Match header not met")],
        ["429", "Too Many Requests", gt("Rate limited")],
        ["502", "Bad Gateway", gt("Server error")],
        ["5xx", "Server Error", gt("Internal server errors")],
      ]} />

      <H2 id="json-error-codes">{gt("JSON Error Codes")}</H2>
      <Table headers={[gt("Code"), gt("Name")]} rows={[
        ["0", gt("General error (also the code of a 429 body)")],
        ["10002", gt("Unknown application")],
        ["10003", gt("Unknown channel")],
        ["10004", gt("Unknown guild")],
        ["10005", gt("Unknown integration")],
        ["10006", gt("Unknown invite")],
        ["10007", gt("Unknown member")],
        ["10008", gt("Unknown message")],
        ["10011", gt("Unknown role")],
        ["10013", gt("Unknown user")],
        ["10014", gt("Unknown emoji")],
        ["10015", gt("Unknown webhook")],
        ["10026", gt("Unknown ban")],
        ["10027", gt("Unknown SKU")],
        ["10029", gt("Unknown entitlement")],
        ["10031", gt("Unknown lobby")],
        ["10057", gt("Unknown guild template")],
        ["10060", gt("Unknown sticker")],
        ["10061", gt("Unknown sticker pack")],
        ["10062", gt("Unknown interaction")],
        ["10063", gt("Unknown application command")],
        ["10065", gt("Unknown voice state")],
        ["10066", gt("Unknown auto moderation rule")],
        ["10067", gt("Unknown stage instance")],
        ["10069", gt("Unknown welcome screen")],
        ["10070", gt("Unknown guild scheduled event")],
        ["10097", gt("Unknown sound")],
        ["20001", gt("Bots cannot use this endpoint")],
        ["20009", gt("Explicit content cannot be sent to the desired recipient(s)")],
        ["20016", gt("This action cannot be performed due to slowmode rate limit")],
        ["30001", gt("Maximum number of guilds reached")],
        ["30003", gt("Maximum number of pins reached")],
        ["30005", gt("Maximum number of guild roles reached")],
        ["30007", gt("Maximum number of webhooks reached")],
        ["30008", gt("Maximum number of emojis reached")],
        ["30010", gt("Maximum number of reactions reached")],
        ["30013", gt("Maximum number of guild channels reached")],
        ["30031", gt("A server can only have a single template")],
        ["30038", gt("Maximum number of guild scheduled events reached")],
        ["30039", gt("Maximum number of stickers reached")],
        ["30045", gt("Maximum number of soundboard sounds reached")],
        ["30059", gt("Maximum number of permission overwrites reached")],
        ["40005", gt("Request entity too large")],
        ["40007", gt("The user is banned from this guild")],
        ["40033", gt("This message has already been crossposted")],
        ["40060", gt("Interaction has already been acknowledged")],
        ["40067", gt("A tag is required to create a forum post in this channel")],
        ["50001", gt("Missing access")],
        ["50004", gt("Guild widget disabled")],
        ["50005", gt("Cannot edit a message authored by another user")],
        ["50006", gt("Cannot send an empty message")],
        ["50007", gt("Cannot send messages to this user")],
        ["50013", gt("Missing permissions")],
        ["50021", gt("Cannot execute action on a system message")],
        ["50024", gt("Cannot execute action on this channel type")],
        ["50025", gt("Invalid OAuth2 access token")],
        ["50026", gt("Missing required OAuth2 scope")],
        ["50034", gt("A message provided was too old to bulk delete")],
        ["50035", gt("Invalid form body (see the errors tree)")],
        ["50046", gt("Invalid asset")],
        ["50081", gt("Invalid sticker sent")],
        ["50083", gt("Tried to perform an operation on an archived thread")],
        ["50109", gt("The request body contains invalid JSON")],
        ["110000", gt("Search index not ready yet (202 from guild message search, retry after retry_after)")],
        ["150006", gt("The stage is already open")],
        ["160002", gt("Cannot reply without permission to read message history")],
        ["160004", gt("A thread has already been created for this message")],
        ["160005", gt("Thread is locked")],
        ["180000", gt("Cannot update a finished event")],
        ["200000", gt("Message was blocked by automatic moderation")],
        ["220001", gt("Webhooks posted to forum channels must have a thread_name or thread_id")],
        ["500000", gt("Failed to ban users")],
        ["530000", gt("Your application has not been granted the permission to use provisional accounts")],
        ["530007", gt("Your client secret is invalid")],
      ]} />

      <Callout type="info" title={gt("Full Error Reference")}>
        {gt("These are the JSON error codes the SerikaCord bot API returns. They use Discord's numbers and meanings, so library error classes work unchanged. The")}{" "}<InlineCode>code</InlineCode> {gt("field in error responses helps you programmatically handle errors.")}
      </Callout>
    </DocPage>
  );
}
