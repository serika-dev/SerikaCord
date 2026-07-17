import { DocPage, P, H2, UL, CodeBlock, Callout, Strong, InlineCode, Link2 } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK · Widgets",
  description: "Author a profile widget in the portal and push per-user dynamic data to render it.",
  path: "/developers/docs/social-sdk/widgets",
  keywords: ["Serika widgets", "profile widget", "widget user data"],
});

export default async function WidgetsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Profile Widgets")}
      description={gt("Author a widget config in the Widget editor, then push per-user data over the API so it renders on each user's profile.")}
    >
      <H2 id="model">{gt("The model")}</H2>
      <UL>
        <li><Strong>{gt("Widget config")}</Strong> — {gt("the design + field bindings you build in the editor. One published config per application.")}</li>
        <li><Strong>{gt("Surfaces")}</Strong> — <InlineCode>widget_top</InlineCode> {gt("(image + title + subtitles) and")} <InlineCode>widget_bottom</InlineCode> {gt("(a stat grid).")}</li>
        <li><Strong>{gt("Fields")}</Strong> — {gt("each bound to a")} <InlineCode>custom_string</InlineCode> {gt("(static),")} <InlineCode>app_asset</InlineCode> {gt("(static image) or")} <InlineCode>user_data</InlineCode> {gt("(dynamic, keyed).")}</li>
        <li><Strong>{gt("User data")}</Strong> — {gt("per-user values for the")} <InlineCode>user_data</InlineCode> {gt("fields, pushed over the API.")}</li>
      </UL>

      <Callout type="info" title={gt("Build it visually")}>
        {gt("Open your app's")} <Link2 href="/developers/applications">{gt("Widget editor")}</Link2> {gt("to design surfaces, preview live, fill sample data, and publish.")}
      </Callout>

      <H2 id="config">{gt("Reading the published config")}</H2>
      <CodeBlock lang="bash">{`GET /api/v1/applications/:id/widget/config
# → { application_id, name, surfaces, version }`}</CodeBlock>

      <H2 id="user-data">{gt("Pushing user data")}</H2>
      <P>{gt("Send the dynamic values for the current user. The shape matches the JSON the editor generates.")}</P>
      <CodeBlock lang="json">{`PUT /api/v1/applications/:id/users/@me/widget-data
{
  "data": {
    "dynamic": [
      { "type": 3, "name": "TopShowImg", "value": { "url": "https://…/img.png" } },
      { "type": 1, "name": "TopShowTitle", "value": "Serika Test" },
      { "type": 1, "name": "HoursWatched", "value": "239.3 Hours" }
    ]
  }
}`}</CodeBlock>

      <Callout type="warning" title={gt("Image URLs must be public")}>
        {gt("User-data images are not uploaded to Serika — provide publicly reachable https URLs (host them yourself or via the Serika CDN).")}
      </Callout>

      <H2 id="render">{gt("Where it renders")}</H2>
      <P>
        {gt("Once published, users can add your widget from the")} <Strong>{gt("Add Widget")}</Strong> {gt("modal on their profile. It renders using the config + that user's pushed data (falling back to your sample data).")}
      </P>
    </DocPage>
  );
}
