import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "The SerikaCord Terms of Service: the agreement between you and Serika Company (Netherlands) covering accounts, acceptable use, content, moderation and appeals, the Digital Services Act, bots and the API, Serika+ and your consumer rights.",
  path: "/terms",
  keywords: [
    "SerikaCord terms of service",
    "Serika terms",
    "user agreement",
    "acceptable use policy",
    "Digital Services Act",
    "notice and action",
    "appeals",
    "Serika+ subscription",
    "right of withdrawal",
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

export default async function TermsPage() {
  const gt = await getGT();


  // ------------------------------------------------------------------
  // SIMPLE — plain-language summary
  // ------------------------------------------------------------------
  const simple = (
    <>
      <section>
        <H>{gt("Who we are")}</H>
        <p>
          {gt("SerikaCord (serika.chat) is run by")}{" "}
          <B>{gt("Serika Company")}</B>
          {gt(", a company established in the Netherlands. These Terms are the agreement between you and us when you use SerikaCord: the website, the desktop and mobile apps, voice and video, bots, the API and everything else we offer here.")}
        </p>
        <p className="mt-3">
          {gt("This page is a short, plain-language summary. The Legal version is the binding text. Our Privacy Policy explains what we do with your data, and our Community Guidelines explain what is and isn't allowed in more everyday terms.")}
        </p>
      </section>

      <section>
        <H>{gt("You must be 16 or older")}</H>
        <p>
          {gt("You need to be at least 16 to have an account, wherever you live. If we find out an account belongs to someone under 16, we delete it.")}
        </p>
      </section>

      <section>
        <H>{gt("Your account")}</H>
        <p>
          {gt("You sign in with a Serika Account (accounts.serika.dev), which also handles your email address and password. Keep your login safe, don't share or sell your account, and tell us if someone else got into it. You're responsible for what happens on your account.")}
        </p>
      </section>

      <section>
        <H>{gt("What's not allowed")}</H>
        <p>{gt("In short: don't break the law and don't hurt people or the platform. In particular, never:")}</p>
        <ul className={UL}>
          <li>{gt("share child sexual abuse material (zero tolerance: we block it, suspend the account and report it to the authorities)")}</li>
          <li>{gt("share intimate images of someone without their consent")}</li>
          <li>{gt("promote terrorism or violent extremism, or threaten or harass people")}</li>
          <li>{gt("post someone's private information (doxxing)")}</li>
          <li>{gt("scam, phish, defraud or spread malware or spam")}</li>
          <li>{gt("impersonate others, or use alt accounts to get around a ban, strike or restriction")}</li>
          <li>{gt("buy or sell accounts, scrape the service, or attack our systems")}</li>
          <li>{gt("infringe other people's copyright or other rights")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("Your content stays yours")}</H>
        <p>
          {gt("You own what you post. You give us only the permission we need to store it, deliver it to the people you send it to, keep the service secure and run it. We don't sell your content, and we don't use your private messages to train AI models. Messages are encrypted when stored on our servers.")}
        </p>
      </section>

      <section>
        <H>{gt("Servers, moderators and bots")}</H>
        <p>
          {gt("Server owners and moderators set their own rules, can remove messages and members in their server, and are responsible for moderating it. Developers who build bots or use our Discord-compatible API must respect rate limits, only use the data they really need, and follow these Terms.")}
        </p>
      </section>

      <section>
        <H>{gt("How we keep the platform safe")}</H>
        <p>
          {gt("Every image you upload is automatically checked against known child sexual abuse material (using Microsoft PhotoDNA) and against a list of known scam images. Matches are blocked. Breaking the rules can lead to content removal, a temporary chat restriction, an account strike or a suspension. Strikes expire after 180 days; five active strikes suspend an account.")}
        </p>
        <p className="mt-3">
          {gt("You can see every strike and restriction on your Account Standing page, with the reason. You can appeal any decision for free within six months, and a person on our team reviews it. Even a suspended account can still sign in to see its standing and appeal.")}
        </p>
      </section>

      <section>
        <H>{gt("Reporting illegal content")}</H>
        <p>
          {gt("Report anything illegal with the in-app report button or by emailing")}{" "}
          <Mail to="safety@serika.dev" />
          {gt(". Tell us where it is, why you think it's illegal, and (except for child abuse reports) your name and email. Authorities can use the same address. We handle reports in English and Dutch.")}
        </p>
      </section>

      <section>
        <H>{gt("Serika+")}</H>
        <p>
          {gt("Serika+ is an optional paid subscription, paid through SerikaPay. You can cancel any time; it stops at the end of your billing period. As an EU consumer you normally have 14 days to change your mind, but if you ask us to activate Serika+ straight away and confirm you understand this, you lose that right once it's activated. We tell you at least 30 days before a price change, and you can cancel before it applies.")}
        </p>
      </section>

      <section>
        <H>{gt("Open source")}</H>
        <p>
          {gt("SerikaCord's code is public on")}{" "}
          <Ext href="https://github.com/serika-dev/SerikaCord">GitHub</Ext>
          {gt(". The code's open-source license covers the code; these Terms cover using our hosted service at serika.chat. Our name, logo and branding are not included in that license.")}
        </p>
      </section>

      <section>
        <H>{gt("Leaving, and when we end things")}</H>
        <p>
          {gt("You can delete your account whenever you like. We can suspend or close accounts that break these Terms or the law, and we'll tell you why unless the law stops us.")}
        </p>
      </section>

      <section>
        <H>{gt("Liability")}</H>
        <p>
          {gt("We work hard to keep SerikaCord running, but we can't promise it will never go down or lose anything. We are always fully responsible where the law says we must be: for example for intent or deliberate recklessness, for death or personal injury, and for your mandatory consumer rights. For other damage, our liability is limited as explained in the Legal version.")}
        </p>
      </section>

      <section>
        <H>{gt("Changes to these Terms")}</H>
        <p>
          {gt("If we make important changes, we'll tell you by email or in the app at least 30 days before they apply. If you don't agree, you can delete your account before then. If you keep using SerikaCord after that date, the new Terms apply.")}
        </p>
      </section>

      <section>
        <H>{gt("Disputes")}</H>
        <p>
          {gt("Dutch law applies. Please contact us first so we can try to sort it out. If you're a consumer in the EU, you keep the protections of the law where you live and can also take us to court in your own country.")}
        </p>
      </section>

      <section>
        <H>{gt("Contact")}</H>
        <ul className={UL}>
          <li>{gt("General help:")}{" "}<Mail to="support@serika.dev" /></li>
          <li>{gt("Illegal content, safety and authorities:")}{" "}<Mail to="safety@serika.dev" /></li>
          <li>{gt("Privacy requests:")}{" "}<Mail to="privacy@serika.dev" /></li>
          <li>{gt("Legal notices and copyright:")}{" "}<Mail to="legal@serika.dev" /></li>
        </ul>
      </section>
    </>
  );

  // ------------------------------------------------------------------
  // LEGAL — full, authoritative version
  // ------------------------------------------------------------------
  const legal = (
    <>
      <section>
        <H>{gt("1. About These Terms")}</H>
        <p>
          {gt("These Terms of Service (\"Terms\") form a legally binding agreement between you and")}{" "}
          <B>{gt("Serika Company")}</B>{" "}
          {gt("(\"Serika\", \"we\", \"us\" or \"our\"), a company established in the Netherlands, and govern your access to and use of SerikaCord, available at serika.chat, including its websites, desktop and mobile applications, voice and video features, application programming interfaces (APIs), gateway, bots, webhooks and all related features (together, the \"Services\").")}
        </p>
        <p className="mt-3">
          {gt("Our company details (registered address and Chamber of Commerce number) are available on request at")}{" "}
          <Mail to="legal@serika.dev" />.
        </p>
        <p className="mt-3">
          {gt("By creating an account or by accessing or using the Services, you agree to these Terms. Our Privacy Policy explains how we process personal data, and our Community Guidelines describe the conduct rules of the Services in more detail; the Community Guidelines form part of these Terms. If you do not agree to these Terms, you must not use the Services.")}
        </p>
        <p className="mt-3">
          {gt("This version of the Terms was last updated on 15 October 2026. It applies to new users from the moment they accept it and to existing users from 15 November 2026. Until that date, the previous version continues to apply to existing users.")}
        </p>
      </section>

      <section>
        <H>{gt("2. Definitions")}</H>
        <p>{gt("In these Terms:")}</p>
        <ul className={UL}>
          <li><B>{gt("\"Account\"")}</B>{" "}{gt("means your SerikaCord user account, which is linked to your Serika Account.")}</li>
          <li><B>{gt("\"Serika Account\"")}</B>{" "}{gt("means your account with Serika Accounts (accounts.serika.dev), the separate Serika service that manages your sign-in identity, email address and password.")}</li>
          <li><B>{gt("\"User Content\"")}</B>{" "}{gt("means any content you create, upload, send, post or otherwise make available through the Services, including messages, attachments, images, audio, video, files, profile information, reactions, server names and descriptions, and answers to server questions.")}</li>
          <li><B>{gt("\"Server\"")}</B>{" "}{gt("means a community space on SerikaCord with its own channels, roles and members. A \"Server Owner\" is the user who owns a Server, and a \"Moderator\" is any user who has been given permissions to manage or moderate a Server.")}</li>
          <li><B>{gt("\"Bot\" or \"Application\"")}</B>{" "}{gt("means any automated software that interacts with the Services through our API, gateway or webhooks, and a \"Developer\" is anyone who creates or operates one.")}</li>
          <li><B>{gt("\"Serika+\"")}</B>{" "}{gt("means our optional paid subscription and any other paid features of the Services.")}</li>
          <li><B>{gt("\"Strike\"")}</B>{" "}{gt("means a record on your Account that you violated these Terms, and a \"Restriction\" means a temporary limit on what your Account can do (for example, a chat restriction).")}</li>
          <li><B>{gt("\"Illegal Content\"")}</B>{" "}{gt("means any information that is not in compliance with the law of the European Union or of any EU Member State, as defined in the Digital Services Act.")}</li>
          <li><B>{gt("\"Digital Services Act\" or \"DSA\"")}</B>{" "}{gt("means Regulation (EU) 2022/2065 on a Single Market for Digital Services.")}</li>
          <li><B>{gt("\"Consumer\"")}</B>{" "}{gt("means a natural person using the Services for purposes outside their trade, business, craft or profession. A \"Business User\" is anyone using the Services in the course of a trade, business or profession, including Developers who operate Bots commercially.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("3. Eligibility and Minimum Age")}</H>
        <p>
          {gt("You must be at least 16 years old to create an Account or use the Services. This minimum age applies in every country. We do not knowingly provide Accounts to anyone under 16, and if we learn that an Account belongs to someone under 16, we will delete it. Where a Server, channel or feature is marked as age-restricted (for example, 18+), you must also meet that requirement.")}
        </p>
        <p className="mt-3">
          {gt("You may not use the Services if we have previously terminated your Account for a serious or repeated violation of these Terms (unless we have agreed otherwise in writing), or if you are prohibited from receiving the Services under applicable law. If you use the Services on behalf of an organisation, you confirm that you are authorised to bind that organisation to these Terms, and \"you\" includes that organisation.")}
        </p>
      </section>

      <section>
        <H>{gt("4. Your Account and Account Security")}</H>
        <p>
          {gt("You sign in to SerikaCord with your Serika Account. Your sign-in identity, email address and password are managed by Serika Accounts, which has its own terms. You agree to:")}
        </p>
        <ul className={UL}>
          <li>{gt("provide accurate information and keep it up to date;")}</li>
          <li>{gt("keep your password, tokens and other credentials confidential and use a strong, unique password;")}</li>
          <li>{gt("use your Account yourself and not share, sell, rent, transfer or license it or its username to anyone else;")}</li>
          <li>{gt("notify us without delay at support@serika.dev if you suspect unauthorised access to your Account.")}</li>
        </ul>
        <p className="mt-3">
          {gt("You are responsible for activity that takes place under your Account, unless it results from a failure of our own security measures. We may reclaim or change usernames, vanity invite links or other identifiers where needed to prevent impersonation or confusion, to protect trademark rights, or to enforce these Terms.")}
        </p>
      </section>

      <section>
        <H>{gt("5. The Services and Changes to Them")}</H>
        <p>
          {gt("The Services include, among other things: text messaging in Servers, direct messages (DMs) and group DMs; Servers with channels, roles, permissions, rules screening, onboarding questions, membership applications and manual approval, and verification levels; forums, threads and tickets; voice and video calls and screen sharing using WebRTC; presence and activity status; message search; read states and push notifications; audit logs for Server administrators; Bots, a Discord-v10-compatible API, gateway and webhooks; a consent-based bridge to Discord; and connections to third-party accounts.")}
        </p>
        <p className="mt-3">
          {gt("We do not record voice or video calls. Messages are encrypted when stored on our servers (encryption at rest). This is not end-to-end encryption: our systems decrypt messages to deliver them to the recipients, and authorised staff may access content where this is necessary under section 15 or our Privacy Policy.")}
        </p>
        <p className="mt-3">
          {gt("We continuously develop the Services and may add, change or remove features. Where a change materially and negatively affects your access to or use of paid digital content or services you have already paid for, we will inform you clearly and in good time, and, if you are a Consumer, you may terminate the affected subscription free of charge within 30 days of the change and receive a pro-rata refund of any prepaid, unused period, in accordance with the rules on modification of digital content under EU and Dutch law. We may also temporarily suspend parts of the Services for maintenance, security or reasons beyond our control (see section 21).")}
        </p>
      </section>

      <section>
        <H>{gt("6. Acceptable Use")}</H>
        <p>
          {gt("You must use the Services lawfully and in line with these Terms and our Community Guidelines. You must not, and must not attempt to, use the Services to:")}
        </p>
        <ul className={UL}>
          <li><B>{gt("Child sexual abuse:")}</B>{" "}{gt("upload, share, request, link to or otherwise facilitate child sexual abuse material (CSAM), or sexualise, groom or exploit minors in any way. We have zero tolerance: such content is blocked, the Account is suspended and the matter is reported to the competent authorities as described in section 15.")}</li>
          <li><B>{gt("Non-consensual intimate imagery:")}</B>{" "}{gt("share, or threaten to share, intimate or sexually explicit images or videos of a person without their consent, including manipulated or AI-generated (\"deepfake\") imagery.")}</li>
          <li><B>{gt("Terrorism and violent extremism:")}</B>{" "}{gt("promote, support, glorify, recruit for or organise terrorism, violent extremism or violent organisations, or share terrorist content.")}</li>
          <li><B>{gt("Violence, threats and harassment:")}</B>{" "}{gt("threaten, incite or glorify violence, harass, bully, stalk or intimidate others, or engage in hateful conduct targeting people based on protected characteristics.")}</li>
          <li><B>{gt("Doxxing:")}</B>{" "}{gt("publish or threaten to publish another person's private or identifying information (such as a home address, phone number, identity documents or private photos) without their consent.")}</li>
          <li><B>{gt("Scams, phishing and fraud:")}</B>{" "}{gt("deceive people for financial or personal gain, run phishing schemes, fake giveaways or investment scams, steal credentials or tokens, or offer fraudulent goods or services.")}</li>
          <li><B>{gt("Malware:")}</B>{" "}{gt("distribute viruses, token grabbers, ransomware, spyware or any other malicious or harmful code, or links to it.")}</li>
          <li><B>{gt("Spam:")}</B>{" "}{gt("send unsolicited bulk or repetitive messages, friend requests or invites, or advertise without permission.")}</li>
          <li><B>{gt("Impersonation:")}</B>{" "}{gt("impersonate any person, organisation, Serika staff or a Bot in a misleading way, or misrepresent your affiliation with anyone.")}</li>
          <li><B>{gt("Evasion:")}</B>{" "}{gt("create or use additional accounts, or use any other means, to evade a suspension, ban, Strike or Restriction issued by us or by a Server's Moderators.")}</li>
          <li><B>{gt("Platform manipulation:")}</B>{" "}{gt("artificially inflate member counts, reactions or other metrics, coordinate inauthentic behaviour, abuse the report or appeal systems, or automate a regular user account (\"self-bots\").")}</li>
          <li><B>{gt("Trading accounts:")}</B>{" "}{gt("buy, sell, rent or trade Accounts, usernames, Servers, Bots or invites.")}</li>
          <li><B>{gt("Scraping:")}</B>{" "}{gt("scrape, crawl, harvest or index the Services or other users' data, except through our published API within its rate limits and these Terms.")}</li>
          <li><B>{gt("Attacks on our infrastructure:")}</B>{" "}{gt("access non-public areas of the Services or our providers' systems without authorisation, probe or test vulnerabilities without our permission, circumvent security, rate limits or other technical restrictions, or disrupt or overload the Services (for example, by denial-of-service attacks).")}</li>
          <li><B>{gt("Intellectual property infringement:")}</B>{" "}{gt("share content that infringes copyright, trademarks or other intellectual property rights, including pirated software, media or games.")}</li>
          <li><B>{gt("Other illegal activity:")}</B>{" "}{gt("violate any applicable law, or the rights of others, including privacy, data protection and image rights.")}</li>
        </ul>
        <p className="mt-3">
          {gt("If you find a security vulnerability, please report it responsibly to safety@serika.dev rather than exploiting it. Servers may set additional rules for their own spaces; you must follow those rules as well, but they cannot override these Terms.")}
        </p>
      </section>

      <section>
        <H>{gt("7. Your Content and the License You Give Us")}</H>
        <p>
          {gt("You keep all ownership rights you have in your User Content. You are responsible for your User Content and confirm that you have the rights needed to share it and that it does not violate these Terms, the law or the rights of others.")}
        </p>
        <p className="mt-3">
          {gt("You grant Serika a non-exclusive, royalty-free, worldwide license to host, store, cache, copy, transmit, display and technically adapt (for example, by compressing, transcoding or resizing) your User Content, solely as necessary to operate, secure and provide the Services, including delivering it to the people and places you choose to share it with. We may let our processors exercise this license on our behalf only for the same purposes. This license does not allow us to sell your User Content or to use it for advertising.")}
        </p>
        <p className="mt-3">
          {gt("We do not use your User Content to train artificial intelligence models without your consent, and we never use your private messages (DMs and group DMs) to train artificial intelligence models.")}
        </p>
        <p className="mt-3">
          {gt("The license ends when you delete the User Content or your Account, except that (a) content you shared with others may remain visible to them where it forms part of a conversation or Server they still have access to, unless you delete it first; (b) deleted content may persist in backups for a limited period, as set out in our Privacy Policy; and (c) we may retain content where required by law or necessary to handle a report, appeal or legal claim.")}
        </p>
        <p className="mt-3">
          {gt("If you send us suggestions or feedback about the Services, we may use them freely without any obligation to you.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Servers, Server Owners and Moderators")}</H>
        <p>
          {gt("Server Owners and Moderators decide who can join their Server and what happens in it. They can set Server rules, require members to accept those rules (rules screening), ask onboarding questions, review membership applications and approve members manually, set verification levels, configure automated moderation (AutoMod), and remove content, time out, kick or ban members within their Server. Server administrators can see an audit log of moderation and configuration actions in their Server.")}
        </p>
        <p className="mt-3">{gt("If you own or moderate a Server, you agree to:")}</p>
        <ul className={UL}>
          <li>{gt("moderate your Server in good faith and in line with these Terms and the Community Guidelines, and not set rules that require members to break them;")}</li>
          <li>{gt("act on Illegal Content in your Server when you become aware of it, and not encourage or tolerate violations;")}</li>
          <li>{gt("only collect information from members (for example, through onboarding questions or applications) that you actually need, use it only to run your Server, and comply with data protection law where it applies to you;")}</li>
          <li>{gt("clearly mark age-restricted channels and keep adult content out of channels that are not marked as such.")}</li>
        </ul>
        <p className="mt-3">
          {gt("Server Owners and Moderators are not our employees or agents, and their decisions are their own. If you disagree with a Server-level decision, contact that Server's Moderators first. We may step in, and may restrict or remove a Server, where a Server or its moderation violates these Terms or the law. If a Server Owner deletes their Account, ownership of their Servers passes to another member or, if none remain, the Server is deleted.")}
        </p>
      </section>

      <section>
        <H>{gt("9. Bots, Developers and the API")}</H>
        <p>
          {gt("We offer a Discord-v10-compatible API, gateway and webhooks so that Developers can build Bots and integrations. The compatibility is technical only: SerikaCord is not affiliated with or endorsed by Discord. If you create or operate a Bot or use the API, these Terms apply to you as a Developer, and you also agree to:")}
        </p>
        <ul className={UL}>
          <li>{gt("keep your Bot tokens, client secrets and webhook URLs confidential, and rotate them if they are exposed;")}</li>
          <li>{gt("respect rate limits and rate-limit responses, follow our developer documentation and the documented gateway and API behaviour, and not try to circumvent limits (for example, by using multiple tokens or accounts);")}</li>
          <li>{gt("only request the permissions and access your Bot needs, collect and keep only the data needed for its features (data minimisation), delete data when it is no longer needed or when a user or Server asks, and never sell or share data obtained through the API;")}</li>
          <li>{gt("give users clear information about what data your Bot processes and why (for example, in a privacy policy), and comply with applicable data protection law as an independent controller;")}</li>
          <li>{gt("not use the API to spam, scrape, track users across Servers, build profiles of users, or do anything these Terms prohibit;")}</li>
          <li>{gt("make sure messages your Bot sends comply with these Terms, and not make your Bot appear to be a human user or Serika staff.")}</li>
        </ul>
        <p className="mt-3">
          {gt("We may set or change rate limits, review Bots, and suspend or revoke Bots, tokens, webhooks or API access that violate these Terms or put users or the Services at risk. The API is provided without any guaranteed availability or backwards compatibility, although we try to give notice of breaking changes. Bots are operated by their Developers, not by us; Developers are responsible for their Bots.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Third-Party Integrations and the Discord Bridge")}</H>
        <p>
          {gt("You may choose to connect third-party accounts to SerikaCord, such as Discord, Spotify, Last.fm, Steam, GitHub, Twitch, YouTube, Twitter/X, Instagram, Roblox, Xbox, PlayStation and Battle.net, and to verify ownership of a website domain using a DNS TXT record. These connections are optional. When you link an account, we receive only the data that you authorise through that provider. Your use of a third-party service is governed by that provider's own terms and privacy policy, and we are not responsible for third-party services. You may only verify domains that you control.")}
        </p>
        <p className="mt-3">
          {gt("Discord bridge. Servers may bridge a Discord server to SerikaCord. When you use the bridge, you also agree to Discord's Terms of Service, Developer Terms of Service and Developer Policy. The bridge is consent-based: messages sent by a Discord user are not processed or mirrored unless that user has agreed to data processing by Serika, and messages sent by a SerikaCord user are not forwarded to Discord unless that user has enabled \"Allow data processing by Discord\" in their settings. Consent may be withdrawn at any time, and we will delete the associated bridged data. Data obtained through Discord's APIs is used solely to operate the bridge, is not sold or shared with advertisers or data brokers, and is deleted when it is no longer necessary or upon request by the user or by Discord.")}
        </p>
      </section>

      <section>
        <H>{gt("11. Serika+ and Paid Features")}</H>
        <H3>{gt("11.1 Purchase and billing")}</H3>
        <p>
          {gt("Serika+ is an optional subscription that gives access to additional digital features. Payments are processed through SerikaPay, Serika's payment service. Prices are shown before you buy and include VAT where applicable for Consumers. Unless stated otherwise, subscriptions renew automatically at the end of each billing period until cancelled, and you authorise us to charge the renewal fee to your chosen payment method.")}
        </p>
        <H3>{gt("11.2 Cancellation")}</H3>
        <p>
          {gt("You can cancel your subscription at any time. Cancellation takes effect at the end of the current billing period, and you keep access to Serika+ until then. Where mandatory consumer law gives you a right to end an automatically renewed subscription sooner (for example, with a notice period of at most one month after the initial term), that right applies and any prepaid amount for the period after termination will be refunded.")}
        </p>
        <H3>{gt("11.3 Right of withdrawal (EU Consumers)")}</H3>
        <p>
          {gt("If you are a Consumer in the EU, you have the right to withdraw from a purchase within 14 days without giving any reason. The withdrawal period ends 14 days after the day the contract was concluded. To exercise it, send us a clear statement of your decision (for example, by email to support@serika.dev), stating your Account username, what you bought and the date of purchase. You do not have to use any particular form or wording. It is enough to send your notice before the withdrawal period ends. If you withdraw, we will refund all payments received from you without undue delay and in any event within 14 days, using the same means of payment unless you expressly agree otherwise, at no cost to you.")}
        </p>
        <p className="mt-3">
          {gt("Loss of the right of withdrawal: Serika+ is digital content and a digital service that is supplied immediately. When you buy it, we ask whether you want access to begin straight away. If you expressly request immediate performance and acknowledge that you thereby lose your right of withdrawal, you lose the right of withdrawal once Serika+ has been activated on your Account (Article 16(m) of Directive 2011/83/EU and Article 6:230p of the Dutch Civil Code). We confirm your request and acknowledgement in the order confirmation we send you. If you have not given this request and acknowledgement, you keep your right of withdrawal, and if you withdraw you do not have to pay for any use of Serika+ during the withdrawal period.")}
        </p>
        <H3>{gt("11.4 Price changes")}</H3>
        <p>
          {gt("We may change the price of Serika+. We will notify existing subscribers by email or in the app at least 30 days before a price change applies to them, and the new price will apply from your next billing period after that notice period. If you do not agree, you can cancel before the new price applies. If you are a Consumer and a price increase takes effect within three months of your purchase, you may terminate the subscription.")}
        </p>
        <H3>{gt("11.5 Refunds and your statutory rights")}</H3>
        <p>
          {gt("Except where these Terms or mandatory law provide otherwise, payments for periods that have started are not refunded. This does not affect your statutory rights: as a Consumer, you are entitled to digital content and services that conform to the contract, and if they do not, you have the remedies provided by law (including repair, a price reduction or termination with a refund). If a payment fails, we may suspend paid features until the payment is made.")}
        </p>
      </section>

      <section>
        <H>{gt("12. Intellectual Property and Open Source")}</H>
        <p>
          {gt("The source code of SerikaCord is public at")}{" "}
          <Ext href="https://github.com/serika-dev/SerikaCord">https://github.com/serika-dev/SerikaCord</Ext>
          {gt(". Your use, copying, modification and distribution of that source code are governed by the open-source license published with it, not by these Terms. These Terms govern your use of the hosted Services operated by Serika at serika.chat.")}
        </p>
        <p className="mt-3">
          {gt("The names Serika, SerikaCord and Serika+, our logos, and other branding are trademarks or distinctive signs of Serika and are not licensed under the open-source license or these Terms. You may not use them in a way that suggests endorsement by or affiliation with Serika, or for a service that could be confused with ours, without our prior written permission.")}
        </p>
        <p className="mt-3">
          {gt("Subject to these Terms, we grant you a personal, non-exclusive, non-transferable, revocable right to access and use the hosted Services. Content provided by other users remains theirs, and you may only use it as permitted by them or by law.")}
        </p>
      </section>

      <section>
        <H>{gt("13. Copyright and Intellectual Property Notices")}</H>
        <p>
          {gt("If you believe content on the Services infringes your copyright or other intellectual property rights, send a notice to")}{" "}
          <Mail to="legal@serika.dev" />{" "}
          {gt("(or use the in-app report function). Your notice should include:")}
        </p>
        <ul className={UL}>
          <li>{gt("your name and contact details, and, if you act on behalf of the rights holder, your authority to do so;")}</li>
          <li>{gt("a description of the protected work or right concerned;")}</li>
          <li>{gt("the exact location of the allegedly infringing content (for example, message links, or Server, channel and message identifiers);")}</li>
          <li>{gt("an explanation of why the content infringes your rights; and")}</li>
          <li>{gt("a statement that you believe in good faith that the information in your notice is accurate and complete.")}</li>
        </ul>
        <p className="mt-3">
          {gt("If we remove or disable content based on such a notice, we will inform the user who posted it with a statement of reasons. That user may submit a counter-notice through an appeal on their Account Standing page or by emailing legal@serika.dev, explaining why the content does not infringe (for example, because they hold a license or an exception such as quotation or parody applies). We may forward the counter-notice to the notifier and may restore the content if the notice turns out to be unfounded. We terminate the Accounts of repeat infringers in appropriate circumstances. Knowingly submitting false notices or counter-notices may make you liable for damages.")}
        </p>
      </section>

      <section>
        <H>{gt("14. Illegal Content and the Digital Services Act")}</H>
        <H3>{gt("14.1 Points of contact")}</H3>
        <p>
          {gt("Our single point of contact for Member State authorities, the European Commission and the European Board for Digital Services (Article 11 DSA), and for users of the Services (Article 12 DSA), is")}{" "}
          <Mail to="safety@serika.dev" />
          {gt(". You can communicate with us there in English or Dutch. Users can also contact us through the in-app reporting tools; communication with us is never handled solely by automated means.")}
        </p>
        <H3>{gt("14.2 How to report Illegal Content")}</H3>
        <p>
          {gt("Anyone can notify us of content they consider to be Illegal Content, using the in-app report function or by emailing safety@serika.dev. To allow us to take a diligent decision, your notice should contain (Article 16 DSA):")}
        </p>
        <ul className={UL}>
          <li>{gt("a sufficiently substantiated explanation of why you consider the content to be illegal;")}</li>
          <li>{gt("a clear indication of the exact electronic location of the content, such as message links or the Server, channel, message and user identifiers;")}</li>
          <li>{gt("your name and email address, except for reports concerning child sexual abuse or exploitation offences, which may be made anonymously;")}</li>
          <li>{gt("a statement confirming your good-faith belief that the information and allegations in the notice are accurate and complete.")}</li>
        </ul>
        <p className="mt-3">
          {gt("If you provide contact details, we will confirm receipt of your notice and inform you of our decision and of the ways to challenge it. We process notices in a timely, diligent, non-arbitrary and objective manner, and we tell you if automated means were used in processing or deciding on your notice. If the information in a notice reveals a suspected criminal offence involving a threat to the life or safety of persons, we will promptly inform the competent law enforcement or judicial authorities (Article 18 DSA).")}
        </p>
        <H3>{gt("14.3 Content moderation and automated tools")}</H3>
        <p>{gt("To detect and act on Illegal Content and violations of these Terms, we use (Article 14 DSA):")}</p>
        <ul className={UL}>
          <li><B>{gt("PhotoDNA hash matching:")}</B>{" "}{gt("every image uploaded to the Services is checked automatically, before it is stored, against hashes of known child sexual abuse material using the Microsoft PhotoDNA Cloud Service.")}</li>
          <li><B>{gt("Scam-image hash matching:")}</B>{" "}{gt("every uploaded image is also compared against a list of perceptual hashes of known scam images maintained by our Trust and Safety staff.")}</li>
          <li><B>{gt("Rate limits and spam checks:")}</B>{" "}{gt("automated limits and checks on the volume and pattern of messages, requests, invites and sign-ups to prevent spam, abuse and attacks.")}</li>
          <li><B>{gt("AutoMod:")}</B>{" "}{gt("automated moderation rules that Server Owners and Moderators may configure for their own Servers (for example, keyword filters). AutoMod is configured and operated by the Server, not by us.")}</li>
          <li><B>{gt("Human review:")}</B>{" "}{gt("reports, appeals and other decisions are reviewed by our Trust and Safety staff, who may also issue Strikes, Restrictions and suspensions manually.")}</li>
        </ul>
        <p className="mt-3">
          {gt("Automated hash matching can only recognise images that are identical or very similar to images already known to be abusive or fraudulent; it does not interpret the meaning of your content. We apply our moderation rules diligently, objectively and proportionately, with due regard to the rights and legitimate interests of everyone involved, including freedom of expression.")}
        </p>
        <H3>{gt("14.4 Statement of reasons")}</H3>
        <p>
          {gt("When we remove or restrict access to your content, restrict your Account or features, issue a Strike, or suspend or terminate your Account, we provide you with a clear and specific statement of reasons (Article 17 DSA). It is shown on your Account Standing page and/or sent to you as a system message, and states what we decided and its scope and duration, the facts and circumstances relied on, whether automated means were used, the legal ground or the provision of these Terms concerned, and how you can seek redress. We may not provide a statement of reasons where we do not have your contact details, where the content is deceptive high-volume commercial content, or where a law or an order of a competent authority prohibits it.")}
        </p>
        <H3>{gt("14.5 Appeals (internal complaint-handling)")}</H3>
        <p>
          {gt("You can appeal any of the decisions listed in section 14.4, and anyone who submitted a notice can challenge our decision on that notice, free of charge, for at least six months after you were informed of the decision (Article 20 DSA). Appeals are submitted electronically from your Account Standing page (or, if that is not possible, by emailing safety@serika.dev). Appeals are decided by qualified staff and not solely by automated means. We handle appeals in a timely, non-discriminatory, diligent and non-arbitrary manner, reverse our decision without undue delay if the appeal shows it was wrong, and inform you of the outcome with our reasons and your further options.")}
        </p>
        <H3>{gt("14.6 Out-of-court dispute settlement")}</H3>
        <p>
          {gt("If you disagree with a content moderation decision or the outcome of your appeal, you may also refer the dispute to an out-of-court dispute settlement body certified under Article 21 DSA. A list of certified bodies is published by the European Commission. We will engage with such a body in good faith. Its decision is not binding on either party, and using it does not affect your right to go to court.")}
        </p>
        <H3>{gt("14.7 Measures against misuse")}</H3>
        <p>
          {gt("After a prior warning, we may suspend for a reasonable period the Accounts of users who frequently provide manifestly illegal content, and we may suspend the processing of notices and complaints from individuals or entities that frequently submit notices or complaints that are manifestly unfounded (Article 23 DSA). We assess this case by case, taking into account the number of manifestly illegal items or unfounded notices, their proportion, their severity and, where identifiable, the intention of the user. These measures are in addition to the Strike system described in section 15.")}
        </p>
        <H3>{gt("14.8 Orders from authorities")}</H3>
        <p>
          {gt("We act on orders to act against Illegal Content and orders to provide information issued by competent judicial or administrative authorities in accordance with Articles 9 and 10 DSA and applicable law, and inform affected users where required. Law enforcement requests should be sent to safety@serika.dev.")}
        </p>
      </section>

      <section>
        <H>{gt("15. Trust and Safety: Image Checks, Strikes, Restrictions and Account Standing")}</H>
        <H3>{gt("15.1 Child sexual abuse material")}</H3>
        <p>
          {gt("If an uploaded image matches known child sexual abuse material, the upload is blocked and the image is never stored, the Account is suspended, and an incident is recorded containing metadata such as the image hash, the uploading Account, its IP address, the time of the upload and the PhotoDNA tracking ID. We report such incidents to the National Center for Missing and Exploited Children (NCMEC) and/or the competent authorities as required by law, and we preserve the data we are legally required to preserve. Strikes for child sexual abuse material do not expire.")}
        </p>
        <H3>{gt("15.2 Scam images")}</H3>
        <p>
          {gt("If an uploaded image matches a known scam image, the upload is blocked, your Account receives a 24-hour chat Restriction, and a Strike is added to your Account.")}
        </p>
        <H3>{gt("15.3 Strikes, Restrictions and suspensions")}</H3>
        <p>
          {gt("Strikes may be issued automatically as described above or manually by our Trust and Safety staff for violations of these Terms. Strikes expire 180 days after they are issued, except Strikes for child sexual abuse material, which do not expire. If your Account reaches five active Strikes, it is suspended. Our staff may also issue Restrictions and suspensions manually, depending on the severity of the violation, and may take immediate permanent action for the most serious violations. Separately, Server Moderators may remove content or members in their own Servers (section 8); those Server-level actions are not Strikes.")}
        </p>
        <H3>{gt("15.4 Account Standing and appeals")}</H3>
        <p>
          {gt("Your Account Standing page shows your active Strikes, Restrictions and suspensions, with the statement of reasons for each. You can appeal each decision from that page as described in section 14.5. A suspended Account can still sign in to view its Account Standing and submit appeals, but cannot otherwise use the Services. Automated decisions are not final: every appeal is reviewed by a person, and if a decision is overturned we remove the Strike or lift the Restriction or suspension.")}
        </p>
      </section>

      <section>
        <H>{gt("16. Termination")}</H>
        <H3>{gt("16.1 By you")}</H3>
        <p>
          {gt("You may stop using the Services at any time and delete your Account through Serika Accounts or by contacting privacy@serika.dev. If you have an active Serika+ subscription, please make sure it is cancelled in SerikaPay. What happens to your data on deletion is described in our Privacy Policy.")}
        </p>
        <H3>{gt("16.2 By us")}</H3>
        <p>
          {gt("We may suspend or terminate your Account, or restrict your access to all or part of the Services, if you seriously or repeatedly violate these Terms or the law, if this is necessary to protect other users, third parties or the Services, if we are required to do so by law or by an authority, or if you are under 16. Our decisions are proportionate to the violation, and we provide a statement of reasons and the right to appeal as described in section 14, unless the law or an order of a competent authority prohibits it.")}
        </p>
        <p className="mt-3">
          {gt("We may also end the Services or your Account for other legitimate reasons (for example, if we discontinue the Services) by giving you at least 30 days' notice, and we will refund any prepaid, unused part of a Serika+ subscription in that case.")}
        </p>
        <H3>{gt("16.3 Effect of termination")}</H3>
        <p>
          {gt("On termination, your right to use the Services ends. Provisions that by their nature are intended to survive termination, including sections 7 (to the extent content remains shared), 12, 13, 18, 19, 20, 23 and 24, remain in force.")}
        </p>
      </section>

      <section>
        <H>{gt("17. Our Role as a Hosting Service")}</H>
        <p>
          {gt("The Services are a hosting service within the meaning of the Digital Services Act. User Content is provided by users, not by us, and we do not endorse it. In accordance with Article 6 DSA, we are not liable for information stored at the request of users as long as we do not have actual knowledge of illegal activity or Illegal Content and, upon obtaining such knowledge, act expeditiously to remove or disable access to it. This does not affect our obligations under these Terms and the law.")}
        </p>
      </section>

      <section>
        <H>{gt("18. Disclaimers")}</H>
        <p>
          {gt("We provide the Services with reasonable care and skill. Because the Services are run over the internet and depend on third-party networks and providers, we cannot guarantee that they will always be available, uninterrupted, error-free or secure, or that content will never be lost. We recommend that you keep your own copies of content that is important to you. We are not responsible for the content or conduct of other users, Server Owners, Moderators, Bots or third-party services, except to the extent that we are liable for our own breach of these Terms or the law.")}
        </p>
        <p className="mt-3">
          {gt("Nothing in these Terms limits the rights you have as a Consumer under mandatory law, including your statutory rights to digital content and digital services that conform to the contract.")}
        </p>
      </section>

      <section>
        <H>{gt("19. Limitation of Liability")}</H>
        <p>
          {gt("19.1 Nothing in these Terms excludes or limits our liability (a) for damage caused by intent or deliberate recklessness (opzet of bewuste roekeloosheid) on the part of Serika or its management; (b) for death or personal injury; or (c) to the extent the liability cannot be excluded or limited under mandatory law, including mandatory consumer protection law.")}
        </p>
        <p className="mt-3">
          {gt("19.2 Subject to section 19.1, our liability for breach of these Terms or otherwise in connection with the Services is limited to direct damage that was reasonably foreseeable when the agreement was concluded, and our total liability per calendar year is limited to the greater of (a) the amount you paid us for the Services in the 12 months before the event giving rise to the claim, or (b) EUR 100.")}
        </p>
        <p className="mt-3">
          {gt("19.3 Subject to section 19.1, we are not liable to Business Users for indirect or consequential loss, including loss of profit, revenue, business, goodwill or data.")}
        </p>
        <p className="mt-3">
          {gt("19.4 If you are a Consumer, sections 19.2 and 19.3 do not apply to the extent that they would be unreasonably onerous under Dutch law (Articles 6:233 to 6:237 of the Dutch Civil Code) or the mandatory law of your country of residence.")}
        </p>
        <p className="mt-3">
          {gt("19.5 To claim damages, you should notify us in writing of the damage as soon as reasonably possible after you discover it, so we can limit it.")}
        </p>
      </section>

      <section>
        <H>{gt("20. Indemnity")}</H>
        <p>
          {gt("This section applies only to Business Users, including Developers acting in the course of a business, and does not apply to Consumers. You will indemnify Serika against third-party claims, and related reasonable costs, arising from your User Content, your Bots or your violation of these Terms or the law, to the extent the claim results from your own act or omission. We will notify you promptly of any such claim and let you take part in the defence. If you are a Consumer, you are liable only in accordance with the statutory rules of Dutch law for damage you culpably cause.")}
        </p>
      </section>

      <section>
        <H>{gt("21. Force Majeure")}</H>
        <p>
          {gt("We are not liable for any failure or delay in performing our obligations caused by circumstances beyond our reasonable control (overmacht), such as natural disasters, epidemics, war, terrorism, riots, government measures, strikes, large-scale power or internet outages, failures of hosting, network or other providers, or cyberattacks that could not reasonably have been prevented, provided we take reasonable steps to limit the consequences.")}
        </p>
      </section>

      <section>
        <H>{gt("22. Changes to These Terms")}</H>
        <p>
          {gt("We may update these Terms, for example because of changes to the Services, to the law or to our business. We will notify existing users of material changes by email and/or in the app at least 30 days before they take effect. Changes may take effect immediately for new users, and sooner for existing users where required by law, by an order of a competent authority, or to address an urgent safety, security or abuse risk; in that case we will tell you as soon as possible.")}
        </p>
        <p className="mt-3">
          {gt("If you do not agree to a change, you may delete your Account before the change takes effect, and if you have a Serika+ subscription you may cancel it and receive a pro-rata refund of any prepaid, unused period. If you continue to use the Services after the effective date, the updated Terms apply to you.")}
        </p>
      </section>

      <section>
        <H>{gt("23. Governing Law and Disputes")}</H>
        <p>
          {gt("These Terms and any dispute arising out of or in connection with them or the Services are governed by Dutch law. If you are a Consumer, this choice of law does not deprive you of the protection of the mandatory provisions of the law of the country where you have your habitual residence (Article 6 of the Rome I Regulation).")}
        </p>
        <p className="mt-3">
          {gt("Disputes will be submitted to the competent court in the Netherlands. If you are a Consumer residing in the EU, you may also bring proceedings in the courts of the EU country where you are domiciled, and we may only bring proceedings against you in the courts of that country (Article 18 of the Brussels I bis Regulation).")}
        </p>
        <p className="mt-3">
          {gt("We would like to resolve any problem with you directly. Please contact us first at legal@serika.dev (or support@serika.dev for service issues), and we will try to find a solution with you. If that does not work, you may take the dispute to a competent court. The European Commission's Online Dispute Resolution platform has been discontinued, and we are not a member of an alternative dispute resolution body. For content moderation decisions, the out-of-court dispute settlement option in section 14.6 is also available.")}
        </p>
      </section>

      <section>
        <H>{gt("24. General Provisions")}</H>
        <ul className={UL}>
          <li><B>{gt("Entire agreement:")}</B>{" "}{gt("these Terms, together with the Privacy Policy, the Community Guidelines and any additional terms you accept for specific features, are the entire agreement between you and us about the Services.")}</li>
          <li><B>{gt("Severability:")}</B>{" "}{gt("if any provision of these Terms is invalid or unenforceable, the rest remains in force, and the invalid provision will be replaced by a valid provision that comes as close as possible to its purpose, to the extent permitted by law.")}</li>
          <li><B>{gt("No waiver:")}</B>{" "}{gt("if we do not enforce a provision right away, we do not waive our right to enforce it later.")}</li>
          <li><B>{gt("Assignment:")}</B>{" "}{gt("you may not transfer your rights or obligations under these Terms without our consent. We may transfer our rights and obligations to an affiliated company or to a successor of the Services, provided this does not reduce your rights; we will inform you, and if you are a Consumer and object, you may end the agreement by deleting your Account.")}</li>
          <li><B>{gt("Third parties:")}</B>{" "}{gt("these Terms do not give rights to anyone other than you and us.")}</li>
          <li><B>{gt("Language:")}</B>{" "}{gt("these Terms are written in English, and the English version governs. Translations are provided for convenience only. This does not affect the mandatory rule that, in a contract with a Consumer, an unclear term is interpreted in the way most favourable to the Consumer.")}</li>
          <li><B>{gt("Notices:")}</B>{" "}{gt("we may send you notices by email to the address linked to your Serika Account, through system messages or in the app. Legal notices to us must be sent to legal@serika.dev.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("25. Contact")}</H>
        <ul className={UL}>
          <li><B>{gt("General support:")}</B>{" "}<Mail to="support@serika.dev" /></li>
          <li><B>{gt("Illegal content reports, safety and law enforcement (DSA point of contact):")}</B>{" "}<Mail to="safety@serika.dev" /></li>
          <li><B>{gt("Privacy and data protection requests:")}</B>{" "}<Mail to="privacy@serika.dev" /></li>
          <li><B>{gt("Legal notices and intellectual property:")}</B>{" "}<Mail to="legal@serika.dev" /></li>
        </ul>
        <p className="mt-3">
          {gt("Our company details (registered address and Chamber of Commerce number) are available on request at")}{" "}
          <Mail to="legal@serika.dev" />.
        </p>
      </section>
    </>
  );

  return (
    <LegalDocument
      badge={gt("Legal")}
      title={gt("Terms of Service")}
      updated={gt("Last updated: 15 October 2026 · Effective: 15 November 2026 for existing users (immediately for new users)")}
      navLink={{ href: "/privacy", label: gt("Privacy Policy") }}
      footerLink={{ href: "/privacy", label: gt("Privacy Policy") }}
      copyright={gt("© 2026 Serika Company. All rights reserved.")}
      simple={simple}
      legal={legal}
    />
  );
}
