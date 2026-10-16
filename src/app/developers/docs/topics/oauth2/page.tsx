import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "OAuth2",
  description:
    "Authenticate users with SerikaCord using OAuth2. Authorization code flow, implicit flow, scopes, bot invites, token refresh, and code examples.",
  path: "/developers/docs/topics/oauth2",
  keywords: ["SerikaCord OAuth2", "user authentication", "authorization code", "implicit flow", "bot invite"],
});

export default async function OAuth2Doc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("OAuth2")} description={gt("Authenticate users with SerikaCord using the OAuth2 protocol. Supports authorization code, implicit, and bot invite flows.")}>
      <P>
        {gt("SerikaCord supports OAuth2 for user authentication. The flow is identical to Discord's OAuth2 implementation, supporting both the authorization code and implicit grant types.")}
      </P>

      <H2 id="oauth2-url">{gt("Authorization URL")}</H2>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&scope=identify&redirect_uri=YOUR_REDIRECT_URI&state=RANDOM_STATE`}</CodeBlock>
      <P>{gt("The token endpoint is:")}</P>
      <CodeBlock lang="text">https://api.serika.chat/api/oauth2/token</CodeBlock>

      <H2 id="scopes">{gt("Scopes")}</H2>
      <P>{gt("Scopes are space-separated values passed in the")} <InlineCode>scope</InlineCode> {gt("parameter. They determine what resources your application can access on behalf of the user.")}</P>
      <Table headers={[gt("Scope"), gt("Description")]} rows={[
        ["identify", gt("Get user ID, username, avatar, and discriminator")],
        ["email", gt("Get user email address (requires identify)")],
        ["connections", gt("Get user third-party connections (Steam, GitHub, etc.)")],
        ["guilds", gt("Get list of servers the user is a member of")],
        ["guilds.join", gt("Join a server on behalf of the user (requires guilds)")],
        ["guilds.members.read", gt("Read member info (roles, nicknames) in servers the user is in")],
        ["messages.read", gt("Read messages in servers the user is in")],
        ["rpc", gt("Connect to SerikaCord via RPC (for desktop apps)")],
        ["rpc.notifications.read", gt("Read desktop notifications via RPC")],
        ["rpc.voice.read", gt("Read voice channel state via RPC")],
        ["rpc.video.write", gt("Control video stream via RPC")],
        ["rpc.screenshare.write", gt("Control screen share via RPC")],
        ["bot", gt("Add a bot to a server (used with permissions parameter)")],
        ["applications.commands", gt("Register slash commands globally for the user")],
        ["applications.commands.update", gt("Update slash commands per-guild for the user")],
        ["applications.commands.permissions.update", gt("Update slash command permissions per-guild")],
        ["applications.entitlements", gt("Read user entitlements (monetization)")],
        ["applications.store.update", gt("Update store listings for the user's applications")],
        ["webhook.incoming", gt("Create a webhook channel")],
        ["voice", gt("Join and interact with voice channels")],
        ["activity.read", gt("Read embedded activities status")],
        ["activity.write", gt("Start and manage embedded activities")],
        ["dm_channels.read", gt("Read the user's direct message channels")],
        ["dm_channels.write", gt("Create and manage direct message channels")],
        ["relationships.read", gt("Read the user's friends and block list")],
        ["profile.read", gt("Read the user's full profile (bio, widgets, game library)")],
        ["profile.write", gt("Update the user's profile (bio, widgets, game library)")],
        ["analytics.read", gt("Read analytics data for the user's servers")],
      ]} />

      <Callout type="info" title={gt("Scope hierarchy")}>
        {gt("Some scopes require other scopes. For example,")} <InlineCode>email</InlineCode> {gt("requires")} <InlineCode>identify</InlineCode>, {gt("and")} <InlineCode>guilds.join</InlineCode> {gt("requires")} <InlineCode>guilds</InlineCode>. {gt("Invalid scope combinations will be rejected at the authorization step.")}
      </Callout>

      <H2 id="authorization-code">{gt("Authorization Code Flow")}</H2>
      <P>
        {gt("The most secure flow. Use this for server-side applications that can safely store a client secret.")}
      </P>

      <H3 id="step-1">{gt("Step 1: Redirect user to authorization URL")}</H3>
      <CodeBlock lang="text">{`GET https://api.serika.chat/api/oauth2/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &scope=identify%20email
  &redirect_uri=https://your-site.com/callback
  &state=random_state_string`}</CodeBlock>

      <H3 id="step-2">{gt("Step 2: User authorizes, redirect with code")}</H3>
      <P>{gt("After authorization, the user is redirected to your")} <InlineCode>redirect_uri</InlineCode> {gt("with a code:")}</P>
      <CodeBlock lang="text">{`https://your-site.com/callback?code=AUTHORIZATION_CODE&state=random_state_string`}</CodeBlock>
      <Callout type="warning" title={gt("Verify state")}>
        {gt("Always verify that the")} <InlineCode>state</InlineCode> {gt("parameter matches what you sent. If it doesn't, reject the request — it may be a CSRF attack.")}
      </Callout>

      <H3 id="step-3">{gt("Step 3: Exchange code for access token")}</H3>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTHORIZATION_CODE
