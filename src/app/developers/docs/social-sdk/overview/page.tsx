import { DocPage, P, H2, UL, Callout, Strong, InlineCode, Link2, CardGrid, Card } from "../../DocPage";
import { KeyRound, Users, Gamepad2, LayoutGrid } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK Overview",
  description: "The Serika Social SDK — relationships, presence, Serika RPC, and profile widgets over the native /api/v1 API.",
  path: "/developers/docs/social-sdk/overview",
  keywords: ["Serika Social SDK", "rich presence", "profile widgets", "relationships"],
});

export default async function SocialSdkOverviewDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Social SDK Overview")}
      description={gt("Bring Serika relationships, live presence, RPC image assets, and configurable profile widgets into your application.")}
    >
      <P>
        {gt("The Social SDK is a set of native HTTP endpoints under")} <InlineCode>/api/v1</InlineCode> {gt("that let your app read a user's Serika relationships and presence, drive a Serika RPC activity, and author a profile widget. It is designed so you can wrap it in a native binary SDK later — the HTTP surface is the contract.")}
      </P>

      <Callout type="info" title={gt("Base URL")}>
        {gt("All Social SDK calls are made against")} <InlineCode>https://api.serika.chat/api/v1</InlineCode>. {gt("Authenticate with an OAuth2 access token — see External Auth.")}
      </Callout>

      <H2 id="capabilities">{gt("What you can do")}</H2>
      <CardGrid>
        <Card href="/developers/docs/social-sdk/external-auth" title={gt("External Auth")} icon={<KeyRound className="size-4" />}>
          {gt("Obtain OAuth2 access tokens with SDK scopes and call the API on behalf of a user.")}
        </Card>
        <Card href="/developers/docs/social-sdk/relationships" title={gt("Relationships & Presence")} icon={<Users className="size-4" />}>
          {gt("Read a user's friends and blocked list, and their friends' live rich presence.")}
        </Card>
        <Card href="/developers/docs/social-sdk/relationships" title={gt("Serika RPC")} icon={<Gamepad2 className="size-4" />}>
          {gt("Push a rich presence activity with large/small image assets and buttons.")}
        </Card>
        <Card href="/developers/docs/social-sdk/widgets" title={gt("Profile Widgets")} icon={<LayoutGrid className="size-4" />}>
          {gt("Author a widget in the portal and push per-user dynamic data to render it.")}
        </Card>
      </CardGrid>

      <H2 id="scopes">{gt("Scopes")}</H2>
      <UL>
        <li><InlineCode>sdk.presence</InlineCode> — {gt("read and write rich presence")}</li>
        <li><InlineCode>sdk.relationships</InlineCode> — {gt("read friends and blocked users")}</li>
        <li><InlineCode>sdk.games.read</InlineCode> / <InlineCode>sdk.games.write</InlineCode> — {gt("read/modify the game library")}</li>
        <li><InlineCode>sdk.widgets.write</InlineCode> — {gt("push widget user-data")}</li>
      </UL>

      <P>
        {gt("Enable the Social SDK on your application from the")} <Link2 href="/developers/applications">{gt("Developer Portal")}</Link2> {gt("under the app's Social SDK tab, then head to")} <Strong>{gt("API Reference")}</Strong>.
      </P>
    </DocPage>
  );
}
