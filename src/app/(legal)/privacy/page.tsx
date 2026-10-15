import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Serika Company (Netherlands) processes personal data in SerikaCord under the GDPR: what we collect, why and on which legal basis, who receives it, how long we keep it, automated safety checks, cookies, and your rights.",
  path: "/privacy",
  keywords: [
    "SerikaCord privacy policy",
    "Serika privacy",
    "GDPR",
    "AVG",
    "data protection",
    "Autoriteit Persoonsgegevens",
    "data retention",
    "cookies",
    "your privacy rights",
  ],
});

const LINK = "text-[#8B5CF6] hover:underline";
const UL = "list-disc list-inside mt-2 space-y-1";

function Mail({ to }: { to: string }) {
  return (
    <a href={`mailto:${to}`} className={LINK}>
      {to}
    </a>
  );
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className={LINK} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-white text-xl font-semibold mb-3">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-white text-base font-semibold mb-2 mt-4">{children}</h3>;
}

function B({ children }: { children: React.ReactNode }) {
  return <strong className="text-white">{children}</strong>;
}

/** One purpose → data → legal basis entry in the processing overview. */
function Purpose({
  title,
  data,
  basis,
  labels,
}: {
  title: string;
  data: string;
  basis: string;
  labels: { data: string; basis: string };
}) {
  return (
    <li className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
      <p className="text-white font-medium">{title}</p>
      <p className="mt-1">
        <span className="text-white/80">{labels.data}</span> {data}
      </p>
      <p className="mt-1">
        <span className="text-white/80">{labels.basis}</span> {basis}
      </p>
    </li>
  );
}

