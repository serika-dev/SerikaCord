import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Table, Endpoint } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Social SDK · Widgets",
  description: "Author a profile widget in the portal and push per-user dynamic data to render it.",
  path: "/developers/docs/social-sdk/widgets",
  keywords: ["Serika widgets", "profile widget", "widget config", "game widget", "widget user data"],
});

export default async function WidgetsDoc() {
  const gt = await getGT();
  return (
    <DocPage
      title={gt("Profile Widgets")}
      description={gt("Widgets are tiles on a user's profile. Users showcase their gaming interests with game widgets; applications author widget configs and push per-user data to render custom widgets.")}
    >
      <Callout type="info" title={gt("Build it visually")}>
        {gt("Open your app's")} <Link2 href="/developers/applications">{gt("Widget editor")}</Link2> {gt("(full screen) to pick a surface, choose a layout, bind fields, preview live with sample data, and publish.")}
      </Callout>

      {/* ── Game Widget Object ────────────────────────────────────────────── */}
      <H2 id="game-widget">{gt("Game Widget Object")}</H2>
      <P>{gt("A tile on a user's profile showcasing their gaming interests.")}</P>
      <Table
        headers={[gt("Field"), gt("Type"), gt("Description")]}
        rows={[
          ["data", gt("game widget data object"), gt("The data of the widget")],
          ["id", "snowflake", gt("The ID of the widget")],
          ["updated_at", "ISO8601 timestamp", gt("When the widget was last updated")],
        ]}
      />
      <H3 id="game-widget-data">{gt("Game Widget Data Structure")}</H3>
      <Table
        headers={[gt("Field"), gt("Type"), gt("Description")]}
        rows={[
          ["type", "string", gt("The type of the game widget")],
          ["games?", "array[game widget game]", gt("The widget's games (not for application widgets)")],
          ["application_id?", "snowflake", gt("The application ID (application widgets only)")],
        ]}
      />
      <H3 id="game-widget-type">{gt("Game Widget Type")}</H3>
      <Table
        headers={[gt("Value"), gt("Max"), gt("Description")]}
        rows={[
          ["favorite_games", "1", gt("Favourite game (detailed)")],
          ["played_games", "20", gt("Games I like")],
          ["current_games", "5", gt("Games in rotation (detailed)")],
          ["want_to_play_games", "20", gt("Want to play")],
          ["application", "—", gt("Specific game details (application widget)")],
        ]}
      />
      <H3 id="game-widget-game">{gt("Game Widget Game Structure")}</H3>
      <Table
        headers={[gt("Field"), gt("Type"), gt("Description")]}
        rows={[
          ["game_id", "snowflake", gt("The application ID of the game")],
          ["comment?", "?string", gt("Optional comment shown in detailed widgets")],
          ["tags?", "array[string]", gt("Tags shown in detailed widgets")],
        ]}
      />
      <P>{gt("Tags include skill tags")} (<InlineCode>noob</InlineCode>, <InlineCode>casual</InlineCode>, <InlineCode>intermediate</InlineCode>, <InlineCode>expert</InlineCode>, <InlineCode>better_than_you</InlineCode>…) {gt("of which only one may be present at a time, plus sentiment/intent tags")} (<InlineCode>love_it</InlineCode>, <InlineCode>obsessed</InlineCode>, <InlineCode>looking_for_group</InlineCode>, <InlineCode>open_to_teach</InlineCode>…).</P>
      <CodeBlock lang="json">{`{
  "id": "1455894303866880153",
  "updated_at": "2025-12-31T12:04:11.252336+00:00",
  "data": {
    "type": "favorite_games",
    "games": [
      { "game_id": "505134938354352128", "comment": "Best game ever!", "tags": ["expert", "open_to_teach"] }
    ]
  }
}`}</CodeBlock>

      {/* ── Widget Config Object ──────────────────────────────────────────── */}
      <H2 id="widget-config">{gt("Widget Config Object")}</H2>
      <P>{gt("An application-authored widget displayed on a user's profile. SerikaCord keeps one config per application.")}</P>
      <Table
        headers={[gt("Field"), gt("Type"), gt("Description")]}
        rows={[
          ["application_id", "snowflake", gt("The application the config is for")],
          ["config_id", "snowflake", gt("The ID of the widget config")],
          ["display_name", "string", gt("The display name of the config")],
          ["surfaces", "map[string, surface]", gt("The surfaces the config renders on")],
          ["status", "string", gt("draft or published")],
          ["resolved_assets?", "array[asset]", gt("Resolved application assets")],
          ["published_at", "?ISO8601", gt("When it was published")],
          ["updated_at", "ISO8601", gt("When it was last updated")],
        ]}
      />
      <H3 id="surfaces">{gt("Surfaces")}</H3>
      <P>{gt("A config is composed of up to five surfaces, each with a layout and a map of components → fields.")}</P>
      <Table
        headers={[gt("Surface"), gt("Layouts"), gt("Description")]}
        rows={[
          ["widget_top", "widget_top_hero, widget_top_contained", gt("Top of the widget: title/description + image")],
          ["widget_bottom", "widget_bottom_stats, widget_bottom_progress, widget_bottom_collection", gt("Bottom: stat grid, progress bar, or 2×2 collection")],
          ["add_widget_preview", "add_widget_preview_hero, add_widget_preview_contained", gt("Shown in the Add Widget picker")],
          ["mini_profile", "mini_profile_hero_stat, mini_profile_contained_stat", gt("One stat + one image on the mini profile")],
          ["activity_accessory", "activity_accessory_stat", gt("A stat shown under the user's activity")],
        ]}
      />
      <H3 id="fields">{gt("Fields")}</H3>
      <P>{gt("Each field has a")} <InlineCode>value_type</InlineCode>, {gt("an optional")} <InlineCode>presentation_type</InlineCode>, {gt("a")} <InlineCode>value</InlineCode>, {gt("and an optional")} <InlineCode>fallback</InlineCode>.</P>
      <UL>
        <li><Strong>value_type</Strong> — <InlineCode>data</InlineCode> {gt("(from per-user identity data),")} <InlineCode>custom_string</InlineCode> {gt("(static), or")} <InlineCode>application_asset</InlineCode> {gt("(static image).")}</li>
        <li><Strong>presentation_type</Strong> — <InlineCode>text</InlineCode>, <InlineCode>number</InlineCode>, {gt("or")} <InlineCode>duration</InlineCode> {gt("(milliseconds → \"2m 3s\"). Number/duration force")} <InlineCode>data</InlineCode>.</li>
        <li><Strong>fallback</Strong> — {gt("a nested field used when no")} <InlineCode>data</InlineCode> {gt("value is available yet.")}</li>
      </UL>

      {/* ── User data ─────────────────────────────────────────────────────── */}
      <H2 id="user-data">{gt("Pushing user data")}</H2>
      <P>{gt("For")} <InlineCode>data</InlineCode> {gt("fields, push each user's values. Entry types: 1 = string, 2 = number, 3 = media. This matches the JSON the editor generates.")}</P>
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

      {/* ── Endpoints ─────────────────────────────────────────────────────── */}
      <H2 id="endpoints">{gt("Endpoints")}</H2>

      <Endpoint method="PUT" path="/api/v1/users/@me/widgets">
        {gt("Replace the user's profile game widgets (max 1 of each type). Body:")} <InlineCode>{`{ widgets: [game widget] }`}</InlineCode>. {gt("Returns the stored game widgets.")}
      </Endpoint>
      <Endpoint method="GET" path="/api/v1/users/@me/widgets/suggested-games">
        {gt("Returns")} <InlineCode>suggested_games</InlineCode> {gt("and")} <InlineCode>suggested_wishlist_games</InlineCode> {gt("(application IDs) from the user's library.")}
      </Endpoint>
      <Endpoint method="GET" path="/api/v1/widget-configs/featured">
        {gt("Returns published widget configs grouped by application:")} <InlineCode>{`{ application_ids, configs }`}</InlineCode>.
      </Endpoint>
      <Endpoint method="GET" path="/api/v1/widget-configs/layout-definitions">
        {gt("Returns the layout definitions (components → fields, required flags, allowed presentation types) for every surface/layout.")}
      </Endpoint>
      <Endpoint method="GET" path="/api/v1/applications/:id/widget/config">
        {gt("Returns the published config for an application (application_id, name, surfaces, version).")}
      </Endpoint>
      <Endpoint method="GET" path="/api/v1/users/:id/application-identities">
        {gt("Returns the user's external identities for connected applications.")}
      </Endpoint>
      <Endpoint method="GET" path="/api/developers/applications/:id/widget-configs">
        {gt("List Application Widget Configs (returns the single config as an array). Requires app access.")}
      </Endpoint>
      <Endpoint method="PUT" path="/api/developers/applications/:id/widget">
        {gt("Create or update the config (display_name, surfaces, sample data). Requires app access.")}
      </Endpoint>
      <Endpoint method="POST" path="/api/developers/applications/:id/widget/publish">
        {gt("Publish the config so users can add it. Also /unpublish to revert to draft.")}
      </Endpoint>
      <Endpoint method="DELETE" path="/api/developers/applications/:id/widget">
        {gt("Delete the application's widget config.")}
      </Endpoint>

      <H2 id="render">{gt("Where it renders")}</H2>
      <P>
        {gt("Once published, users add your widget from the")} <Strong>{gt("Add Widget")}</Strong> {gt("button on their profile. It renders using the config + that user's pushed data (falling back to your sample data). Widgets with no resolvable content are never shown.")}
      </P>
    </DocPage>
  );
}
