import { DocPage, P, H2, UL, CodeBlock, Callout, Endpoint, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Stage Instance",
  description: "SerikaCord Stage Instance resource: stage instance object, privacy levels, endpoints, permissions, audit log entries and gateway events.",
  path: "/developers/docs/resources/stage-instance",
  keywords: ["SerikaCord stage instance", "stage channel", "stage topic", "live stage"],
});

export default async function StageInstanceDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Stage Instance")} description={gt("Open, update and close a live stage: the topic and privacy of a stage channel.")}>
      <P>{gt("A stage instance holds the topic of a live stage channel. A stage channel has at most one.")}</P>

      <H2 id="stage-instance-object">{gt("Stage Instance Object")}</H2>
      <CodeBlock lang="json">{`{
  "id": "1234567890",
  "guild_id": "1234567890",
  "channel_id": "1234567890",
  "topic": "Weekly Q&A",
  "privacy_level": 2,
  "discoverable_disabled": true,
  "guild_scheduled_event_id": null
}`}</CodeBlock>

      <H2 id="privacy-level">{gt("Privacy Level")}</H2>
      <Table headers={[gt("Level"), gt("Value"), gt("Description")]} rows={[
        ["PUBLIC", "1", gt("Deprecated by Discord; refused.")],
        ["GUILD_ONLY", "2", gt("Visible to guild members only. The default and only accepted value.")],
      ]} />

      <H2 id="endpoints">{gt("Endpoints")}</H2>
      <Endpoint method="POST" path="/stage-instances">{gt("Open a stage. Body: channel_id, topic, and optionally privacy_level, send_start_notification and guild_scheduled_event_id.")}</Endpoint>
      <Endpoint method="GET" path="/stage-instances/{channel.id}">{gt("Get the stage instance of a stage channel.")}</Endpoint>
      <Endpoint method="PATCH" path="/stage-instances/{channel.id}">{gt("Change topic or privacy_level.")}</Endpoint>
      <Endpoint method="DELETE" path="/stage-instances/{channel.id}">{gt("Close the stage. Returns 204.")}</Endpoint>
      <P>
        {gt("Creating, updating and deleting require the bot to be a stage moderator: Manage Channels, Mute Members and Move Members in the channel. send_start_notification also requires Mention Everyone. The channel must be a stage channel (50024 otherwise). topic is 1 to 120 characters.")}
      </P>
      <P>
        {gt("guild_scheduled_event_id must name a stage event of the same channel. Opening a stage that is already open answers 150006, and a channel without a stage instance answers 10067 (Unknown Stage Instance).")}
      </P>

      <H2 id="speakers-and-audience">{gt("Speakers and Audience")}</H2>
      <P>{gt("Stage channels (type 13) can be created like other channels, and people and bots join them like voice channels. A stage works without a stage instance; the instance only adds the topic.")}</P>
      <UL>
        <li>{gt("Stage moderators (Mute Members, Move Members or Manage Channels in the stage, or Administrator) join as speakers. Everyone else joins the audience, with suppress true in their voice state.")}</li>
        <li>{gt("Audience members with Request to Speak can raise their hand; it shows as request_to_speak_timestamp. Moderators invite people to speak or move them back to the audience, and anyone can step down.")}</li>
        <li>{gt("The audience is never heard, by people or by bots.")}</li>
      </UL>
      <P>
        {gt("Bots change their own stage state and other people's through the voice state endpoints on")}{" "}
        <Link2 href="/developers/docs/resources/voice">{gt("Voice")}</Link2>{" "}
        {gt("and join with gateway op 4, see")}{" "}
        <Link2 href="/developers/docs/topics/voice-connections">{gt("Voice Connections")}</Link2>.
      </P>

      <H2 id="audit-log-and-events">{gt("Audit Log and Events")}</H2>
      <P>
        {gt("Changes are recorded in the audit log as STAGE_INSTANCE_CREATE (83), STAGE_INSTANCE_UPDATE (84) and STAGE_INSTANCE_DELETE (85); send an X-Audit-Log-Reason header to add a reason. Bots that can see the channel receive STAGE_INSTANCE_CREATE, STAGE_INSTANCE_UPDATE and STAGE_INSTANCE_DELETE with the GUILDS intent, and GUILD_CREATE carries stage_instances.")}
      </P>

      <Callout type="info" title={gt("SerikaCord Differences")}>
        {gt("send_start_notification is only permission-checked: SerikaCord sends no stage start notification yet. PUBLIC stages (privacy_level 1) are refused, and discoverable_disabled is always true.")}
      </Callout>
    </DocPage>
  );
}
