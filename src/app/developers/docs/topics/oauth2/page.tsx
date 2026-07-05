import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table } from "../../DocPage";

export default function OAuth2Doc() {
  return (
    <DocPage title="OAuth2" description="Authenticate users with SerikaCord using the OAuth2 protocol.">
      <P>
        SerikaCord supports OAuth2 for user authentication. The flow is identical to Discord's OAuth2
        implementation, supporting both the authorization code and implicit grant types.
      </P>

      <H2 id="oauth2-url">Authorization URL</H2>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&scope=identify&redirect_uri=YOUR_REDIRECT_URI&state=RANDOM_STATE`}</CodeBlock>

      <H2 id="scopes">Scopes</H2>
      <Table
        headers={["Scope", "Description"]}
        rows={[
          ["identify", "Get user ID, username, avatar, and discriminator"],
          ["email", "Get user email (requires identify)"],
          ["connections", "Get user connections"],
          ["guilds", "Get servers the user is in"],
          ["guilds.join", "Join a server on behalf of the user"],
          ["guilds.members.read", "Read member info in servers"],
          ["messages.read", "Read messages in servers the user is in"],
          ["rpc", "Connect via RPC"],
          ["bot", "Add a bot to a server (with scope=bot)"],
          ["applications.commands", "Register slash commands globally"],
          ["webhook.incoming", "Create a webhook channel"],
          ["voice", "Join voice channels"],
          ["activity.read", "Read embedded activities"],
          ["activity.write", "Start embedded activities"],
        ]}
      />

      <H2 id="authorization-code">Authorization Code Flow</H2>
      <H3 id="step-1">Step 1: Redirect user to authorization URL</H3>
      <CodeBlock lang="text">{`GET https://api.serika.chat/api/oauth2/authorize
  ?response_type=code
  &client_id=YOUR_CLIENT_ID
  &scope=identify%20email
  &redirect_uri=https://your-site.com/callback
  &state=random_state_string`}</CodeBlock>

      <H3 id="step-2">Step 2: User authorizes, redirect with code</H3>
      <P>After authorization, the user is redirected to your <InlineCode>redirect_uri</InlineCode> with a code:</P>
      <CodeBlock lang="text">{`https://your-site.com/callback?code=AUTHORIZATION_CODE&state=random_state_string`}</CodeBlock>

      <H3 id="step-3">Step 3: Exchange code for access token</H3>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTHORIZATION_CODE
&redirect_uri=https://your-site.com/callback
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`}</CodeBlock>
      <P>Response:</P>
      <CodeBlock lang="json">{`{
  "access_token": "YOUR_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 604800,
  "refresh_token": "YOUR_REFRESH_TOKEN",
  "scope": "identify email"
}`}</CodeBlock>

      <H3 id="step-4">Step 4: Use the access token</H3>
      <CodeBlock lang="bash">{`GET https://api.serika.chat/api/v10/users/@me
Authorization: Bearer YOUR_ACCESS_TOKEN`}</CodeBlock>

      <H2 id="refresh-token">Refreshing Tokens</H2>
      <CodeBlock lang="bash">{`POST https://api.serika.chat/api/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=YOUR_REFRESH_TOKEN
&client_id=YOUR_CLIENT_ID
&client_secret=YOUR_CLIENT_SECRET`}</CodeBlock>

      <H2 id="implicit">Implicit Grant Flow</H2>
      <P>For client-side apps that can't store a client secret:</P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?response_type=token&client_id=YOUR_CLIENT_ID&scope=identify&redirect_uri=YOUR_REDIRECT_URI`}</CodeBlock>
      <P>Returns the access token directly in the URL fragment:</P>
      <CodeBlock lang="text">{`https://your-site.com/callback#access_token=YOUR_TOKEN&token_type=Bearer&expires_in=604800&scope=identify`}</CodeBlock>

      <H2 id="bot-authorization">Bot Authorization</H2>
      <P>To add a bot to a server, include the <InlineCode>bot</InlineCode> scope:</P>
      <CodeBlock lang="text">{`https://api.serika.chat/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot&permissions=8`}</CodeBlock>
      <P>The <InlineCode>permissions</InlineCode> parameter is a bitwise combination of permission flags. See <Link2 href="/developers/docs/topics/permissions">Permissions</Link2>.</P>

      <Callout type="warning" title="Redirect URI Matching">
        Redirect URIs must exactly match what's configured in your application's OAuth2 settings.
        Trailing slashes matter.
      </Callout>

      <H2 id="state-parameter">State Parameter</H2>
      <P>
        Always include a random <InlineCode>state</InlineCode> parameter and verify it on callback to
        prevent CSRF attacks.
      </P>
    </DocPage>
  );
}
