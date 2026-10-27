import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Rate Limits",
  description:
    "SerikaCord bot API rate limits: per-bot buckets, X-RateLimit headers, the 429 response, and how to retry.",
  path: "/developers/docs/topics/rate-limits",
  keywords: ["SerikaCord rate limits", "API throttling", "429", "rate limit headers", "bucket"],
});

export default async function RateLimitsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Rate Limits")} description={gt("How the bot API rate limits requests, the headers it sends, and how to handle a 429.")}>
      <P>
        {gt("Every request made with a bot token counts against limits for that bot. Responses carry Discord-style rate limit headers, so libraries that pace themselves from them work unchanged.")}
      </P>

      <H2 id="headers">{gt("Rate Limit Headers")}</H2>
      <Table headers={[gt("Header"), gt("Description")]} rows={[
        ["X-RateLimit-Limit", gt("Requests allowed in the bucket's window")],
        ["X-RateLimit-Remaining", gt("Requests left in the current window")],
        ["X-RateLimit-Reset", gt("Epoch time (seconds, with decimals) when the window resets")],
        ["X-RateLimit-Reset-After", gt("Seconds until the window resets")],
        ["X-RateLimit-Bucket", gt("Opaque id of the bucket this route uses")],
        ["X-RateLimit-Scope", gt("On a 429: user, or global for the per-bot budget")],
        ["Retry-After", gt("On a 429: seconds to wait (rounded up)")],
      ]} />

      <H2 id="limits">{gt("Limits")}</H2>
      <Table headers={[gt("Bucket"), gt("Limit"), gt("Per")]} rows={[
        [gt("All requests"), "50 / 1s", gt("bot (global)")],
        ["POST /channels/:id/messages", "5 / 5s", gt("bot and channel")],
        [gt("Reactions (add / remove)"), "4 / 1s", gt("bot and channel")],
        ["DELETE /channels/:id/messages/:id", "5 / 1s", gt("bot and channel")],
        [gt("Other writes (POST, PUT, PATCH, DELETE)"), "30 / 10s", gt("bot, route and channel or server")],
        ["GET /guilds/:id/messages/search", "40 / 60s", gt("bot (the same budget as search in the app)")],
      ]} />
      <P>
        {gt("Discord-style limits on the bot API are new and may be tuned; always read the headers instead of hard-coding these numbers.")}
      </P>

      <H2 id="rate-limited-response">{gt("Rate Limited Response")}</H2>
      <P>{gt("Over a limit the API answers")}{" "}<InlineCode>429 Too Many Requests</InlineCode>{" "}{gt("with this body:")}</P>
      <CodeBlock lang="json">{`{
  "message": "You are being rate limited.",
  "retry_after": 0.642,
  "global": false,
  "code": 0
}`}</CodeBlock>

      <H2 id="other-requests">{gt("Other requests")}</H2>
      <P>
        {gt("Requests without a valid bot token (for example OAuth2 Bearer tokens, or a malformed Authorization header) share a per-IP limit of 1,200 requests per minute. Over it the API answers 429 with a Retry-After header and an error and retryAfter field in the body.")}
      </P>
      <P>
        {gt("Lobby writes made with a user's Bearer token (sdk.social_layer) count against budgets keyed by that user: 50 requests per second, 30 writes per 10 seconds and 5 lobby messages per 5 seconds, with the same headers and 429 body as bot requests. POST /oauth2/token, token revocation and the client-credential partner-sdk routes allow 30 requests per minute per IP.")}
      </P>

      <H2 id="webhooks">{gt("Webhook execution")}</H2>
      <P>
        {gt("Executing a channel webhook is limited to 30 requests per 10 seconds per webhook. A 429 includes a Retry-After header and a retry_after field in the body.")}
      </P>
      <Table headers={[gt("Scope"), gt("Limit"), gt("On 429")]} rows={[
        [gt("Bot token (Authorization: Bot ...)"), gt("See Limits above"), "Retry-After + { message, retry_after, global }"],
        [gt("Other API requests, per IP"), "1,200 / 60s", "Retry-After + { error, retryAfter }"],
        [gt("Webhook execution, per webhook"), "30 / 10s", "Retry-After + { error, retry_after }"],
        [gt("Other webhook token routes (get, edit, delete, message edits), per webhook"), "30 / 10s", "Retry-After"],
        [gt("Interaction token routes (callback, followups, @original), per interaction"), "5 / 2s", "Retry-After"],
      ]} />
      <P>
        {gt("The Slack- and GitHub-compatible execute routes count against the same per-webhook execution limit.")}
      </P>

      <H2 id="handling">{gt("Handling 429s")}</H2>
      <UL>
        <li>{gt("Track X-RateLimit-Remaining per bucket and slow down before it reaches 0")}</li>
        <li>{gt("On any 429, wait retry_after seconds (or the Retry-After header) before retrying")}</li>
        <li>{gt("Use exponential backoff when a 429 has no Retry-After")}</li>
        <li>{gt("Queue requests per channel instead of sending bursts")}</li>
        <li>{gt("Cache responses where possible to reduce API calls")}</li>
      </UL>

      <H3 id="retry-example">{gt("Retry example (Node.js)")}</H3>
      <CodeBlock lang="javascript">{`async function request(url, options, attempt = 0) {
  const res = await fetch(url, options);
  if (res.status !== 429) return res;
  const header = Number(res.headers.get("Retry-After"));
  const waitSeconds = Number.isFinite(header) && header > 0 ? header : Math.min(2 ** attempt, 60);
  await new Promise((r) => setTimeout(r, waitSeconds * 1000));
  return request(url, options, attempt + 1);
}`}</CodeBlock>

      <H2 id="gateway">{gt("Gateway")}</H2>
      <P>
        {gt("The gateway enforces Discord's limits. A connection may send 120 payloads per 60 seconds; the next one closes it with code")}{" "}<InlineCode>4008</InlineCode>{". "}
        {gt("Each bot may IDENTIFY once every 5 seconds (a faster IDENTIFY is answered with op 9, Invalid Session) and 1,000 times per 24 hours (past that the connection closes with 4008). GET /gateway/bot reports what is left in session_start_limit. A full member list through op 8 is allowed once per guild every 30 seconds per session; an earlier request gets a RATE_LIMITED dispatch with retry_after.")}
      </P>
      <P>
        {gt("A connection that misses heartbeats is closed with code")}{" "}<InlineCode>4009</InlineCode>{". "}
        {gt("Requesting a privileged intent that is not enabled for your application closes the connection with code")}{" "}<InlineCode>4014</InlineCode>{". "}
        <Link2 href="/developers/docs/topics/gateway">{gt("Gateway")}</Link2>
      </P>

      <Callout type="warning" title={gt("Be a good citizen")}>
        <Strong>{gt("Back off when told to.")}</Strong>{" "}{gt("Bots that keep hitting 429s may be blocked.")}
      </Callout>
    </DocPage>
  );
}
