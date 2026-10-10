# SerikaCord — Full Changelog

**298 commits** · Jan 22 – Jul 21, 2026 · v0.0.1 → v1.2.7.

---

## Unreleased

### Features
- **Threads in text channels** — hover a message (or right-click / long-press it) and pick Create Thread, or use the new Threads button in the channel header, to start a side conversation like on Discord. The thread opens in a panel next to the channel that you can resize, close or expand to full size; the message it started from shows the thread's name, "N Messages ›" and the latest reply, and threads started from the header leave a "started a thread" line in the channel. The Threads button lists joined, other active and archived threads with search. Threads you join (by creating one, posting in it, being @mentioned or pressing Join Thread) appear under their channel in the sidebar with unread and mention badges, and only notify their members. Threads hide themselves after 1 hour, 24 hours, 3 days or 1 week without messages (posting reopens them); thread owners and moderators can close, reopen and change that time, and moderators can lock a thread. Private threads, and the Create Public/Private Threads, Send Messages in Threads and Manage Threads permissions, work like on Discord.
- **Polls** — the "+" next to the message box now has Create Poll (in channels, DMs and group DMs): ask a question with up to 10 answers (each with an optional emoji), pick how long it runs (1 hour, 4 hours, 8 hours, 24 hours, 3 days or 1 week) and whether people can choose more than one answer. Everyone votes right in the chat, sees live result bars with percentages and vote counts, can change or remove their vote until it closes, and can click an answer to see who voted for it. The author can end a poll early. When a poll ends, its results freeze and a "poll has closed" line shows the winning answer with a View Poll button. Bots can post polls through the API and get vote events like on Discord.
- **Forward messages** — Forward in a message's right-click menu, hover bar or long-press sheet opens a picker with your recent DMs, group DMs and every channel you can post in, with search. Pick up to 5, add an optional message and send: the message shows up as a "Forwarded" card with the original author, text, images, files and time, and clicking the footer jumps to the original if you can still see it. Your permissions (send messages, attach files, blocks and DM privacy) apply in every destination.
- **Search every message, like Discord** — the search bar in the chat header now searches the whole server (every channel and thread you can see) or the whole DM / group DM, across all history instead of only the latest few hundred messages. Filters show up as chips with autocomplete: `from:`, `mentions:`, `has:` (link, embed, file, image, video, sound, sticker, poll), `in:`, `before:`, `during:`, `after:` (with a date picker), `pinned:true` and `authorType:` (user, bot, webhook), plus your recent searches. Press Enter to open the results panel on the right (full screen on phones): results are grouped by channel with matching words highlighted, sort by Newest, Oldest or Most Relevant, page through them, and click any result to jump to it, even in another channel. Ctrl+F searches the current channel and Ctrl+Shift+F the whole server. Your messages stay encrypted: the search index never stores message text.
- **Right-click anyone, like Discord** — names and avatars in chat, @mentions, the member list, the DM list, group DM members, friends, message requests and people in voice channels all open the same menu: Profile, Mention, Message, Call, Add Note, Invite to Server, Add/Remove Friend (or accept/cancel a request), Block/Unblock, and in servers — when you're allowed — Change Nickname, a Roles submenu with checkboxes, Timeout, Kick and Ban (each with a confirmation and an optional reason), Open Mod View and Copy User ID. Moderators can now change other members' nicknames.
- **Private notes** — add a note to anyone ("only visible to you") from their profile card, full profile or the Add Note menu item. Notes save as you type and sync to your other devices.
- **Custom status with emoji and "Clear after"** — "Set Custom Status" opens a Discord-style dialog: pick an emoji (including your servers' custom emoji), write a status, choose when it clears (Today, 4 hours, 1 hour, 30 minutes or Don't clear) and your online status. The emoji shows in the member list, the DM list, the friends list and on profiles, and the status disappears on its own when its time is up.
- **Automatic Idle** — after 10 minutes without using SerikaCord on any of your devices you show as Idle, and you're back Online the moment you return. The desktop app uses your computer's idle time instead. Do Not Disturb, Invisible and an Idle you picked yourself are never changed, and hiding a browser tab no longer flips your status.
- **Blocked messages are hidden** — messages from people you've blocked collapse into "3 Blocked Messages — Show messages" rows in channels, group DMs and threads, and they no longer ping or notify you.
- **Message Requests** — a DM from someone who isn't your friend lands in Message Requests (next to Friends in the DM list, and on mobile) instead of your DMs, without a badge, sound or push. Open it to read it, then Accept to reply or Ignore/Block. Turn it off under Content & Social.
- **Friend Requests and Activity Privacy settings** — new User Settings pages choose who can send you friend requests (Everyone, Friends of Friends, Server Members — enforced when someone tries to add you) and whether your detected activity is shared or stored. The same settings are on mobile under Privacy & Safety.
- **Pick up where you left off** — opening a channel or DM with unread messages starts at the first one, under a red "NEW" line, with a bar on top: "12 new messages since 3:42 PM" with Jump to unread and Mark as read (Escape works too). Messages only count as read once you've actually seen them (chat on screen and scrolled to the bottom), not when the chat merely opens in a background tab, and the exact message you read syncs to your other devices. The new-messages pill shows how many are waiting below and jumps to them.
- **Group DMs** — the "+" next to Direct Messages (or "Add Friends to DM" in a DM, or the new-group button on mobile) opens a friend picker: pick one friend for a DM, or up to 9 to start a group (10 people max, like Discord). Groups get their own conversation with everything DMs have (replies, reactions, pins, edits, uploads, typing, unread line), a header with the group's icon and name, voice and video call buttons with the call panel for everyone, and a member list with the owner's crown. Anyone can rename the group or change its icon and add friends; the owner can remove people; anyone can leave (ownership passes to the next member). Changes show up live for everyone with lines like "Alex added Sam to the group." The DM list shows groups with stacked avatars or the icon, the member count and unread state, Ctrl+K finds them, and group messages, calls and missed-call notifications open the group.
- **A much more native desktop app** — the SerikaCord desktop app now uses your system's own notifications (with the sender's avatar; clicking one opens the app on that message, and it disappears once you've read the conversation), shows an unread badge on the taskbar/dock and a red dot on the tray icon, and its tray menu can mute, deafen and change your status (Online, Idle, Do Not Disturb, Invisible). Push to talk, mute and deafen work even while SerikaCord is in the background (set the keys under Keybinds → Global, including F13–F24 and mouse side buttons). Screen sharing opens a "Share your screen" picker with your screens and app windows, the camera and microphone stop asking every time, and `serika://` links (invites, channels, DMs) open in the running app. It remembers its window size and zoom, has spellcheck with suggestions on right-click, saves downloads where you choose, goes Idle when you're away from the computer, and shows an "Update ready" card when a new version has downloaded. A new Desktop section in User Settings (only in the app) covers start on login, start minimized, close/minimize to tray, native notifications, global shortcuts, spellcheck, auto-idle, hardware acceleration and update checks.
- **Mobile app feels native** — press and hold a message for a bottom sheet with quick reactions, Reply, Edit, Pin, Copy, Share and Delete; swipe a message left to reply; swipe right in a chat to go back to the channel list and left to open the member list. The Android back button closes sheets, dialogs, the image viewer and the member list first, then steps back (chat → channel list → home) and finally minimizes the app. Haptics on long-press, reactions, sending and pull-to-refresh, the system share sheet for invites and message links, status and navigation bars that match your theme, and the composer sits right on the keyboard (the tab bar steps aside while typing) with correct notch and gesture-bar spacing.
- **Push notifications on Android** — DMs, mentions and incoming calls reach your phone when you're not in the app, respecting your notification settings and mutes. Incoming calls ring full screen with Answer and Decline, notifications open the right conversation, and they clear themselves once you read it on any device. (Requires the updated Android app.)
- **Pick up where you left off** — opening a channel or DM with unread messages starts at the first one, under a red "NEW" line, with a bar on top: "12 new messages since 3:42 PM" with Jump to unread and Mark as read (Escape works too). Messages only count as read once you've actually seen them (window focused, scrolled to the bottom), not when the chat merely opens in a background tab, and the exact message you read syncs to your other devices. The new-messages pill shows how many are waiting below and jumps to them.
- **Per-server and per-channel notification settings** — right-click a server, category, channel or DM (or use the server menu / the bell in the chat header) for Notification Settings: All Messages, Only @mentions or Nothing, mute for 15 minutes, 1 hour, 8 hours, 24 hours or until you turn it back on, and per server suppress @everyone/@here and role mentions. Settings follow you across devices and apply to sounds, desktop notifications, toasts, the unread glow (muted channels are dimmed) and mention badges. Your old device-only mutes carry over.
- **Inbox** — the inbox button (or Ctrl+I) opens Mentions, Unreads (every unread channel and DM, with mark-all-read) and Missed calls; clicking an item jumps straight to the message. The mobile Notifications tab shows the same inbox.
- **Mark as read everywhere** — server icons, categories, channels and DMs all have Mark As Read; Shift+Esc marks the current server read, or everything when you're in your DMs.
- **Smarter desktop notifications** — one notification per conversation that updates to "3 new messages" instead of stacking, with the sender's avatar; it closes by itself once you read that conversation on any device, and clicking it opens the app on that message. The tab title shows "(n)" and the favicon (and desktop app badge) gets a red dot for unread mentions and DMs, clearing when you read them.
- **Missed call notifications** — if someone calls you and you don't pick up (they hang up first or it rings out), you get a "Missed call from Alex" desktop notification (or an in-app toast while you're in the app), once per call across all your tabs and devices; clicking it opens the DM. Declining a call counts as declined, not missed ("You declined a call from Alex."). Do Not Disturb and your desktop/toast notification settings are respected.
- **Group DM calls** — a group DM can now hold a call (right-click the group in the DM list → Start Call). Everyone else in the group rings with the group's name and who's calling; anyone can join or leave and the call keeps going until the last person hangs up. Declining only stops your own ringing, members who never joined get a missed-call notification, and the group's call log records who was in the call, who declined and who missed it. Only current group members can join.
- **Call messages in DMs** — starting a DM call leaves a line in the conversation like Discord: "Alex started a call." with a Join call button while it's going, then "…started a call that lasted 5 minutes." once it ends. Unanswered calls show "You missed a call from Alex." (red phone) for the person called and "Alex missed your call." for the caller, and the DM list preview reads "📞 Missed call".
- **Call without a microphone** — no mic, a blocked mic permission or a mic busy in another app no longer stops you from starting, answering or joining a call or voice channel. You join listen-only (you hear and see everyone; a notice and the mic button say others can't hear you), and pressing the mic button asks for the microphone again and puts you on the call once it works. Video calls work with just a camera too.
- **What's new page and version info** — User Settings and the mobile profile show the running version and commit (`SerikaCord v2.0.0 (abc1234)`) with a "What's new" link to the new `/changelog` page. Bug reports pick up the real version, and `/api/version` reports what's deployed.
- **Voice moderation and per-user volume** — right-click anyone in a voice channel (in the channel list or the call) for a User Volume slider (0–200%) and a Mute that only affects you, both remembered on this device. Moderators also get Server Mute, Server Deafen, Move To (any voice channel) and Disconnect, gated by Mute/Deafen/Move Members and channel permissions; with Move Members you can drag people between voice channels. Server mute and deafen stick across rejoins, show up live for everyone as red mic/headphone icons (yours appear in your user panel and call controls), and a moved or disconnected member is told why. Bots can server mute and deafen through the API too.
- **Input sensitivity and device pickers** — Voice & Video settings now pick your microphone, speaker and camera (switching mid-call without rejoining) and have Discord's Input Sensitivity: automatic, or a manual threshold slider over a live level meter that turns green when you'd be heard. Your mic only transmits above the threshold, and your speaking ring follows it. Let's Check plays your mic back so you can hear yourself; in a call the meter shows your real call level.
- **Better video calls** — calls in voice channels, DMs and group DMs share one stage: everyone gets a tile (camera, screen share or avatar card), click a tile to spotlight it with the rest in a filmstrip (click again or Esc for the grid), double-click or use the corner button for full screen, picture-in-picture for any video, and Pop Out moves the whole call into its own window in browsers that support it. The arrow next to Share Screen picks the stream's resolution (720p, 1080p, 1440p or Source) and frame rate (15, 30 or 60 FPS) before going live or while live, and people who join mid-stream now see the screen share too.

### Bug Fixes
- **Unread badges and notifications you can trust** — messages you're reading count as read even when the window isn't focused (a second monitor, the desktop app, after clicking into a video embed or devtools), as long as you've touched the app in the last minute; on phones, having the chat on screen is enough. Badges no longer count the same message twice, come back after you read the conversation, disagree between the sidebar, server icons, Inbox and the tab "(n)", or stay behind after the message is deleted or edited to drop your mention. Sending a message reads the conversation on all your devices, and your own messages from another device no longer light it up. Group DM messages now badge and notify the rest of the group. Renaming a channel or changing its permissions no longer makes it glow, channels you lose access to stop glowing, the "NEW" line no longer lands in the wrong place after "Mark as read", and anything missed while offline or reconnecting is caught up. Only one open tab alerts per message, and alerts are skipped for messages you've already read elsewhere.
- **Names in previews** — the Inbox, toasts, desktop notifications and the mobile DM list show "@Alice", "@Moderators" and "#general" instead of "@user", "@role" and "#channel".
- **Incoming calls ring again** — the person being called now hears the ringtone even with message sounds turned off (only Do Not Disturb, quiet hours or the new "Incoming call ringtone" switch in Notification settings silence it), at least at a sensible minimum volume. In a tab you haven't clicked yet, where the browser blocks sound, the call still shows a desktop notification ("Incoming call from Alex") that stays until you act and a flashing tab title, and the ringtone starts as soon as you click anywhere. The caller's "Calling…" ringback plays regardless of notification sound settings, and the "📞 Call started" message no longer pops a second notification on top of the ring.
- **DM calls feel like Discord** — calling someone shows a call area at the top of the DM with both avatars, "Calling…" and a ringback tone until they pick up, then a call timer and mute/deafen/camera/screen share/hang-up buttons. Unanswered calls stop after 40 seconds ("didn't answer"), a declined call says so, and when the other person leaves a 1:1 call it ends for you too. The voice bar names the DM (or channel) you're in on every page and links back to it, and gains a screen share button on desktop.
- **Calls survive network blips** — a short drop no longer ends the call or leaves frozen audio; the connection is re-established automatically. Joining a call from a second device moves it there instead of playing audio twice.
- **Clear call errors** — a blocked or missing microphone, a busy mic, a full channel or someone you can't call now shows a specific message in DMs too (it used to fail silently). Turning the camera off no longer leaves a frozen frame for the other person, and noise suppression no longer plays your own mic back to you.
- **"Call" from a user menu works when that DM is already open** — it used to do nothing.
- **No more page error on opening a DM** — fixed a hydration error (React #418) on `/dm/...` pages.
- **Settings apply right away** — chat-side toggles (TTS, inline media, message previews, emoji picker, developer mode) take effect without a reload; sliders no longer jump back or spam "Settings saved"; your theme, notification and DND settings and saved language load after signing in or switching accounts.
- **Privacy toggles work on desktop** — "Allow DMs from non-friends" and "Allow friend requests" now really block strangers, and there's a "Share activity status" switch. Bots can only DM people they share a server with who allow DMs.
- **Notification fixes** — "Mute @everyone and @here" also applies to the channel you have open, and turning off "Mentions only" notifies for messages in other channels.
- **Reduced motion, Compact mode and GIF autoplay** — turning off animations or GIF/animated emoji autoplay, or turning on Compact mode, now changes what you see. Advanced toggles that did nothing (Verbose Logging, API Latency, Debug Overlay) are gone.
- **Light theme and accent color work everywhere** — unread channels and DMs, the unsaved-changes bars, Server Settings, Create Server/Channel, Invite, the profile popup, the voice channel view and voice bar, and the emoji/GIF picker now follow your theme; toggles, sliders, your reactions and the slash-command menu follow your accent color. Keyboard focus rings and dropdown hover highlights are back.
- **Styled confirmations** — deleting a channel, leaving or deleting a server, kicking a member and discarding server settings use an in-app dialog instead of the browser popup, with the same wording from every entry point.
- **Dead buttons wired up** — Notification and Privacy Settings in the server menu open those settings, "View Full Bio" expands the bio, and the Community Guidelines link opens the guidelines.
- **Dead buttons and mobile fixes** — mobile Report a Bug / Help / Feedback now open the issue tracker and support server instead of silently saving to your browser; the mobile server back button works; the server rail shows unread and mention badges; "Forgot password?" goes to Serika Accounts; the DM search bar, "+" button, Notification/Privacy Settings menu items, "View Full Bio" and pull-to-refresh do something; "Mark all as read" in Notifications really marks channels read; the voice bar no longer covers the chat or shows a raw room id; notched iPhones get proper safe-area spacing; hotkeys with no feature behind them are gone from the shortcut list.
- **Code stays code** — links, mentions and `:emoji:` inside code blocks and `inline code` are no longer pulled out as links or pills, which used to split the block apart.
- **Enter sends slash commands with a text option** — it used to add a newline while the option hint was showing.
- **Reopened channels show edits, deletes and reactions made while you were away** — not just new messages.
- **Clicking a reply jumps to the original** even when it is far back in history.
- **Sending after jumping to a pin or search result** returns you to the latest messages instead of leaving a gap.
- **Scrolling far back keeps your place**, and long-open busy channels no longer slow down over time.
- **The "New" line marks the first unread message**, also when it continues someone's message group.
- **Japanese, Chinese and Korean input** — Enter that confirms a candidate no longer sends the message or saves an edit.
- **Messages keep their order when you send text while a file uploads.**
- **Custom emojis with the same name on two servers show the right image.**
- **A failed delete no longer hides messages that arrived meanwhile.**
- **Copied DM message links jump to the message.**
- **Right-click a person in chat or the DM list** — names and avatars in chat, and DM rows, open the user menu (Send Message, Add Friend, Call, Video Call, Copy Username/ID) like the member list does. (CORD-3)
- **Close DM works** — the X on a DM row did nothing. It now hides the conversation until a new message arrives (also in the DM menu). Remembered per device.
- **Role pills have an X** — remove a role straight from a member's role bar; the duplicate "..." role menu with toggles is gone, leaving the one with checkmarks. (CORD-27)
- **Categories are called categories** — Edit Category, Delete Category and Category Name instead of Channel. (CORD-28)
- **Deleting a category keeps its channels visible** — its channels used to keep pointing at the deleted category and vanished from the list. They now move out of it, and channels already orphaned this way show up again. (CORD-28)
- **Settings stop flashing a spinner** — user and server settings only show a loading state the first time, then refresh in the background. (CORD-30)
- **Channel permission label** — "Mention @everyone, @here, and All Roles", matching the role permission. (CORD-36)
- **One theme control** — the Theme style dropdown duplicated the theme tiles right below it. (CORD-38)
- **One animated emoji switch** — Appearance's "Animated Emojis" changed the same setting as GIF autoplay; it is now a single "Autoplay GIFs and animated emoji" switch in Text & Images. (CORD-39)
- **Edit Profile opens your profile** — it used to reopen settings on whatever page was last open. (CORD-21)
- **Menus highlight the item under the mouse** — server, member and other dropdown menus only highlighted on keyboard focus. (CORD-23)
- **"Don't scan any media content"** — the explicit media filter option showed a raw `&apos;`. (CORD-26)
- **Select lists no longer jitter at the bottom on macOS** — trackpad bounce scrolling fought the list's scroll buttons (Language picker and every other select). (CORD-37)
- **Settings page titles match the sidebar** — "Text Images" now reads "Text & Images", and other pages use their translated names. (CORD-40)
- **Headings keep their size with emoji, mentions or links in them** — the heading used to stop at the first custom emoji, mention or link. (CORD-48)
- **Desktop activity no longer shows Figma when it is closed** — Figma's background font helper (`figma_agent`) was counted as Figma. Ships with the next desktop build. (CORD-58)
- **Messages no longer go missing** — pressing Enter while the previous message was still sending dropped the new one; sends are now queued in order. Chats also fetch anything missed after a dropped connection, a sleeping laptop or a background tab, and opening a channel no longer loses messages that arrived while it loaded.
- **Realtime delivery doesn't depend on Redis any more** — the server delivered every event through a Redis round-trip (and silently dropped it when Redis hiccuped) because the stream registry was split between two copies of the API code.
- **Notifications for DMs and mentions** — DMs and mentions in other channels now play your notification sound, show a desktop notification when SerikaCord is in the background and a toast when it isn't. The "Direct Messages" and "Mentions" switches are honored, and sounds work in tabs that were never clicked.
- **Correct DM unread counts** — the last read message was counted as unread, and every new DM was counted twice.
- **Badges and notifications survive server restarts** — the activity stream gave up for good after a 401/502/503; it now reconnects.
- **Edits show up live** — edited messages in server channels only updated for others after a reload.
- **Presence** — closing or reloading a tab could leave you "offline" (and wiped DND/idle), and background tabs showed people offline while the app was open.
- **Reactions you add on another device show live**; "is typing…" clears when their message arrives; new forum posts appear live; failed uploads keep your files and text; a channel deleted while you're in it sends you back to the server.
- **Drafts survive leaving a channel**, and scrolling to the top of a short chat no longer stops new messages from scrolling into view.
- **No more crash screen after an update** — an open tab reloads to the new version instead of failing to load a page.
- **Private channels stay private** — activity (name, author, @everyone pings) from channels with permission overwrites only reaches members who can see them.
- **Roles you add to a private channel can see it** — a role or member allow on a channel never beat the @everyone deny, so "Private Channel" hid the channel from everyone, including the roles and people added to it. Channel overwrites now apply like Discord: @everyone, then roles, then the member. The same fix lets allowed roles post in read-only channels.
- **Forum posts are listed newest-activity first** — the post list was in no real order and big forums dropped recent posts; ticket forums could hide your own ticket.
- **Push to Talk works** — with Push to Talk on, your mic stays silent until you hold the key (not while typing in a text box) and closes when you let go or switch windows.
- **Voice settings apply to calls** — Echo Cancellation, Noise Suppression, Automatic Gain Control, Input Volume and Output Volume used to change only the mic test. They now apply in calls, including mid-call.
- **Authorized Apps lists each app separately** — authorizing a second app merged its scopes into the first app's entry.
- **Apply for Verification works** — the button did nothing; it now submits the application and shows it as pending.
- **"API Limits" footer link** on the developer home page opens the rate limits docs instead of a 404.
- **Deleted DMs leave the DM list preview** — the sidebar kept showing a deleted message as the conversation's last message.
- **DMs open for new users** — people who never changed a setting were treated as friends-only for DMs even though their privacy page said "Allow direct messages".
- **A reopened DM stays in the list** — opening a closed DM from Friends or a profile now brings it back for good instead of hiding it again when you navigate away.
- **One conversation per person** — two people messaging each other for the first time at the same moment could end up with split DM histories.
- **Deleting a server or account cleans up fully** — channels, memberships, roles, emojis, stickers, bans and webhooks go with the server, and an account deletion hands its servers to another member and removes it from friend lists.

### Performance
- Startup requests start while the page is still loading instead of after the app boots, duplicate requests are shared, and the open channel's messages are fetched in the same burst.
- About a third less JavaScript at startup: settings, server settings, profile and chat dialogs and the voice library load on first use.
- Switching between DMs and servers keeps app state instead of rebuilding it.
- The DM list and opening a DM need fewer back-to-back database round trips.
- Faster API: requests skip an internal proxy hop, `/@me` no longer waits on badge checks, server online counts are one query, mentions are filtered in the database, token checks are shared, and member/voice activity is polled in batches.

### Security
- **Notifications respect channel permissions** — the Notifications tab and mentions list no longer show @everyone/role mentions from private channels you can't view, and no longer read every message ever sent.
- **@everyone/@here and role mentions now respect permissions** — the server never checked `MENTION_EVERYONE`, so turning off "Mention @everyone" for a role or channel did nothing and anyone could ping the whole server. Members without it (after channel overwrites) now send @everyone/@here as plain text, and can only ping roles marked mentionable. Applies to messages, edits and forum posts. Owners and administrators are unaffected. (CORD-59)
- **Bot tokens are limited to their own servers** — the bot API never checked that a bot could see a channel, so any bot token could read, post in or delete from any channel or DM by id. Bots now need view access to the channel (and membership for server routes), and message ids must belong to that channel.
- **Role hierarchy is enforced** — Manage Roles could grant Administrator or assign roles above your own, and moderators could kick, ban or time out administrators. Members can now only edit, assign, reorder or delete roles below their highest role, only grant permissions they have, and only moderate members ranked below them. Role permission changes take effect within a minute at most (immediately on the same server).
- **Permissions match what the app shows** — Manage Channels can create, edit, reorder and delete channels; Manage Server can save server settings, the vanity URL, and manage invites; Manage Roles no longer edits server settings; Create Invite is required to make invites. Deleting an invite or unbanning shows an error instead of a fake success when it fails.
- **Bans stick** — banned users could rejoin a discoverable server from Explore, and approving an old application re-added them. Kicked, banned or departed members also stop receiving an open channel's messages right away instead of until they reload, and channels you lose access to through a role change close within a minute.
- **"Lock to Custom Invite" disables old invite links** — existing regular invite links now stop working while the lock is on, not just new ones.
- **Integration test notifications need Manage Server** — anyone could post the mock Twitch/YouTube/Discord notification into any server's channels.
- Member counts no longer drift: leaving a server you weren't in, bot kicks/bans of non-members and double-clicked joins could skew them, and simultaneous joins could go past an invite's max uses.
- **Posts in a private forum are private** — threads ignored their forum's permissions, so any member could read and reply to posts in a hidden forum and saw its activity. Threads now follow their parent channel.
- **Role permissions are enforced** — turning off View Channels, Send Messages, Attach Files, Add Reactions or Create Invite on a role was saved but never checked by the server.
- **Timeouts and Send Messages cover forum posts, reactions and slash commands** — timed-out members could still create forum posts, add reactions and run bot commands; forum posts now also follow slowmode and rate limits.
- **Voice channels are private to the people who can see them** — anyone who knew a voice channel's id could list who was in it, join it, or connect straight to a participant and hear them without showing up in the channel. Joining, listening and seeing who is connected now need access to the channel (or to be one of the two people in a DM call). Calls only connect between people visibly in the room, and voice channel user limits are enforced.
- **OAuth2 only redirects to registered URLs** — the authorize page sent you to whatever `redirect_uri` the link carried, including `javascript:` URLs, on Authorize or Cancel. It now has to be one of the app's registered redirect URIs, using https (or http on localhost).
- **Adding a bot can't hand out more than you have** — a member with Manage Server could give a bot Administrator, ranked above every role. The bot's role now only gets permissions the person adding it holds, and goes just below their highest role (owners and admins are unchanged).
- **Bots need the right permissions for server changes** — editing the server, channels, roles, members, emojis, webhooks and invites, kicking and banning now check the bot's permissions and role hierarchy, ids must belong to that server, and bots can't kick or ban the owner. A bot can only manage its own application's commands, and replacing global commands no longer deletes its per-server ones.
- **Webhook URLs need their token** — posting to a channel webhook ignored the token, so anyone with a channel id could post as its webhook. Webhook posts are now validated and rate limited, and only people who can manage webhooks (or the webhook's creator) see webhook URLs. Webhook posts show as the webhook, not the person who created it, and different names posted through one webhook are no longer merged under one header.
- **Hidden connections stay hidden, and Discord can't be self-declared** — connections you hid were still returned on your public profile. Discord, Steam, Last.fm and other sign-in providers can now only be linked through their sign-in flow, so nobody can claim someone else's Discord account in bridged channels. Deleting or hiding a connection, device or authorized app only works on your own.
- **Rate limits apply again** — the general API rate limit never ran; it is back with a generous budget, plus limits on login, sign-up, password reset, verification emails and QR login codes. The Fish Audio TTS proxy now needs a signed-in user, a configured voice and has a per-user limit. Developer app emojis, webhooks and team lists now need access to the app.
- **Blocked users and strangers can't plant DMs** — typing, streaming, pins and reactions no longer create a DM channel, typing is ignored when either side has blocked the other, empty DMs only show for the person who opened them, and sending through the generic channel route follows the same block and privacy rules as the DM route.

---

## v1.2.7 — 2026-07-21

**Tag:** `v1.2.7` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Major desktop app enhancement release — window state persistence, keyboard shortcuts, spellcheck, native download handling, dock badge support, mute toggle, and an enhanced tray menu.

### Features — Desktop
- **Window state persistence** — Window position, size, and maximized state are now saved and restored across launches via `tauri-plugin-window-state`.
- **Keyboard shortcuts** — `Ctrl/Cmd +/-` for zoom in/out, `Ctrl/Cmd+0` to reset zoom, `F11` for fullscreen toggle, `F12` / `Ctrl+Shift+I` for DevTools.
- **Spellcheck** — Native spellcheck is now enabled in the desktop webview.
- **Native download handling** — File downloads from the web app are redirected to the system Downloads directory instead of being blocked or handled by the browser.
- **Dock/taskbar badge** — The web app can now set a notification badge count on the dock/taskbar icon via `window.__serikaSetBadge(count)`.
- **Mute toggle** — Tray menu "Mute Notifications" checkbox that mutes/unmutes all audio in the webview and syncs state across the app.
- **Enhanced tray menu** — Added "Check for Updates…" and "Mute Notifications" items with separators to the system tray context menu.
- **Dynamic window title** — The native window title now tracks the SPA page title via a `MutationObserver`, keeping the titlebar and taskbar label in sync with the current channel/DM.

---

## v1.2.6 — 2026-07-20

**Tag:** `v1.2.6` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Image spoiler marking on upload with CDN-level blur (`?blur=25`) and click-to-reveal in chat.

### Features — Attachments
- **Spoiler marking on upload** — Eye toggle button on image/video attachment previews in the message bar. Marked attachments are sent with `spoiler: true` and stored on the message. Spoilered images render with `?blur=25` on the CDN URL and a click-to-reveal overlay in chat.

### Performance
- **Smaller scroll-up pagination batch** — Scroll-up history loading now fetches 25 messages instead of 50, reducing the main-thread freeze during mid-scroll pagination. Initial channel load remains 50 to fill the viewport in one request.

### Bug Fixes
- **Clipboard image paste in desktop app** — Added `tauri-plugin-clipboard-manager` and a fallback paste handler that reads images natively via Tauri IPC when the webview's clipboard event doesn't expose files (common on WebKitGTK/WebView2). RGBA bytes are converted to PNG via canvas and attached as a file.

---

## v1.2.5 — 2026-07-19

**Tag:** `v1.2.5` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Discord bridge consent system, real-time unread/badge infrastructure, chat performance optimizations, and user bio limit increase to 1000 characters.

### Features — Discord Bridge
- **Consent gating (both directions)** (`e8371fd`) — Inbound DiscordUser consent with DM buttons + weekly restriction; outbound Serika user opt-in. Bridge replies and embeds inbound; robust edit incl. embed-only updates. `/forgetme` slash command + page + `POST /api/discord/forget-me`. Block `@everyone`/`@here`/role pings on bridged webhooks (`allowed_mentions`). Copyable/maskable webhook URL field in channel settings. Hide friend button on bridged Discord users. `discord_users` consent columns (`manual_discord_consent.sql`). Terms/Privacy updated for Discord bridge compliance.
- **Sync consent prompt** (`3db60e4`) — `GET /api/channels/:id/bridge-status` (boolean, no webhook secret). `DiscordBridgeConsentDialog` shown on first send in a bridged channel. Choice persisted to `dataPrivacy.discordBridgeOutbound` + `discordBridgePrompted`. Settings toggle also marks prompted to suppress popup.
- **Per-server opt-in/opt-out** (`89bd516`) — `/opt-in` and `/opt-out` slash commands (usable in DMs and guilds). `restrictedGuildIds` array column on `discord_users` to track restricted guilds. `liftAllRestrictions()` reads `restrictedGuildIds` and lifts timeouts across all guilds on consent.
- **Startup restriction sweep** (`ec6a5d2`) — Optional `server` parameter on `/opt-in`/`/opt-out` for per-guild consent. `applyRestrictionTimeouts()` applies 1-week timeouts across bridged guilds with `discordRestrictUnconsented` enabled. `startupRestrictionSweep()` re-applies restriction timeouts to all opted-out users on bot startup (skips bots and recent timeouts).

### Features — Unread & Read Receipts
- **Real-time DM badges & server unread pills** (`0e73f01`) — `seedDmCounts`/`notifyDmActivity` in UnreadContext for authoritative per-DM unread counts (from `/api/dms`) and live increments (from `dm:list:update` SSE). Accent count badges on DM sidebar entries and mobile messages view. Discord-style short white pill on server icons for unread-without-mention. Prefetch DM messages on hover.
- **All-server channel activity seeding** (`d2ddabc`) — `GET /api/users/@me/channel-activity` fetches every visible channel's server ID + last-activity time in two queries (no joins). `channelMeta` seeded on mount so server-rail unread pills show for servers not yet opened. Auto-grant Discord bridge consent to bots.
- **Cross-device read receipts** (`ab597fa`) — `read_state` and `unread_reset` SSE events over activity streams. Read receipts broadcast to user's other sessions on `POST /ack`. `unread_reset` broadcast on message deletion (recomputes newest remaining message time). Right-click context menu on DM sidebar rows with "Mark As Read" and "Copy User ID".
- **markServerRead** (`2f60bb0`) — `markServerRead(serverId)` in UnreadContext marks all channels in a server as read. Wired into ServerSidebar context menu. "Mark As Read" enabled when mentions or unread pill present. `GET /servers/:id/activity` optimized by fetching roles upfront (parallel with channels) and computing admin permissions in-memory.
- **Real-time DM activity events** (`34ce3bd`) — `dm_activity` SSE event through activity stream so DM unread badges appear instantly when viewing servers. Broadcast to recipient on `POST /dms/:recipientId/messages`. Skip re-seeding DM counts for channels already marked read locally. `initializeAPI()` made idempotent. Embed markdown and paste fix.

### Performance
- **Unread badge cap at 100** (`61be4af`) — `MAX_UNREAD_BADGE=100` constant shared between client/server. Mention counts clamped at 100 in UnreadContext. Skip state updates when already at cap. `Message.unreadCounts()` rewritten to use windowed `row_number()` subquery capped at 100 instead of full-backlog `count(*)`.
- **Shared emoji/GIF favorites store** (`0e6eda5`) — `useEmojiFavorites` and `useGifFavorites` now back onto a single module-level store consumed through `useSyncExternalStore`: one fetch per auth state, one shared array, single set of subscribers. Eliminates dozens of identical `/emoji-favorites` and `/favorites` requests on busy channels.
- **SSE encoder reuse & bounded caches** (`0e73f01`) — Reuse shared `TextEncoder`/`TextDecoder` instances across SSE streams.

### Bug Fixes
- **Gateway/SSE connection-set leaks** (`287c9ae`) — Prune empty `Set` entries from `activeConnections` maps in `channels.ts`/`dms.ts` when last SSE stream closes. Prune empty per-user `Set` and per-room `Map` in `voice.ts`; evict ghost participants from `roomState` when last signaling stream drops without clean `POST /leave` (remaining members get `participant_left`). Fixes unbounded ghost-participant growth and "stuck in voice" UI bug.

### Database
- **Migration 0002_organic_bromley** (`54fb428`) — Database schema updates.
- **Discord consent columns** (`e8371fd`) — `manual_discord_consent.sql` adding consent columns to `discord_users`.

### Changes
- **Bio character limit → 1000** — Updated `maxBioLength` in `CUSTOMIZATION_OPTIONS` (both FREE and SERIKA_PLUS tiers) from 190/500 to 1000. Updated textarea `maxLength` and character counters in both the settings page (`[section]/page.tsx`) and `UserSettingsDialog.tsx`. Updated API validation `maxLength` in `/api/users/me` PUT endpoint.
- **serika-accounts submodule** (`ff72a61`) — Updated to latest.
- **Version bumps** — All platforms to 1.2.5; Android `versionCode` → 17.

---

## v1.2.4 — 2026-07-18

**Tag:** `v1.2.4` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Profile game widget enhancements, full OpenGraph/SEO for server pages, expanded OAuth2 scopes with validation, and developer docs improvements.

### Features
- **Game widget enhancements** — Favorite game now displays as a single rectangle poster with overlay text/tags. Grid posters use 5-column layout for smaller covers. Same game can be added to different categories (per-category dedup). Trash icon added to section headers and individual game edit controls for removal. Tags hidden for "Games I Like" and "Want to Play" categories. Tag picker icon added to AddGameDialog for favorite/rotation categories. `removeSection` function to clear entire widget sections.
- **Widget default visibility** — `surfaceHasContent` now only counts `data`-type fields as real content, preventing widgets with static `custom_string` fallbacks from showing by default. Widgets stay hidden until user data is added.
- **OpenGraph/SEO for server pages** — New `generateMetadata` layout at `/channels/[serverId]/` that fetches server name, description, icon, banner, and member count from the database for rich OpenGraph tags. Invite pages (`/[inviteCode]` and `/invite/[inviteCode]`) upgraded to dynamic `generateMetadata` with server info. Explore page gets dedicated SEO layout. `robots.ts` updated to allow indexing of `/channels/explore` and server pages. `sitemap.ts` now dynamically includes discoverable servers. `buildMetadata` enhanced with `max-image-preview`, `max-snippet`, theme-color, and msapplication metadata.
- **Expanded OAuth2 scopes** — Added 13 new scopes: `rpc.notifications.read`, `rpc.voice.read`, `rpc.video.write`, `rpc.screenshare.write`, `applications.commands.permissions.update`, `applications.entitlements`, `applications.store.update`, `dm_channels.read`, `dm_channels.write`, `relationships.read`, `profile.read`, `profile.write`, `analytics.read`. Backend scope validation with `VALID_OAUTH_SCOPES` set and `SCOPE_DEPENDENCIES` map for hierarchical scope requirements.
- **OAuth2 docs expansion** — Added Client Credentials Flow, Token Revocation, Error Codes, Rate Limits, and Scope Hierarchy sections. All new strings use `gt()` translation tags per AI-READ-THIS rules.

### Bug Fixes
- Fixed `removeSection` undefined error in `ProfileGameWidgets.tsx` by implementing the function.
- Fixed widget visibility — widgets with only static config fields no longer appear on profiles by default.

---

## v1.2.3 — 2026-07-17

**Tag:** `v1.2.3` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Server management enhancements: webhook creation, onboarding flow, app discovery, and discovery page state badges.

### Features
- **Channel webhook creation UI** — User-authenticated webhook CRUD endpoints (`/api/channels/:channelId/webhooks`) with permission checks (MANAGE_WEBHOOKS / server owner / creator). Channel settings dialog now has a proper webhook creation form with name input, loading state, and delete confirmation.
- **Server onboarding flow** — After creating a server, users are guided through a 2-step onboarding: set a server description and choose a join mode (Invite Only / Apply to Join / Discoverable). Settings are saved via the server settings API.
- **App Discovery tab** — New "App Discovery" tab in server settings for browsing public bots (`botPublic: true`). Includes search, app cards with icon/description/tags, and an "Add to server" button. New `/api/developers/discoverable-apps` endpoint.
- **Discovery page state badges** — Server cards on the discovery page now show badges for "Invite Only" (lock icon) and "Apply" (mail icon) join modes.

### Bug Fixes
- **Widget editor dropdown styling** — Fixed white-on-white text in `<select>` dropdowns by adding `[color-scheme:dark]`.
- **Widget auto-sample data** — Data fields configured in widget surfaces now auto-appear in the sample data section.
- **App owner widget visibility** — App owners can now see their own draft (unpublished) widgets on their profile and in available-widgets without OAuth validation.

### Changes
- **AI-READ-THIS.md** — Added versioning rules: every push must bump the patch version.
- **Version bumps** — All platforms to 1.2.3.

---

## v1.2.2 — 2026-07-17

**Tag:** `v1.2.2` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Widget editor UX polish and app owner widget display fixes.

### Bug Fixes
- **Widget editor UX** — Improved empty state messages, added "Edit first field" quick-action button, and better sample data empty state guidance.
- **Widget API 404 errors** — Fixed route mounting issues causing widget save/publish to return 404.

### Changes
- **Version bumps** — All platforms to 1.2.2.

---

## v1.2.1 — 2026-07-17

**Tag:** `v1.2.1` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Widget system fixes and profile widget display improvements.

### Bug Fixes
- **Profile widget rendering** — Fixed profile widgets not displaying correctly for app owners without OAuth.
- **Available widgets list** — Modified `/api/@me/available-widgets` to include app owner's draft widgets using OR condition.

### Changes
- **Version bumps** — All platforms to 1.2.1.

---

## v1.2.0 — 2026-07-17

**Tag:** `v1.2.0` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Serika Social SDK — profile game widgets, a Discord-style widget editor, Serika RPC image assets, and a native `/api/v1` API for third-party apps.

### Features
- **Profile game widgets** — new per-user game library (`user_games`) backing four built-in profile widgets: Favorite game (max 1), Games I like (up to 20, 2×4 with Show more), Games in rotation (up to 5), and Want to play (up to 20). Add via IGDB search, edit tags/notes, reorder; rendered in the Full Profile "Board" tab.
- **Widget system + editor** — application-authored widget configs (`widget_configs`) with a live in-portal editor (surfaces → fields → preview → sample data → Generate JSON → publish), a shared `WidgetRenderer` used by both the editor preview and the profile, an "Add Widget" modal, and per-user dynamic data (`widget_user_data`).
- **Serika RPC + images** — rich presence gains structured `assets` (large/small image + text), `buttons`, `applicationId`, and party fields. The existing desktop presence path is unchanged and simply accepts the new optional fields.
- **Native Social SDK API** — versioned `/api/v1` surface (identity, relationships, presences, rich-presence, game library, widget config + user-data) designed to wrap in a binary SDK later, with full docs under **Developers → Docs → Social SDK** and a per-app Social SDK tab.

### Changes
- **Developer portal** — new "Social SDK" and "Widget" tabs on applications; Social SDK promo on the Applications dashboard.
- **Version bumps** — Desktop + root to 1.2.0; Android `versionName` → 1.2.0, `versionCode` → 13.

### Database
- Additive-only migration `drizzle/manual_social_sdk.sql`: new `user_games`, `widget_configs`, `widget_user_data` tables, `users.profile_widgets`, and nullable `rich_presence` columns (`application_id`, `assets`, `buttons`, `party_id`, `party_size`). No existing data modified.

---

## v1.1.3 — 2026-07-17

**Tag:** `v1.1.3` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Desktop auto-update now actually works, and Steam games report their canonical English title.

### Bug Fixes
- **Auto-update never ran** (`main.rs`) — Tauri v2's updater is fully manual, but nothing ever called `check()`, so the desktop app never updated. Added a startup update check that downloads, installs, and relaunches the newer signed build; removed the invalid v1-style `"dialog": true` key from `tauri.conf.json`.
- **Steam/Proton games not detected on Linux** (carried from v1.1.2 line) — the detector now loads process env/cmd via `refresh_processes_specifics(everything())`.

### Features
- **English game titles** — Steam games now resolve to their canonical English title (and cover) instead of the localized Steam manifest name (e.g. Chinese). The desktop client sends the Steam AppId; the server resolves it via the Steam store API (`l=english`) with IGDB (matched by AppId, then name) for cover art. New `lookupGameBySteamAppId`; `/api/igdb/game` accepts `appId`.
- **Games prioritized** — Detected games sort ahead of editors/IDEs so the primary reported status is the game; duplicate activities are de-duplicated.

### Changes
- **Version bumps** — All platforms to 1.1.3; Android `versionName` → 1.1.3, `versionCode` → 12.

---

## v1.1.2 — 2026-07-17

**Tag:** `v1.1.2` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Point all client apps at the primary domain `https://serika.chat`.

### Changes
- **App domain → `serika.chat`** — Updated the base/start URL in every client shell: Tauri desktop (`main.rs` `APP_URL`, `tauri.conf.json` `frontendDist`), Electron desktop (`main.js` `APP_URL`), and mobile (`capacitor.config.json` server URL, both root and Android assets copy). Previously `waifu.ws`.
- **Version bumps** — All platforms to 1.1.2; Android `versionName` → 1.1.2, `versionCode` → 11.

---

## v1.1.1 — 2026-07-17

**Tag:** `v1.1.1` · **Commit:** `9cb76fa` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Greatly improved desktop game detection (Linux/Proton/Wine), a persistent recent-activity history surfaced on the full profile, and soundboard volume moved to a personal Voice & Video preference.

### Features — Desktop game detection
- **Steam-first resolution** — Reads the `SteamAppId`/`SteamGameId`/`STEAM_COMPAT_APP_ID` env var and the reaper `AppId=` argv, then resolves the real title from local `appmanifest_*.acf` files. Fixes mangled Proton/Wine titles for every Steam game with no per-game table.
- **Robust process inspection** — Uses the real exe path / argv0 instead of the 15-byte-truncated Linux `comm` name; discovers Steam libraries across native, Flatpak, and Snap layouts (cached, auto-refreshed).
- **Noise filtering** — Wine/Steam plumbing (`services.exe`, `winedevice`, `reaper`, `steamwebhelper`, anticheat, …) is never mistaken for a game; a game's child processes collapse into one activity.

### Features — Recent activity
- **`activity_history` store** — New table/model logging games & apps with cumulative playtime and session counts (migration `drizzle/manual_activity_history.sql`).
- **Full profile "Recently Played"** — Persistent history rendered on the profile Activity tab, privacy-gated by "show activity".
- **Opt-out** — "Store recent activity" toggle + "Clear activity history" button in Data & Privacy (`privacy.storeActivityHistory`).

### Changes
- **Soundboard volume moved** — Now a personal `voiceVideo.soundboardVolume` preference in User Settings → Voice & Video (removed from Server Settings); local playback multiplies server × personal volume.
- **Version bumps** — All platforms to 1.1.1; Android `versionName` → 1.1.1, `versionCode` → 10.

---

## v1.1.0 — 2026-07-16

**Tag:** `v1.1.0` · **Commit:** `fa0c0ce` · **Build:** GitHub Actions (Tauri desktop + Android APK)

### Release Notes

Version bump to 1.1.0 across all platforms (web, Tauri desktop, Electron desktop, Android). GitHub Actions release build triggered via `v1.1.0` tag — produces signed Tauri desktop builds (Windows .exe/.msi, macOS .dmg, Linux .AppImage/.deb/.rpm) and signed Android APK.

### Changes

- **Version bumps** — `package.json`, `desktop-tauri/package.json`, `tauri.conf.json`, `Cargo.toml`, `Cargo.lock`, `desktop/package.json` all updated to 1.1.0.
- **Android version** — `versionName` → `1.1.0`, `versionCode` → 9.
- **Mobile UI** — Version strings updated in `MobileDrawer.tsx` and `MobileProfileView.tsx`.
- **AI-READ-THIS.md** — Added fork requirement warning: users must have their own fork, remote must not point to `serika-dev/SerikaCord`.
- **Settings/UX improvements** — MemberSidebar, MessageList, UserSettingsDialog, MemberProfilePopup, ProfileCard, ServerContext, useChatSession updates (voice/video/accessibility/text-images settings tabs, live previews, toggle controls).

---

## Unreleased (postgres branch) — Jul 8–16, 2026

~93 commits on the `postgres` branch after v1.0.5.

### Security
- **XSS sanitization** (`876357a`) — `svgSanitizer.ts`; sanitized MarkdownRenderer, MessageContent, twemoji, image-cropper. 30 files (+1289/−324).
- **Internal-route auth bypass** (`7bff928`) — Patched auth bypass + stale channel-fetch race.
- **Internal request validation** (`4a6d52c`) — `/internal/*` bodies validated with Elysia schemas.
- **Cross-account cache leakage** (`f11b45f`) — Message cache cleared on account switch/logout.
- **Duplicate-spam detection** (`3c89f69`) — Blocks after 4 consecutive duplicates (HTTP 429). Normalizes diacritics, repeated chars, whitespace, punctuation.
- **SEND_MESSAGES enforcement** (`a023658`) — Backend + frontend overwrite enforcement (403). Admin/Manage Channels bypass.

### Features — Bug Report & Feedback
- **Bug report system** (`fa7d97a`) — BugReport model, user panel, admin panel, API, migration. 13 files (+1867).
- **Feedback & Bugs rebrand** (`a203261`) — `kind` field (`"bug"|"feedback"`), distinct categories, kind switcher.
- **Panel redesign** (`be72d0d`) — Hero header, drag-and-drop uploads, search, filter tabs. (+431/−276).
- **Modal overlay** (`ba3889f`) — Fixed overlay, focus management, Escape key, sticky footer.

### Features — Emoji & Stickers
- **Favorites system** (`32c1fdf`) — Database-backed `useEmojiFavorites` hook; context menus; star icon. 29 files (+6040).
- **Unified favorites** (`95379fb`) — Unicode + custom emojis in same data structure.
- **Unicode context menus** (`11c342e`) — Portal-based positioning prevents clipping.
- **Server icons in picker** (`dfcd60d`, `454e7de`, `f961aa6`) — Server icons in sidebar; standard categories to top; `shrink-0`.
- **Picker height fix** (`3d49b50`) — `h-[440px]` with `max-h-[60dvh]`.
- **Sticker upload** (`c1af0ff`) — Enabled in migration script.
- **Bulk upload script** (`dc1cfa2`) — Upload from filesystem.
- **Rename UI** (`c795229`) — Admin rename + statistics dashboard.
- **@twemoji/api** (`5a06db1`) — Migrated; bot slash commands in DMs.

### Features — Chat & Messaging
- **Auto-pagination fix** (`dfd3cfc`) — `readyForPaginationRef` gates pagination; scroll-room check; synchronous SWR swap eliminates channel-switch flash.
- **ANSI code blocks** (`fa7d97a`) — Full parser: colors (16/bright/256/truecolor), styles (bold/dim/italic/underline/strikethrough).
- **Shift hover actions** (`d298c70`) — Inline buttons (copy, pin, delete) when Shift held. Resets on blur.
- **Keyboard shortcuts** (`dadc0bc`, `32c1fdf`) — Focus composer, search-channel/all, edit-last-message (ArrowUp), prevent duplicate sends.
- **QuickSwitcher** (`c1af0ff`) — Quick channel/server switcher.
- **Timeout system** (`40938b9`, `95b0639`, `a023658`) — Indicator, mod view, block sends, live countdown via `useTimeoutRemaining`.
- **Rich server tooltips** (`b33e287`) — Online/member counts, partnered badge.
- **Active Now sidebar** (`e3a9ae2`, `589b584`) — Friends' activities; new message separator.
- **Server folders** (`9d2c133`) — Folders with lazy-loading emoji picker, DM unread rail.
- **dnd-kit DnD** (`03ee664`) — Friend/member context menus, improved discovery join.
- **Native DnD server folders** (`c169ffe`) — Tightened spacing, larger emoji/sticker limits.
- **Auto-hiding scrollbar** (`8a1ae34`) — Server rail; fixed role color handling.
- **Member sidebar spacing** (`98cdd77`) — `space-y-1` → direct `mt-1`.

### Features — CDN & Infrastructure
- **CDN URL normalization** (`f964947`) — `cdnImage()` across 40+ files.
- **Bun.serve** (`67688bb`) — From node:http + ws to Bun.serve with native WebSocket.
- **Next.js proxy fix** (`9207032`) — Preserve Host header, handle redirects.
- **PostgreSQL migration** (`250ab14`) — MongoDB → PostgreSQL with Drizzle ORM.
- **Real-time unread stream** (`e76afe2`) — Sidebar glow, mention badges.
- **Internal sync endpoints** (`5b90dd2`) — Service fallback for account connections.
- **Profile update endpoint** (`20e8d0c`) — Optimized UI state transitions.

### Features — Bot & Developer Platform
- **serika.js SDK rebrand** (`45c60ad`) — All docs: discord.js → @serikadev/serika.js.
- **Bot slash commands** (`4b9a4bb`, `113ae8e`, `d291848`, `075e882`, `19ee32d`) — Invoke, server-side dispatch, gateway dispatch, multi-bot, interaction persistence, public /me + /shrug.
- **Bot gateway reliability** (`690fddd`, `a82d0e5`, `7c2e9cb`, `5f8cfe5`) — Hardened gateway, identify crash fix, Invalid Date, ephemeral messages, callback endpoint, nginx route.
- **Bot settings redesign** (`5fce84a`) — Card-based layout.
- **Bot API validation** (`5b565df`) — Validate message belongs to channel.
- **Bot presence** (`735f932`) — Mark bots online via gateway.
- **Discord bot bridge** (`e0d5881`) — Bridge, Fish Audio TTS, premium file limits.
- **isBot/isVerified** (`1dc2b32`) — Badge display in DM sidebar.
- **Developer portal redesign** (`37ef759`) — Glassmorphic UI, DiceBear avatars.
- **OAuth2 flow** (`1d80911`) — New pages, middleware, API.
- **Automatic bot provisioning** (`3533010`) — DiceBear avatars, blockquote/small text.
- **Per-user experiment management** (`dacc470`) — Include/exclude controls, API, admin UI.
- **Fast native-glyph emoji picker** (`97d7ea6`) — Deferred search filtering experiment.

### Features — i18n
- **gt-next i18n** (`a164d92`) — Translated strings across auth, legal, home.
- **Translation management UI** (`a57ff60`) — Crowd-sourcing, npm scripts.
- **LocaleSync** (`19d4981`) — Automatic locale sync in root layout.
- **Locale reconfiguration** (`3c668ca`, `a664210`) — Removed then re-added 11 locales.
- **gt-next server-side fix** (`177c678`) — Compile-time transform eliminates runtime hashing.
- **Domain redirect** (`435e7c3`) — serika.cc → FRONTEND_URL.

### Features — UI/UX
- **Explore page theming** (`f645426`) — Single `ACCENT` variable; ServerCard CSS custom properties; mobile underline tabs.
- **Theme-aware text selection** (`dbbb4ad`).
- **ChannelSettingsDialog redesign** (`e32a82f`) — Improved navigation, Escape handling.
- **Logo redesign** (`9c6e3ff`) — Custom mascot, reusable Logo/Loader.
- **MessageGroup optimization** (`c1273ce`) — Custom memo equality + pre-computed timestamps.
- **Chat translations hoisted** (`8a62490`) — Single provider fixes long-history lag.
- **Invite error detection** (`ba3889f`) — Better server API error parsing.
- **isMember check on invites** (`d5b240c`) — Live DM list updates.
- **Context menu positioning** (`cb20b88`) — Fixed with useLayoutEffect.
- **Mobile scroll gesture fix** (`6d83b78`) — Prevent popup during scroll.
- **Drag event bubbling fix** (`3814737`) — Prevent nested folder drag conflicts.

### Performance
- **Message cache persistence** (`873d569`) — Broaden preload, prefetch on server hover.
- **Stale-channel race** (`80af6a9`) — Eliminate duplicate member fetches on server switch.
- **Delta fetch** (`790b6aa`) — Revalidate with delta instead of full page.
- **SSE no-transform** (`7e7460b`) — Stop proxy buffering.
- **Scroll-up pagination** (`44012e6`) — Fix when painting from short cached tail.

### Bug Fixes (Critical)
- **12 silent filter-drop bugs** (`0046f4d`) — Patched findOne/find whitelists across models.
- **DMs crash** (`87ba08d`) — ChannelSidebar used useUnread outside UnreadProvider.
- **Message.findOne filters ignored** (`c68ff7a`) — id/isDeleted dropped, breaking delete/edit/pin/reactions.
- **Deployment OOM** (`8ff56c2`) — Ignore build errors in Next.js config.
- **User staff status** (`b10446e`) — Standardized ID field, corrected auth verification.
- **TypeScript build errors** (`3702bb2`) — isBot/isSystem types, settings spread, blockDuration.
- **Custom emoji sizing** (`35d1ee2`) — Fixed sizing/detection, GIF wrapper constraints.
- **GIF favorite button** (`009e35d`) — Position fix.
- **Experiment identifiers** (`d5c93bc`) — `id` instead of `_id`.
- **sysinfo 0.30** (`448389b`) — Removed deprecated trait imports.
- **serika.moe lookup** (`91d3de9`) — Use accounts service ID.

### Documentation
- **README rewrite** (`e72b574`) — Full feature docs and deployment guide.
- **Security contact** (`582af5d`) — serika.chat → serika.dev.
- **Canary gateway** (`03509bf`) — Documented capi.serika.dev.

### Other
- 2 TTS sounds (`5097abf`). AuthProvider to root layout (`3c0da7d`). Legal pages refactor (`f01ae80`). PR review fixes (`20cfc0c`). Unused file cleanup (`fdbf06a`).

---

## v1.0.5 — 2026-07-07

**Tag:** `7c33663` — Server discovery, member applications, screen-share fix, cross-instance voice, Cloudflare TURN.

- Server discovery explore page with cards, category filtering, join flow.
- Member applications — submission and review system.
- Screen-share fix for voice channels.
- Cross-instance voice support.
- Cloudflare TURN relay for NAT traversal.
- Mobile voice UI optimizations, noise suppression toggle (`3555f09`).
- SSE fast-path to bypass Next.js buffering (`1c4c60a`).

---

## v1.0.4 — 2026-07-07

**Tag:** `d5b9420` — Tauri auto-updater, signed desktop builds.

- Tauri auto-updater for desktop app.
- Signed desktop builds (exe/msi/dmg/AppImage).
- Version bumps across desktop and mobile.

---

## v1.0.3 — 2026-07-07

**Tag:** `02910f2` — File picker uses platform allowlist/default.

- File picker now uses platform-specific allowlist/default extensions.
- Version bumps.

---

## v1.0.2 — 2026-07-07

**Tag:** `d5b7381` — Multi-status rich presence, more detected apps, profile card fixes.

- Multi-status rich presence display.
- More detected desktop apps for activity.
- Profile card layout fixes.
- British English "colour" standardization, HTML entity decoding (`692c860`).
- Auth context refresh on mobile settings load (`d54ac49`).
- Member status indicator colors matching Discord palette (`802b506`).
- Invite page redesign with full-bleed banner (`97ba47e`).
- SEO metadata on auth/legal pages (`4b0dc26`).
- Mobile profile view overflow fix, full-height member popups (`cfc5432`).
- IGDB rich-presence proxy, desktop process detection (`fec8a89`).
- GPG signing for Linux AppImage builds (`5fb5af0`).
- Mobile member list drawer, nameplate customization (`4b33a0b`).
- Gradient color picker UI redesign (`c2f4fb8`).
- sysinfo 0.30 trait import fix (`448389b`).

---

## v1.0.1 — 2026-07-07

**Tag:** `fec8a89` — IGDB rich-presence proxy, desktop process detection.

- IGDB rich-presence proxy for game activity.
- Desktop process detection for activity status.
- Version bump to 1.0.1.

---

## v1.0.0 — 2026-07-05

**Tag:** `8e6641c` — First major release. Desktop via Tauri, signed Android APK, mobile static export.

### Features

- **Desktop app** — Tauri build (exe/msi/dmg/AppImage) with GPG signing.
- **Android APK** — Signed Android build via GitHub Actions.
- **Mobile static export** — Static export build for mobile.
- **P2P voice channels** (`42a260c`, `1112c69`) — Full WebRTC voice with video grid, screen sharing, speaking indicators, persistent connection state.
- **Soundboard** (`1112c69`) — Server-specific sounds, voice UI with participant previews, fullscreen screen sharing.
- **File uploads** — 500MB limit, Permissions-Policy for camera/display-capture.
- **DM features** (`9ca0537`) — Reactions, editing, deletion, pinning, reply, swipeable actions, context menus, emoji picker, real-time SSE.
- **Role colors** (`c95b80c`) — Role colors, DM sorting, mention fixes, profile widget improvements.
- **System users** (`9cb4593`, `08ebb2a`, `81af23b`, `306bebe`) — SystemPill component, isSystem field, Serika broadcast user, disabled message input for system users.
- **Global announcement banner** (`31bfafe`) — Admin management UI, improved admin panels.
- **Owner crown icon** (`2ca2bc1`) — Redesigned admin user management with badge toggle UI.
- **Server badges** (`cb721f1`) — iconOnly prop, displayed across invite/explore/widgets/embeds/sidebar/profiles.
- **GIF picker redesign** (`2c854f5`) — Tag-first UI, hover previews, removed HypeSquad badges.
- **DM chat refactor** (`43b4b38`) — Shared useChatSession hook, improved channel switching, mobile layout fix.
- **serika.moe presence** (`285445b`) — Live "now watching on serika.moe" in profiles and member list.
- **Display name customization** (`438738a`) — Member list, DM pages, message headers.
- **Fade-in animations** (`b618fc4`) — GIF picker items, initial chat message batch.
- **MessageList scroll optimization** (`1bc0c01`) — Collection endpoint for GIF picker.
- **GIF favorites** (`bd2eeb4`) — Rich metadata objects with backend sync.
- **GIF picker tag loading** (`fd56723`) — Client-side pagination, lazy preview fetching.
- **Display name style redesign** (`fda8b25`) — Visual color picker UI.
- **Profile images/video grids** (`3eb53b8`) — Markdown rendering in profiles, inline status editor.
- **Friends page redesign** (`51b653d`) — Modern card layout, hide members sidebar on mobile.
- **Self-describing API** (`b1c014f`, `4652e15`) — Helpful 404s, friendly API index at /api/v10.
- **Bot gateway** (`4711609`) — Discord-compatible bot gateway, interactions, docs overhaul.
- **Slash command autocomplete** (`c23f746`) — NSFW gate persistence, font rendering improvements.
- **NSFW channel gate** (`ad95f48`) — Interactive audio trimmer, optimized channel/member loading.
- **Countdown timestamps** (`97b84e5`) — Customizable end text and color options.
- **Real-time analytics** (`9f28be7`) — Bot enablement flow to developer dashboard.
- **Forum channels** (`d0348ac`) — Posts/tickets mode, thread support, full UI integration.
- **Mobile settings** (`7e8d5bd`) — Profile and Connections pages with full customization.
- **OAuth consolidation** (`7d7a378`) — Unified /:provider/initiate and /:provider/callback.
- **Last.fm integration** (`af0e3a4`, `a12cdf0`) — OAuth, redesigned Connections tab, provider icons.
- **TTS messages** (`542057d`) — Announcement channel UI, friends list redesign, emoji autocomplete, desktop notifications.
- **Channel settings** (`2122da0`, `5d48281`, `e207078`) — Integrations, invites, advanced permissions, fullscreen, GIF banner support, file type safety.
- **File type whitelist** (`3db653d`) — Admin controls with custom MIME type management.
- **Channel count limits** (`49a2180`).
- **Channel DnD reordering** (`4d3875c`).
- **Timezone display** (`10b1f18`) — Privacy toggle.
- **Music activity** (`7c1a5c8`) — Last.fm cover art fallback, custom status clearing fix.
- **Nameplate decorations** (`7766b42`, `8be3a0e`, `459eb06`, `988bea9`) — Segmented type selector, custom gradient pickers, enhanced profile accent styling.
- **Channel sidebar** (`cdf3d34`) — Widened, fixed text overflow, prevented profile dialog unmount.
- **Admin toggle for connections** (`e15e7b2`) — Auto-format text channel names, category name truncation.
- **Message header refinements** (`1c03575`, `25a1e59`, `f3bcb40`) — Font size, weight, truncation.
- **Channel permissions UI** (`6d83b69`).
- **DM profile sidebar** (`e9918c3`) — Server nicknames in chat, broadcast fix.
- **SWR message cache** (`bf23528`) — Instant chat via SWR, faster app-shell first paint.
- **Custom emoji in messages** (`8f52d5e`) — Parse and include in channel/pinned/DM responses.
- **Auth UI** (`21413a2`) — Glassmorphic design, notification system with unread badges and toasts.
- **Custom emoji parsing** (`00a966d`) — Backend and frontend.
- **Twemoji picker** (`def417f`) — Custom emoji picker with server emoji support.
- **YouTube embeds** (`dcbe8ea`).
- **Virtualized message list** (`4844053`) — react-virtuoso for performance.
- **Skeleton loading** (`c19af42`) — Chat and sidebar areas.
- **GIF picker** (`d9d0f55`) — Component and image lightbox; DM channel deduplication.
- **Mobile header/drawer** (`f98cd52`) — Account settings page, notification service.
- **Real-time messaging** (`105a1ff`) — SSE, improved user profile UI.
- **Server dropdown** (`cbd0a38`) — Wired up buttons, channel context menu.

### Bug Fixes
- **isIOS hook** (`d9a9efc`) — Moved above early return in ChannelSidebar (React #310).
- **Guest favorites loading** (`5f94cc5`) — Deferred to avoid synchronous setState.
- **Mobile messages JSX** (`000ad28`) — Parse error for production build.
- **DM duplicate key warnings** (`725c769`) — Improved auto-scroll.
- **.equals() errors** (`7529c2f`) — When user data from cache.
- **Broadcast DM sending** (`fe21764`) — Convert system user ID to ObjectId.
- **DM button** (`256e903`) — Use userId instead of membership ID.
- **Docker build** (`23a1b35`) — Replace @emoji-mart/react with emoji-picker-react for React 19.
- **MongoDB displayName conflict** (`d8bdbfa`) — Email-only login fix.
- **Session deletion** (`4a3222f`) — Optional chaining.
- **Missing member id/displayName** (`d024e71`) — In MemberSidebar.
- **Build errors/route conflicts** (`59556f7`).
- **Android build** (`32a646d`) — Project config, GitHub Actions.
- **TypeScript build** (`a1b6637`) — Exclude mobile/desktop folders.
- **Desktop build** (`06c33c9`, `5bd14da`, `21f5c79`) — Repository field, icon requirements, npm cache.
- **Icon files** (`33fc3db`, `a77d583`) — Proper ICO/PNG with Serika branding.

### Infrastructure
- **Android Gradle/Java fixes** (`faaa30c`, `1803ef1`, `a76fdf1`, `9af59b1`, `c1cecd0`, `469f4a0`, `5ee11c5`, `570c0f2`, `4ef8861`, `eeef064`, `fe8b48c`, `f0f21a0`, `8c2c1ab`) — Java 17/21 compatibility, Gradle 8.7/8.11.1, AGP 8.9.1, compileSdk 35/36, minSdkVersion 23, Node.js 22.
- **Tauri serde_json** (`3194348`) — Added required dependency.
- **Domain redirect** (`cefee13`) — Non-serika.chat domains redirected.
- **serika-accounts bumps** (`0a49269`, `18e1a67`, `7a0ff30`, `8c4812a`, `7186306`) — OAuth consent, profile-picker, /me link fields.

### Performance
- **Instant chat** (`bf23528`) — SWR message cache, faster first paint.
- **MessageList scroll** (`1bc0c01`).
- **Member list re-rendering** (`988bea9`).

---

## Pre-v1.0.0 — Feb 2026

**Commits:** Feb 10 – Feb 13, 2026 · Between v0.0.3 and v1.0.0 development.

### Features
- **Role permission system** (`5d716f5`) — Bitfield-based permissions, user and role mentions in chat.
- **Image gallery lightbox** (`bcda23f`) — Navigation, centralized chat media handling.
- **Dynamic theming** (`926e025`) — CSS variables, theme setting validation, hardcoded token check script.
- **Theme context** (`539dce3`) — Apply user settings patches for appearance/accessibility.
- **GIF service** (`01b0968`, `526ddb9`, `1d2180b`, `b7e155f`) — Serika GIF service replacing Tenor, dedicated GifPicker component, oEmbed optimization, pagination for collections/tags.
- **Voice chat API** (`91151ae`) — Server stickers, advanced server settings, new user/server models.
- **Realtime chat UX** (`71c0cf3`, `cc175df`) — Upgraded UX, stabilized channel navigation, improved loading states.
- **Virtualized message list** (`4844053`) — react-virtuoso.
- **Mobile experience** (`f98cd52`) — New header, drawer, account settings, notification service.
- **Skeleton loading** (`c19af42`).
- **GIF picker + lightbox** (`d9d0f55`) — DM channel deduplication.
- **Custom emoji parsing** (`00a966d`) — Backend and frontend.
- **Twemoji picker** (`def417f`) — Server emoji support.
- **YouTube embeds** (`dcbe8ea`).

### Bug Fixes
- **MemberProfilePopup nullability** (`467e9f1`) — TypeScript typing fix.
- **Referenced message type** (`604de53`) — Type narrowing in channel API.
- **TypeScript target** (`14e1a5b`) — ES2020 for bigint permissions.
- **Mention suggestion logic** (`84f60f6`) — Separated static definition from filtering.
- **Mobile messages JSX** (`000ad28`) — Production build parse error.
- **DM duplicate key warnings** (`725c769`).
- **.equals() errors** (`7529c2f`) — Cache user data.
- **Broadcast DM sending** (`fe21764`) — ObjectId conversion.
- **DM button** (`256e903`) — userId vs membership ID.
- **Docker build** (`23a1b35`) — React 19 compatibility.
- **Emoji sizing** (`dcbe8ea`) — React key warning.

### Chores
- **Bun migration** (`900a971`) — Package management + core dependency updates.

---

## v0.0.3 — 2026-01-23

**Tag:** `b1c5cb0`

### Features
- Server dropdown buttons wired up, channel context menu (`cbd0a38`).
- Real-time messaging via SSE, improved user profile UI (`105a1ff`).
- Android APK build configuration (`9475485`).

### Bug Fixes
- Missing API endpoints, mobile UI improvements (`a37f8eb`).
- Android project config, GitHub Actions build (`32a646d`).
- Exclude mobile/desktop from TypeScript build (`a1b6637`).

---

## v0.0.2 — 2026-01-23

**Tag:** `9410958` — Server settings, member profiles, status fix, UI improvements.

### Features
- Discord-style mobile UI with bottom navigation (`e6f7f70`).
- Mobile/desktop app pages, member sidebar fix (`8ed2464`).
- Major UI improvements and bug fixes (`470b9a7`).

### Bug Fixes
- Channel creation API route (NOT_FOUND error) (`413fe3e`).
- Voice channels category and general voice on server creation (`413fe3e`).
- Settings scrollbar (`413fe3e`).
- Desktop build: repository field, disable publish/updates (`06c33c9`).
- Icon.ico multi-size ICO with 256x256 (`33fc3db`).
- Icon.png proper PNG with Serika branding (`a77d583`).
- serika.dev favicon as app icons (`2cd45ef`).
- Desktop build: remove icon requirements, disable auto-publish (`5bd14da`).
- GitHub Actions: remove npm cache dependency (`21f5c79`).
- Missing member id/displayName in MemberSidebar (`d024e71`).
- Build errors and route conflicts (`59556f7`).

### Other
- SerikaCord Developer badge (highest priority) (`413fe3e`).
- Admin panel in settings for staff users (`413fe3e`).
- Desktop/mobile apps skip homepage, go to /channels/me (`413fe3e`).
- Desktop app: improved update checking from GitHub releases (`413fe3e`).
- Native desktop (Electron) and mobile (Capacitor) apps with GitHub Actions (`b5fc733`).

---

## v0.0.1 — 2026-01-22

**Tag:** `413fe3e` — Initial release.

### Features
- **Standalone SerikaCord** (`7a9a08c`) — Integrated authentication.
- **Discord-like frontend UI** (`ffbb4e4`) — Built with shadcn.
- **Discord-style @me URL** (`f063374`) — URL with rewrite.
- **Pfp/banner upload** (`ccacb7f`) — Upload endpoints to accounts.
- **Black/purple theme** (`8192a1d`) — Theme overhaul + accounts API auth proxy.
- **Mobile responsiveness** (`990b3bb`) — User profile popup, settings, DM support.
- **Comprehensive README** (`1a41091`).
- **serika-accounts** (`03ca353`) — Preserved with enhanced security.

### Bug Fixes
- **MongoDB displayName conflict** (`d8bdbfa`) — Email-only login.
- **Session deletion** (`4a3222f`) — Optional chaining.

### Chores
- serika-accounts submodule updates (`b020d01`, `bb58318`, `bdb184f`).

---

## Initial Commit

`477a2e7` — 2026-01-22 10:37:42 +0100 — Initial commit.

---

## Bug Issues Fixed (Complete Index)

| # | Bug | Commit | Severity |
|---|---|---|---|
| 1 | XSS vulnerability — user content not sanitized | `876357a` | Critical |
| 2 | Internal-route auth bypass | `7bff928` | Critical |
| 3 | Cross-account message cache leakage | `f11b45f` | High |
| 4 | Message.findOne ignored id/isDeleted filters | `c68ff7a` | High |
| 5 | 12 silent filter-drop bugs across models | `0046f4d` | High |
| 6 | SEND_MESSAGES overwrites not enforced | `a023658` | High |
| 7 | No spam protection (duplicate messages) | `3c89f69` | High |
| 8 | Auto-pagination on channel open | `dfd3cfc` | High |
| 9 | Deployment OOM crash | `8ff56c2` | High |
| 10 | Gateway identify crash on Postgres DM lookup | `a82d0e5` | High |
| 11 | DMs crash — useUnread outside UnreadProvider | `87ba08d` | High |
| 12 | Bot Invalid Date / ephemeral messages | `7c2e9cb` | Medium |
| 13 | Channel-switch flash of previous messages | `dfd3cfc` | Medium |
| 14 | Inconsistent CDN URL handling (broken images) | `f964947` | Medium |
| 15 | Bug report form buttons disappeared when open | `ba3889f` | Medium |
| 16 | No keyboard Escape for bug report form | `ba3889f` | Medium |
| 17 | Invite dialog failed to surface errors | `ba3889f` | Medium |
| 18 | Only bug reports, no feedback submission | `a203261` | Medium |
| 19 | Emoji favorites only for custom emojis | `95379fb` | Medium |
| 20 | Context menus clipped by parent containers | `11c342e` | Medium |
| 21 | Custom status not displaying in sidebar | `32c1fdf` | Medium |
| 22 | Explore page hardcoded colors vs theme | `f645426` | Medium |
| 23 | No per-user experiment management UI | `dacc470` | Medium |
| 24 | Emoji upload script wrong server ID | `f961aa6` | Medium |
| 25 | Emoji picker sidebar overflow | `3d49b50` | Medium |
| 26 | Timeout countdown static, not live | `a023658` | Medium |
| 27 | ANSI code blocks as plain text | `fa7d97a` | Medium |
| 28 | No bug report system existed | `fa7d97a` | Medium |
| 29 | File uploads click-only (no drag-and-drop) | `be72d0d` | Medium |
| 30 | No search/filter for bug reports | `be72d0d` | Medium |
| 31 | Stale-channel race on server switch | `80af6a9` | Medium |
| 32 | Profile update serialization field loss | `d54ac49` | Medium |
| 33 | Mobile profile view overflow | `cfc5432` | Medium |
| 34 | Member sidebar overflow | `988bea9` | Medium |
| 35 | Custom emoji sizing/detection | `35d1ee2` | Medium |
| 36 | User staff status logic / auth verification | `b10446e` | Medium |
| 37 | isIOS hook below early return (React #310) | `d9a9efc` | Medium |
| 38 | Guest favorites synchronous setState | `5f94cc5` | Medium |
| 39 | MongoDB displayName conflict + email-only login | `d8bdbfa` | Medium |
| 40 | Broadcast DM sending — ObjectId conversion | `fe21764` | Medium |
| 41 | DM button used membership ID instead of userId | `256e903` | Medium |
| 42 | Docker build — React 19 compatibility | `23a1b35` | Medium |
| 43 | sysinfo 0.30 deprecated trait imports | `448389b` | Medium |
| 44 | TypeScript build errors (isBot/isSystem) | `3702bb2` | Medium |
| 45 | Next.js proxy Host header not preserved | `9207032` | Medium |
| 46 | Bot API edit/delete — message not validated to channel | `5b565df` | Medium |
| 47 | Experiment identifiers used _id instead of id | `d5c93bc` | Medium |
| 48 | Scroll-up pagination from short cached tail | `44012e6` | Medium |
| 49 | Member sidebar spacing — nested space-y conflicts | `98cdd77` | Low |
| 50 | Shift key state stuck on window blur | `d298c70` | Low |
| 51 | ChannelSettingsDialog lacked Escape | `e32a82f` | Low |
| 52 | Standard Unicode emojis had no context menu | `11c342e` | Low |
| 53 | Standard emoji categories below server categories | `f961aa6` | Low |
| 54 | Category icon buttons compressed by flex | `f961aa6` | Low |
| 55 | Mobile category pills inconsistent with desktop | `f645426` | Low |
| 56 | Advanced bug fields always visible | `be72d0d` | Low |
| 57 | Developer docs referenced discord.js | `45c60ad` | Low |
| 58 | Message actions required multiple clicks | `d298c70` | Low |
| 59 | No keyboard shortcuts for search/edit | `32c1fdf` | Low |
| 60 | Short channels triggered unnecessary pagination | `dfd3cfc` | Low |
| 61 | GIF favorite button positioning | `009e35d` | Low |
| 62 | serika.moe lookup used username instead of ID | `91d3de9` | Low |
| 63 | Mobile scroll gesture opens profile popup | `6d83b78` | Low |
| 64 | Drag event bubbling in server sidebar | `3814737` | Low |
| 65 | SSE proxy buffering | `7e7460b` | Low |
| 66 | Mobile messages JSX parse error (prod build) | `000ad28` | Low |
| 67 | DM duplicate key warnings | `725c769` | Low |
| 68 | .equals() errors from cached user data | `7529c2f` | Low |
| 69 | Session deletion optional chaining | `4a3222f` | Low |
| 70 | Missing member id/displayName in MemberSidebar | `d024e71` | Low |
| 71 | Build errors and route conflicts | `59556f7` | Low |
| 72 | Android project config / GitHub Actions | `32a646d` | Low |
| 73 | TypeScript build — mobile/desktop folders | `a1b6637` | Low |
| 74 | Desktop build — repository field | `06c33c9` | Low |
| 75 | Desktop build — icon requirements | `5bd14da` | Low |
| 76 | GitHub Actions — npm cache dependency | `21f5c79` | Low |
| 77 | Icon.ico not multi-size | `33fc3db` | Low |
| 78 | Icon.png not proper PNG | `a77d583` | Low |
| 79 | MemberProfilePopup member nullability typing | `467e9f1` | Low |
| 80 | Referenced message type narrowing | `604de53` | Low |
| 81 | TypeScript target ES2020 for bigint | `14e1a5b` | Low |
| 82 | Mention suggestion logic separation | `84f60f6` | Low |
| 83 | Emoji sizing / React key warning | `dcbe8ea` | Low |
| 84 | Unused file and references | `fdbf06a` | Low |
| 85 | PR review issues | `20cfc0c` | Low |
| 86 | Bot slash commands client-side interception | `d291848` | Low |
| 87 | Gateway drop troubleshooting | `5f8cfe5` | Low |
| 88 | Non-serika.chat domain redirect | `cefee13` | Low |
| 89 | Tauri missing serde_json dependency | `3194348` | Low |
| 90 | Java/Gradle/Android SDK compatibility (multiple) | `faaa30c`–`f0f21a0` | Low |

---

## Statistics

- **Total commits:** 293
- **Date range:** Jan 22 – Jul 16, 2026
- **Releases:** v0.0.1, v0.0.2, v0.0.3, v1.0.0, v1.0.1, v1.0.2, v1.0.3, v1.0.4, v1.0.5 + unreleased
- **Critical bugs fixed:** 2 (XSS, auth bypass)
- **High-severity bugs fixed:** 9
- **Medium-severity bugs fixed:** 33
- **Low-severity bugs fixed:** 46
- **Total bugs catalogued:** 90