&redirect_uri=https://your-site.com/callback
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`}</CodeBlock>
      <P>{gt("Response:")}</P>
      <CodeBlock lang="json">{`{
  "access_token": "YOUR_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "YOUR_REFRESH_TOKEN",
  "scope": "identify email"
}`}</CodeBlock>

      <H3 id="step-4">{gt("Step 4: Use the access token")}</H3>
      <CodeBlock lang="bash">{`GET https://api.serika.chat/api/v10/users/@me
Authorization: Bearer YOUR_ACCESS_TOKEN`}</CodeBlock>
      <P>{gt("Example response:")}</P>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "username": "seika",
  "global_name": "Seika",
  "avatar": "avatar_hash",
  "discriminator": "0",
  "email": "seika@example.com",
  "verified": true,
  "flags": 0,
  "bot": false
}`}</CodeBlock>

      <H2 id="refresh-token">{gt("Refreshing Tokens")}</H2>
      <P>
        {gt("Access tokens expire after 7 days (604800 seconds). Use the refresh token to get a new one:")}
      </P>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=YOUR_REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`}</CodeBlock>
      <P>{gt("The response has the same shape as the original token exchange.")}</P>

      <H2 id="implicit">{gt("Implicit Grant Flow")}</H2>
      <P>{gt("For client-side apps (SPAs, mobile apps) that can't store a client secret:")}</P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?response_type=token&client_id=YOUR_CLIENT_ID&scope=identify&redirect_uri=YOUR_REDIRECT_URI`}</CodeBlock>
      <P>{gt("Returns the access token directly in the URL fragment (no code exchange needed):")}</P>
      <CodeBlock lang="text">{`https://your-site.com/callback#access_token=YOUR_TOKEN&token_type=Bearer&expires_in=604800&scope=identify`}</CodeBlock>
      <Callout type="warning" title={gt("No refresh token in implicit flow")}>
        {gt("The implicit flow does")}{" "}<Strong>{gt("not")}</Strong> {gt("return a refresh token. When the access token expires, the user must re-authorize.")}
      </Callout>

      <H2 id="bot-authorization">{gt("Bot Authorization")}</H2>
      <P>
        {gt("To add a bot to a server, include the")} <InlineCode>bot</InlineCode> {gt("scope. You can combine it with")} <InlineCode>applications.commands</InlineCode> {gt("to also register slash commands:")}
      </P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize
  ?client_id=YOUR_CLIENT_ID
  &scope=bot+applications.commands
  &permissions=8`}</CodeBlock>
      <P>
        {gt("The")} <InlineCode>permissions</InlineCode> {gt("parameter is a bitwise combination of permission flags.")} <InlineCode>permissions=8</InlineCode> {gt("is Administrator. See")}{" "}
        <Link2 href="/developers/docs/topics/permissions">{gt("Permissions")}</Link2> {gt("for the full list.")}
      </P>
      <Table headers={[gt("Parameter"), gt("Required"), gt("Description")]} rows={[
        ["client_id", gt("Yes"), gt("Your application ID")],
        ["scope", gt("Yes"), gt("Must include 'bot'. Add 'applications.commands' for slash commands")],
        ["permissions", gt("No"), gt("Bitwise permission integer (default: 0)")],
        ["guild_id", gt("No"), gt("Pre-select a specific guild to add the bot to")],
        ["disable_guild_select", gt("No"), gt("If true, prevents changing the guild selection")],
      ]} />

      <H2 id="client-credentials">{gt("Client Credentials Flow")}</H2>
      <P>{gt("For server-to-server communication where no user context is needed (e.g., bot token management):")}</P>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET
&scope=identify`}</CodeBlock>
      <P>{gt("Response:")}</P>
      <CodeBlock lang="json">{`{
  "access_token": "YOUR_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 604800,
  "scope": "identify applications.commands.update"
}`}</CodeBlock>
      <Callout type="warning" title={gt("Limited scopes")}>
        {gt("Like on Discord, a client credentials token acts as the application's owner. It can't use bot, guilds.join, webhook.incoming or the DM and message scopes, and there is no refresh token. Its usual use is applications.commands.update, to deploy slash commands without a bot token.")}
      </Callout>

      <H2 id="bearer-routes">{gt("Where access tokens work")}</H2>
      <P>{gt("Send the token as Authorization: Bearer YOUR_ACCESS_TOKEN. The Discord-compatible API accepts it only on these routes, and only with the listed scope; everything else needs a bot token.")}</P>
      <Table headers={[gt("Route"), gt("Scope")]} rows={[
        ["GET /api/v10/users/@me", "identify (email: email)"],
        ["GET /api/v10/users/@me/guilds", "guilds"],
        ["GET /api/v10/users/@me/guilds/{guild.id}/member", "guilds.members.read"],
        ["GET /api/v10/users/@me/connections", "connections"],
        ["GET /api/v10/oauth2/@me", gt("any")],
        ["GET/POST/PUT/PATCH/DELETE /api/v10/applications/{app.id}/commands…", "applications.commands.update"],
        ["PUT …/guilds/{guild.id}/commands/{command.id}/permissions", "applications.commands.permissions.update"],
        ["PUT /api/v10/guilds/{guild.id}/members/{user.id} (access_token in the body)", "guilds.join"],
      ]} />
      <P>{gt("A missing scope answers 403 with code 50026; an unknown, expired or revoked token answers 401. The token endpoints also exist under /api/v10/oauth2/token and /api/v10/oauth2/token/revoke, and accept client credentials in the body or as HTTP Basic auth.")}</P>
      <Callout type="info" title={gt("Codes are single-use")}>
        {gt("An authorization code works once, for 10 minutes, and only with the redirect_uri it was issued for. Refresh tokens rotate: each refresh returns a new pair and the old refresh token stops working. Removing the app under User Settings -> Authorized Apps revokes its tokens.")}
      </Callout>

      <H2 id="token-revocation">{gt("Token Revocation")}</H2>
      <P>{gt("Revoke an access or refresh token to immediately invalidate it:")}</P>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token/revoke
