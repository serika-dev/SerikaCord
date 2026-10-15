# Staff roles and changelog publishing

Apply `drizzle/manual_staff_roles.sql` and
`drizzle/manual_changelog_announcements.sql` manually before using the new
tools. Both files only create tables/indexes if missing. The application never
applies them automatically. Existing administrator access remains available
before the staff migration; the new editors return a setup error until their
tables exist.

## Staff access

In User Settings → Staff Roles, create named roles, choose permissions, then
use Members to find an account and assign one or more roles. Presets provide
starting points for support, moderation, release editors, and publishers.
Permissions combine across roles. Removing all assignments removes delegated
admin access. A role must be unassigned before deletion.

User lookup (`users.view`) is separate from moderation (`users.moderate`) and
badge management (`badges.manage`); give staff both lookup and the actions they
need. Server lookup (`servers.view`) is similarly separate from destructive
server management (`servers.manage`). Banner announcements require
`settings.manage`; sending their content as system DMs requires
`broadcast.send`. The announcements screen performs only the operations the
actor is allowed to perform.

Message reports (Trust & Safety → Reports) need `reports.review`: it shows
reported messages (including the disclosed plaintext of reported end-to-end
encrypted messages, never the rest of the conversation) and allows dismiss,
resolve, reopen, staff notes and deleting the reported message. Strikes, chat
restrictions and suspensions from a report also need `safety.review`. Staff
with only `reports.review` see the Reports tab alone. The Moderator preset
includes `reports.review`; the Trust & Safety preset adds `safety.review`.

Custom managers need `staff.manage`. They may only create/edit roles and
assign members whose permissions are within their own access. They cannot
edit roles assigned to themselves, change their own assignments, or manage
legacy administrator access. Existing `isStaff && staffRole === 'admin'`,
`admin`, and `serikacord_developer` identities retain administrator access.
Only these administrators may change privileged badges; they cannot remove
their own final source of administrator access. Ordinary staff/moderator
badges alone do not grant admin tools.

`staff_roles` and `staff_role_assignments` persist configuration separately
from server roles and user settings. Every admin route checks fresh grants
through `getStaffAuth`; no JWT or client permission list is authoritative.
Role mutations serialize with a transaction-scoped advisory lock, recheck
access inside the transaction, and write audit records. Changes fan out
`staff_access_changed` through the activity stream so open settings refresh.

## Changelogs

In User Settings → Changelog Popups, create a draft with a title, optional
version, and Markdown body. Preview uses the same dialog readers see. Save
the draft, then publish it when ready. Published content is immutable until
withdrawn; updating it requires another publish action.

- `changelog.manage` permits drafting and editing.
- `changelog.publish` permits publication/withdrawal. It can review existing
  drafts without editing them.
- Either capability permits reading the admin changelog list.

The channel/DM app shell loads `/api/changelogs` through `sharedGet` and
BootPrefetch. Only the latest published entry opens automatically; the
latest 50 published entries remain available through What's new in settings.
Visible clients recheck on focus and every five minutes. New publication does
not send chat messages or DMs.

Closing the dialog records read receipts for entries viewed during that
session. Receipts are stored per account and entry, survive withdrawal and
republishing, and are shared across devices. Local storage retries failed
receipts and synchronizes dismissal across tabs. Publish a new entry when a
new popup is intended. A new account sees the latest release, without a queue
of older popups.

The feed excludes drafts/future publications and internal author identifiers.
Draft updates include an atomic unpublished predicate, so an edit cannot
modify already-published content during a concurrent publish request.
Read acknowledgments are idempotent and do not expose whether draft IDs exist.

## Verification

Pure tests in `tests/staff-permissions.test.ts` and
`tests/changelog-announcements.test.ts` cover delegated authorization,
privileged badges, publication filtering, and read/history behavior. Use an
isolated test account and test server for live verification after applying
the migrations; never exercise publication or staff changes against real
users as a test.
