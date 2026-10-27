import { DocPage, P, H2, CodeBlock, Callout, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Guild Scheduled Event",
  description: "SerikaCord Guild Scheduled Event resource: event object, entity types, status values, CRUD endpoints, and subscriber listing.",
  path: "/developers/docs/resources/guild-scheduled-event",
  keywords: ["SerikaCord scheduled event", "guild event", "event status", "event subscribers"],
});

export default async function GuildScheduledEventDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Guild Scheduled Event")} description={gt("Create and manage scheduled events in guilds.")}>
      <H2 id="event-object">{gt("Scheduled Event Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "guild_id": "1234567890",
  "name": "Game Night",
  "description": "Weekly game night",
  "scheduled_start_time": "2026-07-10T20:00:00.000Z",
  "scheduled_end_time": "2026-07-10T22:00:00.000Z",
  "privacy_level": 2,
  "status": 1,
  "entity_type": 3,
  "entity_id": null,
  "entity_metadata": { "location": "Online" },
  "creator": { "id": "123", "username": "host" },
  "user_count": 42
}`}</CodeBlock>

      <H2 id="entity-types">{gt("Entity Types")}</H2>
      <Table headers={[gt("Type"), gt("Value"), gt("Description")]} rows={[
        [gt("Stage Instance"), "1", gt("Stage channel event")],
        [gt("Voice"), "2", gt("Voice channel event")],
        [gt("External"), "3", gt("External event (with location)")],
      ]} />

      <H2 id="status">{gt("Event Status")}</H2>
      <Table headers={[gt("Status"), gt("Value")]} rows={[
        [gt("Scheduled"), "1"],
        [gt("Active"), "2"],
        [gt("Completed"), "3"],
        [gt("Canceled"), "4"],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/scheduled-events">{gt("List scheduled events.")}</Endpoint>
      <Endpoint method="POST" path="/guilds/{guild.id}/scheduled-events">{gt("Create a scheduled event.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/scheduled-events/{event.id}">{gt("Get a scheduled event.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/scheduled-events/{event.id}">{gt("Update a scheduled event.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/scheduled-events/{event.id}">{gt("Delete a scheduled event.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/scheduled-events/{event.id}/users">{gt("Get event subscribers.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/scheduled-events/{event.id}/users/counts">{gt("Count event subscribers. Takes up to 10 guild_scheduled_event_exception_ids.")}</Endpoint>
      <CodeBlock lang="json">{`{
  "guild_scheduled_event_count": 42,
  "guild_scheduled_event_exception_counts": {}
}`}</CodeBlock>
      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("Events are guild-only (privacy_level 2) and can't repeat. Creating needs Create Events (editing or deleting someone else's event needs Manage Events). Live stage topics are documented on the")}{" "}
        <Link2 href="/developers/docs/resources/stage-instance">{gt("Stage Instance")}</Link2>{" "}
        {gt("page.")}
      </Callout>

      <H2 id="exceptions">{gt("Event Exceptions")}</H2>
      <P>{gt("Discord uses exceptions to change or cancel one occurrence of a recurring event. Serika events never recur, so no event has exceptions and the per-exception counts above are always empty.")}</P>
      <Endpoint method="POST" path="/guilds/{guild.id}/scheduled-events/{event.id}/exceptions">{gt("Checks permissions and the body, then answers 400 (50035) with GUILD_SCHEDULED_EVENT_NOT_RECURRING on original_scheduled_start_time.")}</Endpoint>
      <Endpoint method="PATCH" path="/guilds/{guild.id}/scheduled-events/{event.id}/exceptions/{exception.id}">{gt("Answers 404 Unknown Guild Scheduled Event Exception.")}</Endpoint>
      <Endpoint method="DELETE" path="/guilds/{guild.id}/scheduled-events/{event.id}/exceptions/{exception.id}">{gt("Answers 404 Unknown Guild Scheduled Event Exception.")}</Endpoint>
      <Endpoint method="GET" path="/guilds/{guild.id}/scheduled-events/{event.id}/{exception.id}/users">{gt("Answers 404 Unknown Guild Scheduled Event Exception.")}</Endpoint>
      <P>{gt("The write routes need Manage Events, or Create Events for the bot's own event. Events in channels the bot can't see answer Unknown Guild Scheduled Event.")}</P>
    </DocPage>
  );
}
