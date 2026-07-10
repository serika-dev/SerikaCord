import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
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
    </DocPage>
  );
}
