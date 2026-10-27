import { DocPage, P, H2, H3, UL, CodeBlock, Callout, Strong, InlineCode, Link2, Endpoint, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Threads",
  description:
    "SerikaCord threads: create, list, join, leave, and manage threads. Public, private, and announcement thread types with auto-archive.",
  path: "/developers/docs/topics/threads",
  keywords: ["SerikaCord threads", "public thread", "private thread", "auto-archive"],
});

export default async function ThreadsDoc() {
  const gt = await getGT();
  return (
    <DocPage title={gt("Threads")} description={gt("Threads are temporary sub-channels within a parent channel for focused conversations.")}>
      <H2 id="thread-types">{gt("Thread Types")}</H2>
      <Table headers={[gt("Type"), gt("Value"), gt("Description")]} rows={[
        [gt("Public Thread"), "11", gt("Visible to all members with channel access")],
        [gt("Private Thread"), "12", gt("Only visible to invited members")],
        [gt("Announcement Thread"), "10", gt("Threads in announcement channels")],
      ]} />

      <H2 id="creating-threads">{gt("Creating Threads")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/threads">
        {gt("Create a thread in a channel. Requires")}{" "}<InlineCode>CREATE_PUBLIC_THREADS</InlineCode> {gt("or")}{" "}
        <InlineCode>CREATE_PRIVATE_THREADS</InlineCode> {gt("permission.")}
      </Endpoint>
      <CodeBlock lang="json">{`{
  "name": "Thread Name",
  "type": 11,
  "auto_archive_duration": 1440,
  "rate_limit_per_user": 0
}`}</CodeBlock>

      <H2 id="message-threads">{gt("Starting a Thread from a Message")}</H2>
      <Endpoint method="POST" path="/channels/{channel.id}/messages/{message.id}/threads">
        {gt("Create a thread attached to a specific message.")}
      </Endpoint>
      <P>
        {gt("Like Discord, the new thread takes the starter message's id, so the thread id equals the message id (libraries such as discord.js rely on this). A message can start only one thread: a second create for the same message answers 400 with code 160004, \"A thread has already been created for this message\". System messages can't start threads, and forum channels don't take this route.")}
      </P>

      <H2 id="listing-threads">{gt("Listing Active Threads")}</H2>
      <Endpoint method="GET" path="/guilds/{guild.id}/threads/active">
        {gt("List all active threads in a guild.")}
      </Endpoint>

      <H2 id="joining-leaving">{gt("Joining and Leaving")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/thread-members/@me">{gt("Join a thread.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/thread-members/@me">{gt("Leave a thread.")}</Endpoint>

      <H2 id="thread-members">{gt("Thread Members")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/thread-members">
        {gt("List members of a thread. Requires the")}{" "}<InlineCode>GUILD_MEMBERS</InlineCode> {gt("privileged intent.")}
      </Endpoint>
      <P>
        {gt("Each thread member's join_timestamp is when that member joined the thread. Members who joined before SerikaCord started recording join times (and, if the record is unavailable, everyone) show the thread's creation time instead. flags is always 0.")}
      </P>

      <H2 id="auto-archive">{gt("Auto-Archive")}</H2>
      <P>{gt("Threads auto-archive after a period of inactivity:")}</P>
      <Table headers={[gt("Duration"), gt("Value (minutes)")]} rows={[
        [gt("1 hour"), "60"],
        [gt("24 hours"), "1440"],
        [gt("3 days"), "4320"],
        [gt("1 week"), "10080"],
      ]} />

      <H2 id="gateway-events">{gt("Gateway Events")}</H2>
      <UL>
        <li><InlineCode>THREAD_CREATE</InlineCode> — {gt("A thread was created")}</li>
        <li><InlineCode>THREAD_UPDATE</InlineCode> — {gt("A thread was updated")}</li>
        <li><InlineCode>THREAD_DELETE</InlineCode> — {gt("A thread was deleted")}</li>
        <li><InlineCode>THREAD_MEMBER_UPDATE</InlineCode> — {gt("Current user's thread member updated")}</li>
        <li><InlineCode>THREAD_MEMBERS_UPDATE</InlineCode> — {gt("Thread members changed")}</li>
      </UL>

      <H2 id="thread-object">{gt("Thread Object")}</H2>
      <P>{gt("A thread is a channel with type 10, 11, or 12. It has the same fields as a regular channel plus:")}</P>
      <Table headers={[gt("Field"), gt("Type"), gt("Description")]} rows={[
        ["thread_metadata", "object", gt("Contains archived, auto_archive_duration, archived_at, locked, invitable")],
        ["member_count", "integer", gt("Approximate number of members in the thread")],
        ["message_count", "integer", gt("Approximate number of messages in the thread")],
      ]} />

      <Callout type="info" title={gt("Forum Channels")}>
        {gt("Forum channels (type 15) contain threads as their primary content. Each post in a forum is a thread.")}
      </Callout>

      <H2 id="forum-posts">{gt("Forum Posts")}</H2>
      <P>
        {gt("In a forum channel the same endpoint creates a post: send the first message in")}{" "}<InlineCode>message</InlineCode>{" "}
        {gt("(content, embeds, components, files as multipart) and up to 5 tag ids in")}{" "}<InlineCode>applied_tags</InlineCode>.{" "}
        {gt("Like Discord, a new post only needs View Channel and Send Messages in the forum; Send Messages in Threads is not required for the first message. Forums with the REQUIRE_TAG flag reject posts without a tag.")}
      </P>
      <Callout type="info" title={gt("Ticket Forums")}>
        {gt("In a SerikaCord ticket forum every post is a private thread: only its members, roles with ticket access and members with Manage Threads can see it.")}
      </Callout>

      <H2 id="editing-threads">{gt("Editing Threads")}</H2>
      <Endpoint method="PATCH" path="/channels/{channel.id}">
        {gt("Thread fields: name, archived, auto_archive_duration, locked, invitable, rate_limit_per_user, applied_tags and the PINNED flag on forum posts.")}
      </Endpoint>
      <P>{gt("The thread's creator may rename, archive and retag it. Locking, invitable, slowmode and pinning need Manage Threads. Anyone who can send messages there may unarchive an unlocked thread. An archived thread only takes other changes together with archived set to false.")}</P>
      <P>{gt("Forum channels also take available_tags, default_reaction_emoji, default_sort_order, default_forum_layout, default_thread_rate_limit_per_user and the REQUIRE_TAG flag.")}</P>

      <H2 id="archived-threads">{gt("Archived Threads")}</H2>
      <Endpoint method="GET" path="/channels/{channel.id}/threads/archived/public">{gt("Public archived threads, newest archive first. Requires Read Message History.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/threads/archived/private">{gt("Private archived threads. Also requires Manage Threads.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/users/@me/threads/archived/private">{gt("Private archived threads the bot has joined.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/threads/search">{gt("Search a channel's threads by name words, tags and archive state. Requires Read Message History.")}</Endpoint>
      <Table headers={[gt("Query"), gt("Description")]} rows={[
        ["name", gt("Search words. Every word must match the start of some word in the thread title")],
        ["slop", gt("How many other title words may sit between the matched words, 0-100 (default 2). Other values answer 50035")],
        ["tag", gt("Comma-separated tag ids")],
        ["tag_setting", gt("match_some (default) or match_all")],
        ["archived", gt("true or false; leave it out for both")],
        ["min_id / max_id", gt("Only threads created at or after / at or before the time encoded in this id")],
        ["sort_by", gt("last_message_time (default), archive_time, creation_time or relevance")],
        ["sort_order", gt("desc (default) or asc")],
        ["limit / offset", gt("Page size 1-25 (default 25) and offset")],
      ]} />
      <P>{gt("The response has threads, the bot's own thread members, has_more and total_results. Relevance ranks exact titles first, then the words as a phrase, then tighter and earlier matches.")}</P>

      <H2 id="managing-members">{gt("Adding and Removing Members")}</H2>
      <Endpoint method="PUT" path="/channels/{channel.id}/thread-members/{user.id}">{gt("Add a member. Needs Send Messages in Threads; in a private thread the bot must be in it, and the thread must be invitable unless the bot has Manage Threads.")}</Endpoint>
      <Endpoint method="DELETE" path="/channels/{channel.id}/thread-members/{user.id}">{gt("Remove a member. Needs Manage Threads, or being the creator of a private thread.")}</Endpoint>
      <Endpoint method="GET" path="/channels/{channel.id}/thread-members/{user.id}">{gt("Get one thread member.")}</Endpoint>
      <P>{gt("Archived threads can't be joined, left or edited until they are unarchived. Sending a message to an archived, unlocked thread unarchives it.")}</P>

      <H2 id="sync-events">{gt("Staying in Sync")}</H2>
      <P>
        <InlineCode>THREAD_LIST_SYNC</InlineCode> {gt("arrives when the bot gains access to channels, with their active threads.")}{" "}
        <InlineCode>THREAD_MEMBERS_UPDATE</InlineCode> {gt("needs the GUILD_MEMBERS intent, except when the bot itself was added or removed.")}
      </P>
      <Callout type="warning" title={gt("SerikaCord Differences")}>
        {gt("Thread member flags are always 0, and members who joined before join times were recorded show the thread's creation time as join_timestamp.")}
      </Callout>
    </DocPage>
  );
}
