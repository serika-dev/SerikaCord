# App Privacy answers (App Store Connect → App Privacy)

Derived from the Privacy Policy (`src/app/(legal)/privacy/page.tsx`,
https://serika.chat/privacy) and the code. The iOS app is a shell around the
web app, so everything the web app collects counts. Answers are deliberately
conservative: when in doubt, the data type is declared.

Keep this file, the Privacy Policy and `mobile/ios/App/App/PrivacyInfo.xcprivacy`
in step.

## Top-level questions

| Question | Answer |
|---|---|
| Do you or your third-party partners collect data from this app? | **Yes** |
| Is any data used to track users (Apple's definition: linked with third-party data for ads, or shared with data brokers)? | **No**. No ads, no advertising SDKs, no IDFA, no data brokers (Privacy Policy: "we don't show ads, we don't use advertising trackers"). `NSPrivacyTracking = false`. |
| Third-party SDKs in the app | Firebase Cloud Messaging (push delivery only; Firebase ships its own privacy manifest). No analytics or crash SDKs. |

Purposes Apple offers: Third-Party Advertising, Developer's Advertising or
Marketing, Analytics, Product Personalization, App Functionality, Other.
**App Functionality** includes authentication, security and fraud prevention,
customer support and keeping the service running, which is what SerikaCord
uses data for.

## Data types

"Linked" = linked to the user's identity. Nothing is used for tracking.

| Category | Data type | Collected? | Linked? | Tracking? | Purposes | Why / source |
|---|---|---|---|---|---|---|
| Contact Info | Name | **Yes** | Yes | No | App Functionality | Username and display name (users may use their real name). Policy 2.1. |
| Contact Info | Email Address | **Yes** | Yes | No | App Functionality, Developer's Advertising or Marketing | Account email via Serika Accounts; service emails; marketing emails only with opt-in consent (Policy 4, "Marketing emails"). Drop the marketing purpose if Serika never sends product emails. |
| Contact Info | Phone Number | No | | | | Not asked. |
| Contact Info | Physical Address | No | | | | |
| Contact Info | Other User Contact Info | No | | | | |
| Health & Fitness | Health, Fitness | No | | | | |
| Financial Info | Payment Info | No | | | | The iOS app sells nothing; SerikaCord never receives card numbers (Policy 2.10). |
| Financial Info | Credit Info, Other Financial Info | No | | | | |
| Location | Precise Location | No | | | | No location APIs. |
| Location | Coarse Location | No | | | | IP addresses are kept in security logs (see Other Diagnostic Data) but never used to derive location. An optional timezone the user types into their profile isn't location data. |
| Sensitive Info | Sensitive Info | No | | | | Not asked for (Policy 5). Anything users choose to write is "User Content". |
| Contacts | Contacts | No | | | | No address book access. |
| User Content | Emails or Text Messages | **Yes** | Yes | No | App Functionality | Chat messages in servers, DMs and group DMs (Policy 2.3). E2EE DMs are stored only as ciphertext. |
| User Content | Photos or Videos | **Yes** | Yes | No | App Functionality | Uploaded images/videos, avatars, banners, emoji; images are hash-checked with PhotoDNA for safety (Policy 2.4, 7). |
| User Content | Audio Data | **Yes** | Yes | No | App Functionality | Audio files and voice messages users upload. Calls are never recorded (Policy 2.9); live call audio is relayed in real time only. |
| User Content | Gameplay Content | No | | | | |
| User Content | Customer Support | **Yes** | Yes | No | App Functionality | Bug reports (with any screenshots/logs the user attaches), support emails, content reports and appeals (Policy 2.11, 2.12). |
| User Content | Other User Content | **Yes** | Yes | No | App Functionality | Profile bio, pronouns, status, servers/channels/roles created, reactions, polls, onboarding answers, notes (Policy 2.2, 2.3). |
| Browsing History | Browsing History | No | | | | Link previews are fetched server-side; nothing about other sites is recorded. |
| Search History | Search History | No | | | | Message search queries are run and discarded (only rate-limit counters). |
| Identifiers | User ID | **Yes** | Yes | No | App Functionality | Account ID (Policy 2.1). |
| Identifiers | Device ID | **Yes** | Yes | No | App Functionality | Firebase Cloud Messaging push token per device (Policy 2.7). Not the advertising identifier. |
| Purchases | Purchase History | **Yes** | Yes | No | App Functionality | Serika+ subscription status, plan and dates received from SerikaPay for accounts that subscribed on the web (Policy 2.10). Nothing is sold in the iOS app. |
| Usage Data | Product Interaction | **Yes** | Yes | No | App Functionality | Read states (sync unread badges across devices), online status/presence, activity the user chooses to share, voice channel joins and call metadata (Policy 2.6, 2.7, 2.9). Not used for analytics. |
| Usage Data | Advertising Data | No | | | | No ads. |
| Usage Data | Other Usage Data | No | | | | Covered by Product Interaction. |
| Diagnostics | Crash Data | No | | | | No crash reporter (the old switches were removed; see CHANGELOG "Placebo data switches"). |
| Diagnostics | Performance Data | No | | | | |
| Diagnostics | Other Diagnostic Data | **Yes** | Yes | No | App Functionality | Security/request logs: IP address, user agent, device and app version, sign-in events, kept about 90 days for security and fixing errors (Policy 2.7, 2.8, 10). |
| Surroundings | Environment Scanning | No | | | | |
| Body | Hands, Head | No | | | | |
| Other Data | Other Data Types | **Yes** | Yes | No | App Functionality | Accounts the user chooses to connect (Spotify, Steam, GitHub, ...): their IDs, usernames and OAuth tokens; verified domains; Discord bridge data for users who consented (Policy 2.5, 2.13). |

## Summary as App Store Connect will show it

- **Data Used to Track You:** none.
- **Data Linked to You:** Contact Info (Name, Email Address), User Content
  (Emails or Text Messages, Photos or Videos, Audio Data, Customer Support,
  Other User Content), Identifiers (User ID, Device ID), Purchases (Purchase
  History), Usage Data (Product Interaction), Diagnostics (Other Diagnostic
  Data), Other Data.
- **Data Not Linked to You:** none.

## Notes for the owner

- If a crash reporter or analytics SDK is ever added, add Crash Data /
  Performance Data / Analytics here, in `PrivacyInfo.xcprivacy` and in the
  Privacy Policy before shipping.
- Privacy Policy URL: https://serika.chat/privacy. Account deletion: Settings →
  My Account → Delete Account (opens Serika Accounts).
