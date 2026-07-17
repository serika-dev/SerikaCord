import { DocPage, P, H2, CodeBlock, Callout, InlineCode, Link2 } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK · External Auth",
  description: "Authenticate Social SDK requests with OAuth2 access tokens and SDK scopes.",
  path: "/developers/docs/social-sdk/external-auth",
  keywords: ["Serika OAuth2", "Social SDK auth", "access token"],
});

export default async function ExternalAuthDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("External Auth")}
      description={gt("Social SDK requests are made on behalf of a user with an OAuth2 access token carrying SDK scopes.")}
    >
      <P>
        {gt("Use the standard")} <Link2 href="/developers/docs/topics/oauth2">{gt("OAuth2 authorization code flow")}</Link2> {gt("to obtain an access token, requesting the SDK scopes your app needs. Pass the token as a bearer credential.")}
      </P>

      <H2 id="request">{gt("Authorize")}</H2>
      <CodeBlock lang="text">{`GET https://api.serika.chat/api/oauth2/authorize
  ?client_id=YOUR_CLIENT_ID
  &response_type=code
  &redirect_uri=YOUR_REDIRECT
  &scope=identify sdk.presence sdk.relationships`}</CodeBlock>

      <H2 id="calling">{gt("Calling the API")}</H2>
      <CodeBlock lang="bash">{`curl https://api.serika.chat/api/v1/users/@me \\
  -H "Authorization: Bearer ACCESS_TOKEN"`}</CodeBlock>

      <Callout type="warning" title={gt("Session fallback")}>
        {gt("For first-party surfaces the same endpoints also accept the logged-in session cookie. Third-party apps must use a bearer access token.")}
      </Callout>

      <H2 id="scopes">{gt("Scopes")}</H2>
      <P>
        <InlineCode>sdk.presence</InlineCode>, <InlineCode>sdk.relationships</InlineCode>, <InlineCode>sdk.games.read</InlineCode>, <InlineCode>sdk.games.write</InlineCode>, <InlineCode>sdk.widgets.write</InlineCode>. {gt("Request only what you use — users see the scopes on the consent screen.")}
      </P>
    </DocPage>
  );
}