export default async function PrivacyPage() {
  const gt = await getGT();

  const labels = { data: gt("Data:"), basis: gt("Legal basis:") };

  // ------------------------------------------------------------------
  // SIMPLE — plain-language summary
  // ------------------------------------------------------------------
  const simple = (
    <>
      <section>
        <H>{gt("Who is responsible")}</H>
        <p>
          <B>{gt("Serika Company")}</B>
          {gt(", established in the Netherlands, runs SerikaCord and is responsible for your personal data (the \"controller\"). Questions or requests:")}{" "}
          <Mail to="privacy@serika.dev" />.
        </p>
      </section>

      <section>
        <H>{gt("What we collect")}</H>
        <ul className={UL}>
          <li>{gt("Your account and profile: username, email, avatar, bio and similar. Sign-in and passwords are handled by Serika Accounts.")}</li>
          <li>{gt("What you send: messages, files, images, reactions and Servers you create. Messages are encrypted when stored.")}</li>
          <li>{gt("Accounts you choose to connect, like Spotify, Steam or GitHub, and your online status and \"now playing\" activity.")}</li>
          <li>{gt("Technical data: IP address, device, push notification tokens and security logs.")}</li>
          <li>{gt("Who was in a voice or video call and when. We never record calls.")}</li>
          <li>{gt("Payment records for Serika+ (handled by SerikaPay), support requests and bug reports, and safety records such as strikes and appeals.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("Why we use it")}</H>
        <ul className={UL}>
          <li>{gt("To run SerikaCord for you: deliver messages, calls, notifications and the features you use.")}</li>
          <li>{gt("To keep it safe: stop spam, scams, abuse and attacks, and enforce our rules.")}</li>
          <li>{gt("Because the law requires it: for example reporting child sexual abuse material and keeping tax records.")}</li>
          <li>{gt("With your permission: optional connections, push notifications and marketing emails. You can withdraw it at any time.")}</li>
        </ul>
        <p className="mt-3">
          {gt("We don't sell your data, we don't show ads, we don't use advertising trackers, and we don't use your private messages to train AI models.")}
        </p>
      </section>

      <section>
        <H>{gt("Automatic safety checks")}</H>
        <p>
          {gt("Every image you upload is automatically compared with known child sexual abuse material (via Microsoft PhotoDNA) and with known scam images. A match is blocked automatically and can lead to a restriction, a strike or a suspension. A person reviews it if you appeal from your Account Standing page.")}
        </p>
      </section>

      <section>
        <H>{gt("Who sees your data")}</H>
        <p>
          {gt("Other users see what you share with them. Server moderators see what happens in their Servers, and bots added to a Server can read the channels they have access to. We use service providers for hosting, file storage, email, push notifications and safety checks, some of them in the United States, with EU-approved safeguards. We share data with authorities only when the law requires it.")}
        </p>
      </section>

      <section>
        <H>{gt("How long we keep it")}</H>
        <ul className={UL}>
          <li>{gt("Account data: as long as you have an account.")}</li>
          <li>{gt("Things you delete: gone from our live systems within 30 days and from backups within 90 days.")}</li>
          <li>{gt("Security logs: about 90 days.")}</li>
          <li>{gt("Safety records: as long as the law requires, otherwise up to 2 years after your last strike expires.")}</li>
          <li>{gt("Payment and tax records: 7 years, as Dutch tax law requires.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("Your rights")}</H>
        <p>
          {gt("You can ask to see, correct, delete or download your data, limit or object to how we use it, and withdraw consent. Email")}{" "}
          <Mail to="privacy@serika.dev" />{" "}
          {gt("or use the options in the app. We answer within one month. You can also complain to the Dutch data protection authority (Autoriteit Persoonsgegevens) or the authority in your own EU country.")}
        </p>
      </section>

      <section>
        <H>{gt("Cookies")}</H>
        <p>
          {gt("We only use cookies and browser storage that SerikaCord needs to work: keeping you signed in, remembering your language and saving your preferences. No advertising or tracking cookies.")}
        </p>
      </section>

      <section>
        <H>{gt("Age")}</H>
        <p>{gt("SerikaCord is for people aged 16 and over. We delete accounts we learn belong to someone younger.")}</p>
      </section>

      <section>
        <H>{gt("Security and open source")}</H>
        <p>
          {gt("We encrypt data in transit and messages at rest, limit staff access to what their job requires, and will tell you and the authorities if a breach puts you at risk. SerikaCord's code is public on")}{" "}
          <Ext href="https://github.com/serika-dev/SerikaCord">GitHub</Ext>
          {gt(", so anyone can check how it works.")}
        </p>
      </section>

      <section>
        <H>{gt("Changes")}</H>
        <p>
          {gt("If we change this policy in an important way, we'll let you know by email or in the app before it takes effect.")}
        </p>
      </section>
    </>
  );

  // ------------------------------------------------------------------
  // LEGAL — full, authoritative version
  // ------------------------------------------------------------------
  const legal = (
    <>
      <section>
        <H>{gt("1. Controller and Scope")}</H>
        <p>
          {gt("This Privacy Policy (\"Policy\") explains how")}{" "}
          <B>{gt("Serika Company")}</B>{" "}
          {gt("(\"Serika\", \"we\", \"us\" or \"our\"), a company established in the Netherlands, processes personal data when you use SerikaCord at serika.chat, including its websites, desktop and mobile applications, voice and video features, APIs, gateway, bots and webhooks (together, the \"Services\"). It is provided in accordance with Articles 13 and 14 of the General Data Protection Regulation (EU) 2016/679 (\"GDPR\") and the Dutch GDPR Implementation Act (Uitvoeringswet AVG).")}
        </p>
        <p className="mt-3">
          {gt("Serika Company is the controller of the personal data described in this Policy. You can contact us about privacy and data protection at")}{" "}
          <Mail to="privacy@serika.dev" />
          {gt(". Our company details (registered address and Chamber of Commerce number) are available on request at")}{" "}
          <Mail to="legal@serika.dev" />.
        </p>
        <p className="mt-3">
          {gt("Your sign-in identity, email address and password are managed by Serika Accounts (accounts.serika.dev), a separate Serika service; its own privacy information covers the processing it carries out. This Policy does not cover third-party services you choose to connect, or Bots and Servers operated by other users, who may act as independent controllers for their own use of your data (see section 7).")}
        </p>
      </section>

      <section>
        <H>{gt("2. Personal Data We Process")}</H>
        <H3>{gt("2.1 Account data")}</H3>
        <p>
          {gt("Your account identifier, email address, username, display name, account creation date, account status (such as verification, Serika+ status or suspension) and settings. Your password is managed by Serika Accounts and is only stored in hashed form. If you link a serika.moe account, we receive your serika.moe identifier and username.")}
        </p>
        <H3>{gt("2.2 Profile data")}</H3>
        <p>
          {gt("Optional information you add to your profile, such as avatar, banner, nameplate, biography, pronouns, custom status, badges, profile widgets and the connected accounts and verified domains you choose to display.")}
        </p>
        <H3>{gt("2.3 Content")}</H3>
        <p>
          {gt("Messages in Servers, DMs and group DMs (including edits, replies, pins, reactions, polls, forum posts and threads), attachments, images, audio, video, files, custom emoji and stickers, Servers, channels and roles you create, Server rules, and your answers to rules screening, onboarding questions and membership applications. Message content is encrypted at rest on our servers. To provide message search, we keep a search index of your messages derived from their content.")}
        </p>
        <H3>{gt("2.4 Media files")}</H3>
        <p>
          {gt("Files and images you upload, together with technical metadata such as file name, type and size. Media is stored with Backblaze B2 and delivered through our content delivery address cdn.serika.chat.")}
        </p>
        <H3>{gt("2.5 Connections and OAuth tokens")}</H3>
        <p>
          {gt("If you choose to link a third-party account (Discord, Spotify, Last.fm, Steam, GitHub, Twitch, YouTube, Twitter/X, Instagram, Roblox, Xbox, PlayStation or Battle.net), we receive the data you authorise through that provider, typically your account identifier, username and profile link, and, where needed to keep the connection working, access or refresh tokens. If you verify a website domain, we store the domain name and the verification record we asked you to add to its DNS.")}
        </p>
        <H3>{gt("2.6 Presence and activity")}</H3>
        <p>
          {gt("Your online status and custom status; activity you choose to share, such as music you are listening to via Spotify or Last.fm, what you are watching via serika.moe, rich presence from applications, and, if you enable it in the desktop app, games and applications it detects (stored as a private history that you can turn off and clear). We also record which voice channel you are in.")}
        </p>
        <H3>{gt("2.7 Device and notification data")}</H3>
        <p>
          {gt("Device type, operating system, app version, language, and push notification tokens for the devices on which you enable notifications. We also process read states (which messages you have read) to sync unread indicators across your devices.")}
        </p>
        <H3>{gt("2.8 Log, IP and security data")}</H3>
        <p>
          {gt("IP addresses, browser user agent, request logs and timestamps, session and authentication tokens, rate-limit counters, and records of security-relevant events, such as sign-ins and failed requests.")}
        </p>
        <H3>{gt("2.9 Voice and video metadata")}</H3>
        <p>
          {gt("Voice and video calls use WebRTC. We process call metadata such as which channel or call you joined, when, for how long, and your mute, camera and screen-share state. We do not record or store the audio or video of calls. Calls are usually connected directly between participants' devices (peer-to-peer) and are encrypted in transit; when a direct connection is not possible, the encrypted media is relayed through a relay (TURN) server. To set up a connection, your device exchanges network information, including IP addresses, with the other participants and with connection-assistance (STUN) servers.")}
        </p>
        <H3>{gt("2.10 Payment data")}</H3>
        <p>
          {gt("If you buy Serika+, the payment is processed by SerikaPay, Serika's payment service. SerikaCord receives the subscription status, plan, amounts, dates and transaction references. We do not receive or store full payment card numbers.")}
        </p>
        <H3>{gt("2.11 Support, bug reports and communications")}</H3>
        <p>
          {gt("Information you send when you contact us, submit a bug report (including any screenshots, logs or descriptions you attach), report content or users, or exercise your rights.")}
        </p>
        <H3>{gt("2.12 Trust and Safety records")}</H3>
        <p>
          {gt("Reports about you or made by you, Strikes, Restrictions, suspensions, statements of reasons, appeals and their outcomes, and safety incidents. When an uploaded image matches known child sexual abuse material or a known scam image, we record incident metadata such as the image's cryptographic hash, file name, type and size, the uploading account, the channel, the IP address, the time and, for PhotoDNA matches, the PhotoDNA tracking ID and match details. Images matching child sexual abuse material are never stored.")}
        </p>
        <H3>{gt("2.13 Discord bridge data")}</H3>
        <p>
          {gt("If a Server uses the Discord bridge and you have consented, we process your Discord username, avatar and the content of messages you send in bridged channels, solely to relay them (see section 6).")}
        </p>
        <H3>{gt("2.14 Developer data")}</H3>
        <p>
          {gt("If you are a Developer, the applications and Bots you create, their tokens and settings, webhooks, and API usage data.")}
        </p>
      </section>

      <section>
        <H>{gt("3. Sources of Personal Data")}</H>
        <ul className={UL}>
          <li><B>{gt("You:")}</B>{" "}{gt("when you create a profile, send content, change settings or contact us.")}</li>
          <li><B>{gt("Serika Accounts:")}</B>{" "}{gt("your account identifier, email address, username, hashed password and account status, when you sign in and when you change them there.")}</li>
          <li><B>{gt("Your devices:")}</B>{" "}{gt("technical, log and push notification data generated when you use the Services.")}</li>
          <li><B>{gt("Other users:")}</B>{" "}{gt("for example, when someone mentions you, adds you to a group DM, reports you, or when Moderators take action concerning you in their Server.")}</li>
          <li><B>{gt("Integrations you link:")}</B>{" "}{gt("the third-party services listed in section 2.5 and serika.moe, only with your authorisation, and Discord via the bridge, only with your consent.")}</li>
          <li><B>{gt("Safety providers:")}</B>{" "}{gt("match results from the Microsoft PhotoDNA Cloud Service.")}</li>
        </ul>
        <p className="mt-3">
          {gt("Providing account data is necessary to use the Services; without it we cannot create your account. Everything else (profile details, connections, activity sharing, notifications) is optional, although some features will not work without it.")}
        </p>
      </section>

      <section>
        <H>{gt("4. Purposes and Legal Bases")}</H>
        <p>{gt("We process personal data only for the following purposes and on the following legal bases under Article 6(1) GDPR:")}</p>
        <ul className="mt-3 space-y-3">
          <Purpose
            labels={labels}
            title={gt("Providing the Services")}
            data={gt("Account, profile, content, media, presence, device, read states, voice metadata, search index.")}
            basis={gt("Performance of our contract with you (Art. 6(1)(b)): creating your account, delivering messages and calls, storing your content, syncing across devices, search, and the Server features you use.")}
          />
          <Purpose
            labels={labels}
            title={gt("Serika+ and payments")}
            data={gt("Payment data, account data.")}
            basis={gt("Contract (Art. 6(1)(b)) to provide your subscription; legal obligation (Art. 6(1)(c)) to keep accounting and tax records.")}
          />
          <Purpose
            labels={labels}
            title={gt("Security and fraud and abuse prevention")}
            data={gt("Log, IP and security data, account data, rate-limit counters, content metadata.")}
            basis={gt("Legitimate interests (Art. 6(1)(f)): protecting our users, the Services and our infrastructure against unauthorised access, spam, scams, fraud and attacks. We limit this to what is needed and keep security logs only for a short period, so we consider that your interests do not override ours.")}
          />
          <Purpose
            labels={labels}
            title={gt("Automated image checks and Trust and Safety")}
            data={gt("Uploaded images, Trust and Safety records, incident metadata, reports and appeals.")}
            basis={gt("Legitimate interests (Art. 6(1)(f)) in preventing the spread of child sexual abuse material and scams and enforcing our Terms, which also protects other users and children; legal obligation (Art. 6(1)(c)) where the law requires us to report child sexual abuse material, preserve data, act on orders from authorities or comply with the Digital Services Act. Images are checked automatically and only matches are recorded.")}
          />
          <Purpose
            labels={labels}
            title={gt("Reporting and preserving data for authorities")}
            data={gt("CSAM incident metadata, account data, IP address, reports.")}
            basis={gt("Legal obligation (Art. 6(1)(c)) and, where no specific obligation applies, legitimate interests (Art. 6(1)(f)) in the protection of children and the prevention and prosecution of serious crime.")}
          />
          <Purpose
            labels={labels}
            title={gt("Optional integrations and activity sharing")}
            data={gt("Connection data and tokens, activity data, Discord bridge data.")}
            basis={gt("Consent (Art. 6(1)(a)), given when you link an account, enable activity sharing or consent to the Discord bridge. You can withdraw it at any time by unlinking the account or changing your settings.")}
          />
          <Purpose
            labels={labels}
            title={gt("Push notifications")}
            data={gt("Push notification tokens, notification content.")}
            basis={gt("Consent (Art. 6(1)(a)), given through your device's notification permission; you can withdraw it in your device or app settings.")}
          />
          <Purpose
            labels={labels}
            title={gt("Marketing emails")}
            data={gt("Email address, name.")}
            basis={gt("Consent (Art. 6(1)(a)). We only send marketing emails if you opt in, and every email lets you unsubscribe.")}
          />
          <Purpose
            labels={labels}
            title={gt("Service emails and notices")}
            data={gt("Email address, account data.")}
            basis={gt("Contract (Art. 6(1)(b)) and legal obligation (Art. 6(1)(c)), for example to notify you of changes to our Terms, statements of reasons or data breaches.")}
          />
          <Purpose
            labels={labels}
            title={gt("Support, bug reports and handling your requests")}
            data={gt("Support and bug report data, account data.")}
            basis={gt("Contract (Art. 6(1)(b)) to help you with the Services; legal obligation (Art. 6(1)(c)) to respond to requests exercising your GDPR rights.")}
          />
          <Purpose
            labels={labels}
            title={gt("Improving the Services")}
            data={gt("Aggregated or pseudonymised usage, performance and error data, and bug reports.")}
            basis={gt("Legitimate interests (Art. 6(1)(f)) in fixing bugs and improving the Services. We do not use your message content for this and do not use private messages to train AI models. You can object at any time.")}
          />
          <Purpose
            labels={labels}
            title={gt("Legal claims and compliance")}
            data={gt("Any data relevant to the specific claim or obligation.")}
            basis={gt("Legal obligation (Art. 6(1)(c)) and legitimate interests (Art. 6(1)(f)) in establishing, exercising or defending legal claims.")}
          />
        </ul>
        <p className="mt-3">
          {gt("Where we rely on legitimate interests, you can ask us for more information about the balancing test we carried out. We do not use your personal data for advertising, and we do not sell it.")}
        </p>
      </section>

      <section>
        <H>{gt("5. Special Categories of Data")}</H>
        <p>
          {gt("We do not ask for special categories of personal data (such as health, religious beliefs, political opinions or sexual orientation). If you include such information in your profile or content, we process it only to store and deliver it as you instruct, and we do not use it for profiling or any other purpose. Data relating to suspected criminal offences that we record in Trust and Safety incidents (Article 10 GDPR) is processed only to the extent permitted by EU or Dutch law, is accessible only to authorised Trust and Safety staff, and is shared only with competent authorities and reporting bodies as required by law.")}
        </p>
      </section>

      <section>
        <H>{gt("6. Discord Bridge")}</H>
        <p>
          {gt("Some Servers connect (\"bridge\") a Discord server to SerikaCord so messages can be mirrored between the two platforms. This feature is consent-based and complies with the Discord Developer Terms of Service and Developer Policy.")}
        </p>
        <H3>{gt("If you chat in Discord (inbound)")}</H3>
        <ul className={UL}>
          <li>{gt("We do not store or forward any of your messages until you explicitly agree. Our bot will DM you asking for consent.")}</li>
          <li>{gt("If you agree, we store only your Discord username, avatar, and the content of messages you send in bridged channels, solely to relay them to SerikaCord.")}</li>
          <li>{gt("If you decline (or never respond), your messages are never processed, and any data we hold for you is deleted. Server admins may optionally restrict unconsented members from chatting until they agree.")}</li>
          <li>{gt("You can withdraw consent at any time, after which we delete your bridged data.")}</li>
        </ul>
        <H3>{gt("If you chat in SerikaCord (outbound)")}</H3>
        <ul className={UL}>
          <li>{gt("Your messages are only sent to a bridged Discord server if you have enabled \"Allow data processing by Discord\" in Settings → Data & Privacy.")}</li>
          <li>{gt("If you have not enabled it, your messages are never synced to Discord.")}</li>
        </ul>
        <H3>{gt("Retention & deletion")}</H3>
        <p>
          {gt("We retain bridged Discord data only as long as necessary to provide the bridge. We delete it promptly when it is no longer necessary, when you or Discord request deletion, when a server disables the bridge, or when we stop operating the feature, consistent with Discord's Developer Terms of Service.")}
        </p>
      </section>

      <section>
        <H>{gt("7. Automated Decision-Making")}</H>
        <p>
          {gt("Every image uploaded to the Services is checked automatically before it is stored:")}
        </p>
        <ul className={UL}>
          <li>{gt("it is sent to the Microsoft PhotoDNA Cloud Service, which compares a digital fingerprint (hash) of the image with hashes of known child sexual abuse material; and")}</li>
          <li>{gt("we compute a perceptual hash of the image and compare it with a list of hashes of known scam images maintained by our Trust and Safety staff.")}</li>
        </ul>
        <p className="mt-3">
          {gt("These checks only recognise images that are identical or very similar to images already identified as abusive or fraudulent; they do not analyse what the image shows in any other way. If an image matches, the following happens automatically, without prior human review: for a child sexual abuse material match, the upload is blocked, the image is not stored, your account is suspended and an incident is recorded for review and reporting; for a scam-image match, the upload is blocked, your account receives a 24-hour chat restriction and a Strike. Five active Strikes lead to automatic suspension of the account. Images that cannot be safely processed may also be rejected.")}
        </p>
        <p className="mt-3">
          {gt("These decisions can significantly affect you, because they limit or suspend your use of the Services. We take them on the basis of Article 22(2)(a) GDPR, as they are necessary for the performance of our contract with you, which prohibits this content, and, for child sexual abuse material, also to comply with legal obligations where applicable (Article 22(2)(b)). You have the right to obtain human intervention, to express your point of view and to contest the decision: submit an appeal from your Account Standing page (a suspended account can still sign in to do so) or email privacy@serika.dev. Every appeal is reviewed by a member of our staff, and if the decision was wrong we reverse it. Apart from these checks, we do not take decisions about you based solely on automated processing that significantly affect you, and we do not use profiling for advertising.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Recipients of Your Data")}</H>
        <H3>{gt("8.1 Other users, Servers and Bots")}</H3>
        <p>
          {gt("Your username, display name, avatar, profile, status and activity you share are visible to other users according to your settings. Your content is visible to the people in the conversation, channel or Server where you post it. Server Owners and Moderators can see members' content in their Server, the answers you give to rules screening, onboarding questions and membership applications, and moderation actions in their audit log. Bots added to a Server can access the content and member data of the channels they are permitted to see; their Developers act as independent controllers and are responsible for their own privacy practices.")}
        </p>
        <H3>{gt("8.2 Service providers (processors)")}</H3>
        <p>{gt("We use the following providers, which process personal data on our behalf under data processing agreements and only on our instructions:")}</p>
        <ul className={UL}>
          <li><B>{gt("Hosting and databases:")}</B>{" "}{gt("our own servers, managed with Coolify, running PostgreSQL and Redis.")}</li>
          <li><B>{gt("Media storage and delivery:")}</B>{" "}{gt("Backblaze B2 (file storage), served via cdn.serika.chat, with image resizing and conversion through wsrv.nl.")}</li>
          <li><B>{gt("Email:")}</B>{" "}{gt("Amazon Simple Email Service (Amazon Web Services) for service emails.")}</li>
          <li><B>{gt("Push notifications:")}</B>{" "}{gt("Google Firebase Cloud Messaging.")}</li>
          <li><B>{gt("Child safety:")}</B>{" "}{gt("Microsoft PhotoDNA Cloud Service, for hash matching of uploaded images.")}</li>
          <li><B>{gt("Voice and video connectivity:")}</B>{" "}{gt("STUN and TURN servers that help devices establish and, where needed, relay encrypted call connections.")}</li>
          <li><B>{gt("Payments:")}</B>{" "}{gt("SerikaPay, Serika's payment service, and the payment providers it uses.")}</li>
          <li><B>{gt("Translations:")}</B>{" "}{gt("General Translation and Serika Translate, which translate the app's interface text. No personal data is sent to them.")}</li>
        </ul>
        <H3>{gt("8.3 Third parties you choose")}</H3>
        <p>
          {gt("When you link a third-party account or use the Discord bridge, data is exchanged with that provider at your request. Link previews are fetched by our servers, not by your device. Some embedded media from external websites (for example, videos) may be loaded directly from the third-party website, which then receives your IP address.")}
        </p>
        <H3>{gt("8.4 Authorities and legal requirements")}</H3>
        <p>
          {gt("We disclose personal data to law enforcement, courts, supervisory authorities or other competent authorities where we are legally required to do so, for example under a court order or an order under the Digital Services Act. We report child sexual abuse material incidents to the National Center for Missing and Exploited Children (NCMEC) and/or competent authorities as required by law. Where we become aware of information giving rise to a suspicion of a criminal offence involving a threat to the life or safety of persons, we inform the competent authorities. We may also share data with professional advisers (such as lawyers and accountants) bound by confidentiality.")}
        </p>
        <H3>{gt("8.5 Business transfers")}</H3>
        <p>
          {gt("If Serika is involved in a merger, acquisition, reorganisation or sale of assets, personal data may be transferred to the successor, which will remain bound by this Policy or inform you of any change.")}
        </p>
      </section>

      <section>
        <H>{gt("9. International Transfers")}</H>
        <p>
          {gt("Some of our providers are established in, or may access data from, countries outside the European Economic Area (EEA), in particular the United States (for example, Amazon Web Services, Google and Microsoft). Where personal data is transferred outside the EEA, we ensure an adequate level of protection, by relying on the European Commission's adequacy decision for the EU-US Data Privacy Framework where the recipient is certified under it, or otherwise on the European Commission's Standard Contractual Clauses (Article 46(2)(c) GDPR), together with additional safeguards where needed. Reports to NCMEC in the United States are made where required by law. You can request a copy of the relevant safeguards at privacy@serika.dev.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Retention")}</H>
        <p>{gt("We keep personal data only as long as necessary for the purposes for which it was collected:")}</p>
        <ul className={UL}>
          <li><B>{gt("Account and profile data:")}</B>{" "}{gt("for as long as your account exists.")}</li>
          <li><B>{gt("Content you delete:")}</B>{" "}{gt("removed from our live systems within 30 days, and from backups within 90 days.")}</li>
          <li><B>{gt("Content when you delete your account:")}</B>{" "}{gt("your account and profile are deleted; Servers you own pass to another member or, if none remain, are deleted with their content. Messages you sent in conversations or Servers with other people may remain visible to them as part of that conversation unless you delete them first or ask us to erase them.")}</li>
          <li><B>{gt("Connections and activity:")}</B>{" "}{gt("until you unlink the connection, turn off the feature or clear your activity history, or delete your account.")}</li>
          <li><B>{gt("Push notification tokens:")}</B>{" "}{gt("until you sign out, disable notifications or the token expires.")}</li>
          <li><B>{gt("Security logs and IP data:")}</B>{" "}{gt("approximately 90 days, unless needed longer to investigate a specific incident.")}</li>
          <li><B>{gt("Trust and Safety records, including child sexual abuse material incident metadata:")}</B>{" "}{gt("as long as legally required (for example, under data preservation obligations), and otherwise up to 2 years after your last Strike expires.")}</li>
          <li><B>{gt("Payment and tax records:")}</B>{" "}{gt("7 years, as required by Dutch tax law.")}</li>
          <li><B>{gt("Support requests and bug reports:")}</B>{" "}{gt("as long as needed to handle them and any follow-up.")}</li>
        </ul>
        <p className="mt-3">
          {gt("We may keep data longer where needed to establish, exercise or defend a legal claim, or where a competent authority orders us to preserve it.")}
        </p>
      </section>

      <section>
        <H>{gt("11. Your Rights")}</H>
        <p>{gt("Under the GDPR, you have the right to:")}</p>
        <ul className={UL}>
          <li><B>{gt("Access")}</B>{" "}{gt("(Art. 15): obtain confirmation of whether we process your data and a copy of it.")}</li>
          <li><B>{gt("Rectification")}</B>{" "}{gt("(Art. 16): have inaccurate data corrected or incomplete data completed. You can edit most profile data yourself.")}</li>
          <li><B>{gt("Erasure")}</B>{" "}{gt("(Art. 17): have your data deleted, unless we must keep it, for example for a legal obligation or a legal claim.")}</li>
          <li><B>{gt("Restriction")}</B>{" "}{gt("(Art. 18): have us restrict processing, for example while we verify a disputed matter.")}</li>
          <li><B>{gt("Data portability")}</B>{" "}{gt("(Art. 20): receive data you provided to us in a structured, commonly used, machine-readable format, or have it sent to another provider.")}</li>
          <li><B>{gt("Objection")}</B>{" "}{gt("(Art. 21): object at any time to processing based on legitimate interests, on grounds relating to your particular situation. We will then stop unless we have compelling legitimate grounds or need the data for legal claims. You can always object to direct marketing.")}</li>
          <li><B>{gt("Withdraw consent")}</B>{" "}{gt("(Art. 7(3)): at any time, without affecting the lawfulness of processing before the withdrawal.")}</li>
          <li><B>{gt("Human review")}</B>{" "}{gt("(Art. 22): of automated decisions, as described in section 7.")}</li>
        </ul>
        <p className="mt-3">
          {gt("How to exercise your rights: use the self-service options in the app where available (for example, editing your profile, deleting messages, unlinking connections, changing your Data & Privacy settings, or deleting your account through Serika Accounts), or email")}{" "}
          <Mail to="privacy@serika.dev" />
          {gt(". We respond within one month of receiving your request. If a request is complex or we receive many requests, we may extend this by up to two further months, and we will tell you why within the first month. Exercising your rights is free. We may ask you to confirm your identity, for example by sending the request from the email address linked to your account.")}
        </p>
        <p className="mt-3">
          {gt("Right to complain: you can lodge a complaint with the Dutch data protection authority, the Autoriteit Persoonsgegevens")}{" "}
          (<Ext href="https://autoriteitpersoonsgegevens.nl">autoriteitpersoonsgegevens.nl</Ext>)
          {gt(", or with the data protection authority in the EU country where you live or work, or where the alleged infringement took place. We would appreciate the chance to address your concern first.")}
        </p>
      </section>

      <section>
        <H>{gt("12. Cookies and Local Storage")}</H>
        <p>
          {gt("We only use cookies and similar technologies that are strictly necessary to provide the Services you request, or that store preferences you set. Under the ePrivacy rules (Article 5(3) of Directive 2002/58/EC and Article 11.7a of the Dutch Telecommunications Act), these do not require consent. We use:")}
        </p>
        <ul className={UL}>
          <li><B>{gt("Authentication cookies:")}</B>{" "}{gt("secure, HTTP-only cookies that keep you signed in, let you switch between saved accounts and protect the sign-in process.")}</li>
          <li><B>{gt("Locale cookie:")}</B>{" "}{gt("remembers your interface language.")}</li>
          <li><B>{gt("Local storage:")}</B>{" "}{gt("stores your preferences (such as theme, appearance and accessibility settings) and caches data on your device to make the app faster.")}</li>
        </ul>
        <p className="mt-3">
          {gt("We do not use third-party advertising or tracking cookies, and we do not use cookies to follow you across other websites. You can delete cookies and local storage in your browser settings, but you will then be signed out and your local preferences will be reset.")}
        </p>
      </section>

      <section>
        <H>{gt("13. Children")}</H>
        <p>
          {gt("The Services are only for people aged 16 and over, in every country. We do not knowingly collect personal data from children under 16. If we learn that an account belongs to someone under 16, we delete the account and its personal data, except for data we must keep by law. If you believe a child under 16 has an account, please contact privacy@serika.dev.")}
        </p>
      </section>

      <section>
        <H>{gt("14. Security")}</H>
        <p>
          {gt("We take appropriate technical and organisational measures to protect personal data (Article 32 GDPR), including encryption in transit (TLS), encryption at rest of message content, hashed passwords, access controls, rate limiting, and staff access based on the principle of least privilege, so that staff can only access the personal data they need for their role. Message encryption at rest is not end-to-end encryption: our systems decrypt messages to deliver them, and authorised staff may access content when necessary to investigate reports, handle appeals, comply with the law or keep the Services secure.")}
        </p>
        <p className="mt-3">
          {gt("No system is completely secure. Please use a strong, unique password for your Serika Account and keep your tokens private.")}
        </p>
      </section>

      <section>
        <H>{gt("15. Personal Data Breaches")}</H>
        <p>
          {gt("If a personal data breach occurs, we will notify the Autoriteit Persoonsgegevens without undue delay and, where feasible, within 72 hours of becoming aware of it, unless the breach is unlikely to result in a risk to your rights and freedoms. If the breach is likely to result in a high risk to you, we will also inform you without undue delay, describing what happened, the likely consequences and what we are doing and what you can do about it.")}
        </p>
      </section>

      <section>
        <H>{gt("16. Third-Party Services")}</H>
        <p>
          {gt("The Services may contain links to, or integrations with, third-party websites, applications, Bots or services that we do not operate or control. This Policy does not apply to them, and we are not responsible for their privacy practices. Please review their privacy policies before providing them with your information.")}
        </p>
      </section>

      <section>
        <H>{gt("17. Users Outside the EU")}</H>
        <p>
          {gt("We apply this Policy to all users, wherever they are. If you live outside the EU, you may have additional rights under local law (for example, under certain U.S. state privacy laws). We do not sell personal information or share it for cross-context behavioural advertising as those terms are defined under such laws. You can exercise any applicable rights by contacting privacy@serika.dev.")}
        </p>
      </section>

      <section>
        <H>{gt("18. Open Source")}</H>
        <p>
          {gt("SerikaCord's source code is public at")}{" "}
          <Ext href="https://github.com/serika-dev/SerikaCord">https://github.com/serika-dev/SerikaCord</Ext>
          {gt(", so anyone can inspect how the Services process data. Self-hosted copies of the code run by others are not covered by this Policy; their operators are responsible for them.")}
        </p>
      </section>

      <section>
        <H>{gt("19. Changes to This Policy")}</H>
        <p>
          {gt("We may update this Policy to reflect changes to the Services or the law. We will notify you of material changes by email and/or in the app before they take effect, at least 30 days in advance where the change affects existing users, unless a shorter period is required by law or for safety reasons. The \"Last updated\" date at the top shows when this Policy was last changed. Where a change requires your consent, we will ask for it.")}
        </p>
      </section>

      <section>
        <H>{gt("20. Contact")}</H>
        <p>
          {gt("For questions, concerns or requests about this Policy or your personal data, contact Serika Company at")}{" "}
          <Mail to="privacy@serika.dev" />
          {gt(". For illegal content and safety reports, use")}{" "}
          <Mail to="safety@serika.dev" />
          {gt("; for legal notices, use")}{" "}
          <Mail to="legal@serika.dev" />
          {gt("; and for general help, use")}{" "}
          <Mail to="support@serika.dev" />.
        </p>
      </section>
    </>
  );

  return (
    <LegalDocument
      badge={gt("Legal")}
      title={gt("Privacy Policy")}
      updated={gt("Last updated: 15 October 2026 · Effective: 15 November 2026 for existing users (immediately for new users)")}
      navLink={{ href: "/terms", label: gt("Terms of Service") }}
      footerLink={{ href: "/terms", label: gt("Terms of Service") }}
      copyright={gt("© 2026 Serika Company. All rights reserved.")}
      simple={simple}
      legal={legal}
    />
  );
}
