import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Rate Limits",
  description:
    "SerikaCord API rate limits: headers, buckets, global limits, 429 handling, Gateway limits, and best practices for avoiding rate limit errors.",
  path: "/developers/docs/topics/rate-limits",
  keywords: ["SerikaCord rate limits", "API throttling", "429", "rate limit headers", "bucket"],
});

export default async function RateLimitsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Rate Limits")} description={gt("Understand and handle API rate limits to keep your bot running smoothly.")}>
      <P>
        {gt("SerikaCord enforces rate limits to protect the API. Rate limits are applied per-route and per-bot (or per-token for OAuth2). All rate limit information is communicated via HTTP headers on every response.")}
      </P>

      <H2 id="headers">{gt("Rate Limit Headers")}</H2>
      <P>{gt("Every API response includes these headers:")}</P>
      <Table headers={[gt("Header"), gt("Description")]} rows={[
        ["X-RateLimit-Limit", gt("Maximum requests per window")],
        ["X-RateLimit-Remaining", gt("Remaining requests in current window")],
        ["X-RateLimit-Reset", gt("Epoch timestamp (seconds) when the window resets")],
        ["X-RateLimit-Reset-After", gt("Seconds until window resets (relative)")],
        ["X-RateLimit-Bucket", gt("Unique bucket identifier for this route")],
        ["X-RateLimit-Global", gt("True if global rate limit was hit")],
        ["Retry-After", gt("Seconds to wait before retrying (only on 429)")],
      ]} />

      <H2 id="rate-limited-response">{gt("Rate Limited Response")}</H2>
      <P>{gt("When rate limited, the API returns")}{" "}<InlineCode>429 Too Many Requests</InlineCode>:</P>
      <CodeBlock lang="json">{`{
  "message": "You are being rate limited.",
  "retry_after": 0.642,
  "global": false
}`}</CodeBlock>
      <P>
        {gt("Wait")}{" "}<InlineCode>retry_after</InlineCode> {gt("seconds before retrying. The response also includes a")} <InlineCode>Retry-After</InlineCode> {gt("HTTP header.")}
      </P>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["message", "string", gt("Human-readable error message")],
        ["retry_after", "float", gt("Seconds to wait before retrying")],
        ["global", "boolean", gt("True if the global rate limit was hit (not per-route)")],
      ]} />

      <H2 id="bucket-types">{gt("Rate Limit Buckets")}</H2>
      <P>
        {gt("Routes are grouped into buckets. Requests to the same bucket share a rate limit. The bucket identifier is returned in the")}{" "}<InlineCode>X-RateLimit-Bucket</InlineCode> {gt("header.")}
      </P>
      <Table headers={[gt("Route pattern"), gt("Bucket type"), gt("Typical limit")]} rows={[
        ["GET /channels/{id}/messages", gt("Per-channel"), "5/5s"],
        ["POST /channels/{id}/messages", gt("Per-channel"), "5/5s"],
        ["PUT /channels/{id}/messages/{id}/reactions/{emoji}/@me", gt("Per-channel"), "1/0.25s"],
        ["DELETE /channels/{id}/messages/{id}", gt("Per-channel"), "3/1s"],
        ["PATCH /guilds/{id}/members/{id}", gt("Per-guild"), "10/10s"],
        ["GET /users/{id}", gt("Global"), gt("Per-bot")],
        ["GET /gateway", gt("Global"), gt("Per-bot")],
      ]} />
      <Callout type="info" title={gt("Bucket hashing")}>
        {gt("The")}{" "}<InlineCode>X-RateLimit-Bucket</InlineCode> {gt("header is a hash of the route template (with IDs removed). Two requests to different channels hit different buckets; two requests to the same channel share a bucket.")}
      </Callout>

      <H2 id="global-rate-limit">{gt("Global Rate Limit")}</H2>
      <P>
        {gt("There is a global rate limit of")}{" "}<Strong>{gt("50 requests per second")}</Strong> {gt("across all routes. If exceeded, you'll receive a")}{" "}<InlineCode>429</InlineCode> {gt("with")}{" "}
        <InlineCode>global: true</InlineCode>. {gt("Global rate limits take precedence over per-route limits.")}
      </P>

      <H2 id="handling">{gt("Best Practices for Handling Rate Limits")}</H2>
      <UL>
        <li>{gt("Track")}{" "}<InlineCode>X-RateLimit-Remaining</InlineCode> {gt("and slow down before hitting 0")}</li>
        <li>{gt("Queue requests and process them sequentially per-bucket")}</li>
        <li>{gt("Respect")}{" "}<InlineCode>retry_after</InlineCode> {gt("— don't retry immediately")}</li>
        <li>{gt("Use exponential backoff for unexpected 429s")}</li>
        <li>{gt("Cache responses where possible to reduce API calls")}</li>
        <li>{gt("Use")}{" "}<InlineCode>GET</InlineCode> {gt("requests with")}{" "}<InlineCode>If-None-Match</InlineCode> {gt("for 304 caching")}</li>
        <li>{gt("Avoid burst requests — spread them out evenly")}</li>
        <li>{gt("Log rate limit headers to debug throttling issues")}</li>
      </UL>

      <H3 id="rate-limit-queue">{gt("Rate limit queue example (Node.js)")}</H3>
      <CodeBlock lang="javascript">{`class RateLimitQueue {
  constructor() {
    this.buckets = new Map(); // bucket -> { remaining, resetAfter }
  }

  async request(method, url, options) {
    const res = await fetch(url, options);

    // Update bucket info from headers
    const bucket = res.headers.get("X-RateLimit-Bucket");
    if (bucket) {
      this.buckets.set(bucket, {
        remaining: parseInt(res.headers.get("X-RateLimit-Remaining")),
        resetAfter: parseFloat(res.headers.get("X-RateLimit-Reset-After")),
      });
    }

    if (res.status === 429) {
      const body = await res.json();
      const wait = body.retry_after * 1000;
      await new Promise(r => setTimeout(r, wait));
      return this.request(method, url, options); // retry
    }

    return res;
  }
}`}</CodeBlock>

      <Callout type="warning" title={gt("Cloudflare Bans")}>
        {gt("Repeatedly hitting rate limits may result in temporary IP bans. Always handle 429 responses gracefully and back off when instructed.")}
      </Callout>

      <H2 id="gateway-rate-limits">{gt("Gateway Rate Limits")}</H2>
      <P>
        {gt("The Gateway has its own rate limits separate from the REST API:")}
      </P>
      <Table headers={[gt("Limit"), gt("Value")]} rows={[
        [gt("Max events sent per 60 seconds"), "120"],
        [gt("Max identifies per 5 seconds"), "1"],
        [gt("Max concurrent identifies per 24 hours"), "1,000"],
      ]} />
      <P>
        {gt("Exceeding the identify limit will result in an")}{" "}<InlineCode>Invalid Session</InlineCode> {gt("(op 8). Exceeding the event send limit may result in a close with code")}{" "}<InlineCode>4008</InlineCode>.
      </P>

      <H2 id="exempt-routes">{gt("Exempt Routes")}</H2>
      <P>
        {gt("Some routes are not rate limited or have very high limits:")}
      </P>
      <UL>
        <li><InlineCode>GET /gateway</InlineCode> — {gt("very high limit")}</li>
        <li><InlineCode>{"POST /interactions/{id}/{token}/callback"}</InlineCode> — {gt("exempt (must respond within 3s)")}</li>
      </UL>
    </DocPage>
  );
}