Content-Type: application/x-www-form-urlencoded

token=YOUR_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`}</CodeBlock>
      <P>{gt("Returns a 200 OK with an empty body on success.")}</P>

      <H2 id="code-example">{gt("Full code example (Node.js)")}</H2>
      <CodeBlock lang="javascript">{`// 1. Redirect user to authorization URL
const authUrl = \`https://api.serika.chat/api/oauth2/authorize?\` +
  \`response_type=code&client_id=\${CLIENT_ID}\` +
  \`&scope=identify%20email\` +
  \`&redirect_uri=\${encodeURIComponent(REDIRECT_URI)}\` +
  \`&state=\${generateRandomState()}\`;

// User visits authUrl, authorizes, and is redirected back with ?code=...

// 2. Exchange code for token
const tokenRes = await fetch("https://api.serika.chat/api/oauth2/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code: req.query.code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  }),
});
const { access_token, refresh_token } = await tokenRes.json();

// 3. Use the access token
const userRes = await fetch("https://api.serika.chat/api/v10/users/@me", {
  headers: { Authorization: \`Bearer \${access_token}\` },
});
const user = await userRes.json();
console.log(\`Logged in as \${user.username}\`);`}</CodeBlock>

      <H2 id="redirect-uri">{gt("Redirect URI Matching")}</H2>
      <Callout type="warning" title={gt("Exact match required")}>
        {gt("Redirect URIs must exactly match what's configured in your application's OAuth2 settings in the")} {" "}<Link2 href="/developers/applications">{gt("Developer Portal")}</Link2>. {gt("Trailing slashes, protocol (http vs https), and case all matter.")}
      </Callout>

      <H2 id="state-parameter">{gt("State Parameter (CSRF Protection)")}</H2>
      <P>
        {gt("Always include a random")} <InlineCode>state</InlineCode> {gt("parameter and verify it on callback. This prevents CSRF attacks where an attacker tricks a user into authorizing a different application.")}
      </P>
      <CodeBlock lang="javascript">{`// Generate state
const state = crypto.randomUUID();
// Store in session
req.session.oauthState = state;
// Include in URL
const authUrl = \`...&state=\${state}\`;

// On callback, verify
if (req.query.state !== req.session.oauthState) {
  return res.status(403).send("Invalid state parameter");
}`}</CodeBlock>

      <H2 id="error-codes">{gt("Error Codes")}</H2>
      <Table headers={[gt("Error"), gt("Description")]} rows={[
        ["invalid_request", gt("Missing required parameter in the request")],
        ["invalid_client", gt("Client ID or secret is incorrect")],
        ["invalid_grant", gt("Authorization code or refresh token is invalid or expired")],
        ["unsupported_grant_type", gt("The grant_type parameter is not supported")],
        ["invalid_scope", gt("One or more requested scopes are invalid or unknown")],
        ["unauthorized_client", gt("The client is not authorized to use this grant type")],
      ]} />

      <H2 id="rate-limits">{gt("Rate Limits")}</H2>
      <P>{gt("The OAuth2 endpoints are rate-limited. See")} {" "}<Link2 href="/developers/docs/topics/rate-limits">{gt("Rate Limits")}</Link2> {gt("for details. Exceeding the limit returns a 429 status with a")} <InlineCode>retry_after</InlineCode> {gt("field.")}</P>
    </DocPage>
  );
}
