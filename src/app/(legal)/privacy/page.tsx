import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "Learn how SerikaCord and Serika Company collect, use, store, and protect your personal data. Read our full privacy policy for account, message, and cookie practices.",
  path: "/privacy",
  keywords: [
    "SerikaCord privacy policy",
    "Serika privacy",
    "data protection",
    "cookies",
    "user data",
  ],
});

export default async function PrivacyPage() {
  const gt = await getGT();

  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-white text-xl font-semibold mb-3">{children}</h2>
  );
  const H3 = ({ children }: { children: React.ReactNode }) => (
    <h3 className="text-white text-base font-semibold mb-2 mt-4">{children}</h3>
  );

  // ------------------------------------------------------------------
  // SIMPLE — plain-language summary
  // ------------------------------------------------------------------
  const simple = (
    <>
      <section>
        <H>{gt("1. About This Policy")}</H>
        <p>
          {gt("This Privacy Policy describes how")}{" "}
          <strong className="text-white">{gt("Serika Company")}</strong>{" "}
          {gt("(\"Serika\", \"we\", \"us\", or \"our\") collects, uses, and shares information when you use SerikaCord and related services (the \"Services\"). We are committed to protecting your privacy and handling your data transparently.")}
        </p>
      </section>

      <section>
        <H>{gt("2. Information We Collect")}</H>
        <p className="font-medium text-white mb-2">{gt("Information you provide:")}</p>
        <ul className="list-disc list-inside space-y-1">
          <li>{gt("Account registration data (email, username, display name, password hash)")}</li>
          <li>{gt("Profile information (avatar, status, bio)")}</li>
          <li>{gt("Messages, files, and other content you share")}</li>
          <li>{gt("Payment information processed through our third-party payment provider")}</li>
        </ul>
        <p className="font-medium text-white mb-2 mt-4">{gt("Information collected automatically:")}</p>
        <ul className="list-disc list-inside space-y-1">
          <li>{gt("IP addresses and device identifiers")}</li>
          <li>{gt("Browser type and operating system")}</li>
          <li>{gt("Usage data and interaction logs")}</li>
          <li>{gt("Connection metadata (timestamps, session duration)")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("3. How We Use Your Information")}</H>
        <p>{gt("We use the information we collect to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Provide, operate, and improve the Services")}</li>
          <li>{gt("Authenticate users and maintain account security")}</li>
          <li>{gt("Deliver messages and content between users")}</li>
          <li>{gt("Process payments for Serika+ subscriptions")}</li>
          <li>{gt("Enforce our Terms of Service and community guidelines")}</li>
          <li>{gt("Respond to support requests and communicate service updates")}</li>
          <li>{gt("Detect and prevent fraud, abuse, and security threats")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("Discord Bridge & Data Processing")}</H>
        <p>
          {gt("Some servers connect (\"bridge\") a Discord server to SerikaCord so messages can be mirrored between the two platforms. This feature is consent-based and complies with the Discord Developer Terms of Service and Developer Policy.")}
        </p>
        <H3>{gt("If you chat in Discord (inbound)")}</H3>
        <ul className="list-disc list-inside space-y-1">
          <li>{gt("We do not store or forward any of your messages until you explicitly agree. Our bot will DM you asking for consent.")}</li>
          <li>{gt("If you agree, we store only your Discord username, avatar, and the content of messages you send in bridged channels, solely to relay them to SerikaCord.")}</li>
          <li>{gt("If you decline (or never respond), your messages are never processed, and any data we hold for you is deleted. Server admins may optionally restrict unconsented members from chatting until they agree.")}</li>
          <li>{gt("You can withdraw consent at any time, after which we delete your bridged data.")}</li>
        </ul>
        <H3>{gt("If you chat in SerikaCord (outbound)")}</H3>
        <ul className="list-disc list-inside space-y-1">
          <li>{gt("Your messages are only sent to a bridged Discord server if you have enabled \"Allow data processing by Discord\" in Settings → Data & Privacy.")}</li>
          <li>{gt("If you have not enabled it, your messages are never synced to Discord.")}</li>
        </ul>
        <H3>{gt("Retention & deletion")}</H3>
        <p>
          {gt("We retain bridged Discord data only as long as necessary to provide the bridge. We delete it promptly when it is no longer necessary, when you or Discord request deletion, when a server disables the bridge, or when we stop operating the feature, consistent with Discord's Developer Terms of Service.")}
        </p>
      </section>

      <section>
        <H>{gt("4. Information Sharing")}</H>
        <p>{gt("We do not sell your personal data. We may share information:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li><strong className="text-white">{gt("With other users:")}</strong>{" "}{gt("your username, display name, avatar, and status are visible to users you interact with")}</li>
          <li><strong className="text-white">{gt("Service providers:")}</strong>{" "}{gt("third-party vendors who assist in operating the Services under strict confidentiality agreements")}</li>
          <li><strong className="text-white">{gt("Legal compliance:")}</strong>{" "}{gt("when required by law, court order, or to protect the rights and safety of users and the public")}</li>
          <li><strong className="text-white">{gt("Business transfers:")}</strong>{" "}{gt("in connection with a merger, acquisition, or sale of assets")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("5. Data Retention")}</H>
        <p>
          {gt("We retain your account information for as long as your account is active. Messages and content may be stored as long as the server or conversation exists. You may request deletion of your account and associated data by contacting us.")}
        </p>
      </section>

      <section>
        <H>{gt("6. Your Rights")}</H>
        <p>{gt("Depending on your location, you may have the right to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Access the personal data we hold about you")}</li>
          <li>{gt("Request correction of inaccurate data")}</li>
          <li>{gt("Request deletion of your data")}</li>
          <li>{gt("Object to or restrict certain processing")}</li>
          <li>{gt("Data portability")}</li>
        </ul>
        <p className="mt-3">{gt("To exercise these rights, contact us at")}{" "}<a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.</p>
      </section>

      <section>
        <H>{gt("7. Cookies")}</H>
        <p>
          {gt("We use cookies and similar technologies to authenticate sessions and maintain your preferences. Session cookies are essential for the Services to function. We do not use third-party advertising cookies.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Children's Privacy")}</H>
        <p>
          {gt("The Services are not directed to children under 16. We do not knowingly collect personal information from children under 16. If we become aware of such collection, we will promptly delete the information.")}
        </p>
      </section>

      <section>
        <H>{gt("9. Security")}</H>
        <p>
          {gt("We implement industry-standard security measures including encryption in transit (TLS), hashed passwords, and access controls. However, no system is completely secure and we cannot guarantee absolute security of your data.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Changes to This Policy")}</H>
        <p>
          {gt("We may update this Privacy Policy periodically. We will notify you of material changes by updating the \"Last updated\" date and, where appropriate, through in-app notification.")}
        </p>
      </section>

      <section>
        <H>{gt("11. Contact Us")}</H>
        <p>
          {gt("For privacy-related questions or requests, contact Serika Company at")}{" "}
          <a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.
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
        <H>{gt("1. Introduction and Scope")}</H>
        <p>
          {gt("This Privacy Policy (\"Policy\") explains how")}{" "}
          <strong className="text-white">{gt("Serika Company")}</strong>{" "}
          {gt("and its affiliates (collectively, \"Serika\", \"we\", \"us\", or \"our\") collect, use, disclose, retain, and otherwise process personal information in connection with SerikaCord and any associated websites, mobile or desktop applications, application programming interfaces (APIs), bots, and other online products and services that link to this Policy (collectively, the \"Services\").")}
        </p>
        <p className="mt-3">
          {gt("This Policy applies to information about identified or identifiable individuals (\"personal data\" or \"personal information\"). It does not apply to aggregated or de-identified information that cannot reasonably be used to identify you. By accessing or using the Services, you acknowledge that you have read and understood this Policy. If you do not agree with it, you must not access or use the Services.")}
        </p>
        <p className="mt-3">
          {gt("Where we act as a \"data controller\" (or equivalent) we determine the purposes and means of processing your personal data. In limited circumstances — for example, content you post within a server operated by another user — that server's operator may act as an independent controller with respect to their own use of your information.")}
        </p>
      </section>

      <section>
        <H>{gt("2. Roles: Controller and Processor")}</H>
        <p>
          {gt("For account, billing, security, and platform-operation purposes, Serika is the controller of your personal data. For user-generated content that you share within communities (\"servers\"), direct messages, and group chats, Serika processes that content to operate the Services, but the community, its owner, and its moderators may independently access, moderate, retain, or remove content within their community consistent with their own policies. We are not responsible for the independent practices of community operators.")}
        </p>
      </section>

      <section>
        <H>{gt("3. Categories of Information We Collect")}</H>
        <H3>{gt("3.1 Information you provide to us")}</H3>
        <ul className="list-disc list-inside space-y-1">
          <li><strong className="text-white">{gt("Registration data:")}</strong>{" "}{gt("email address, username, display name, date of birth or age confirmation, and a cryptographically hashed representation of your password.")}</li>
          <li><strong className="text-white">{gt("Profile data:")}</strong>{" "}{gt("avatar, banner, nameplate, biography, pronouns, custom status, connected accounts, and other optional profile fields.")}</li>
          <li><strong className="text-white">{gt("Content:")}</strong>{" "}{gt("messages, attachments, images, audio, video, voice communications, reactions, embeds, and any other content you create, upload, or transmit.")}</li>
          <li><strong className="text-white">{gt("Payment data:")}</strong>{" "}{gt("billing name, billing address, and transaction records. Full payment card numbers are collected and processed by our third-party payment processors; we do not store complete card numbers on our systems.")}</li>
          <li><strong className="text-white">{gt("Support and communications:")}</strong>{" "}{gt("information you provide when you contact support, report abuse, participate in surveys, or otherwise communicate with us.")}</li>
        </ul>
        <H3>{gt("3.2 Information collected automatically")}</H3>
        <ul className="list-disc list-inside space-y-1">
          <li><strong className="text-white">{gt("Device and network data:")}</strong>{" "}{gt("IP address, device and hardware identifiers, browser type, operating system, language settings, and approximate location derived from IP address.")}</li>
          <li><strong className="text-white">{gt("Usage data:")}</strong>{" "}{gt("features accessed, pages and screens viewed, clicks, session duration, referral URLs, connection timestamps, voice-channel presence, and diagnostic or crash logs.")}</li>
          <li><strong className="text-white">{gt("Cookies and similar technologies:")}</strong>{" "}{gt("session identifiers, authentication tokens, and preference cookies as described in Section 9.")}</li>
        </ul>
        <H3>{gt("3.3 Information from third parties")}</H3>
        <p>
          {gt("If you link a third-party account (for example, an OAuth login or an external identity provider such as serika.moe), we receive information from that provider in accordance with your authorization and their privacy practices, such as your account identifier, username, and any activity data you have elected to share.")}
        </p>
      </section>

      <section>
        <H>{gt("4. How and Why We Use Your Information (Purposes)")}</H>
        <p>{gt("We process personal data for the following purposes:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("To provide, maintain, operate, and secure the Services, including authentication, message delivery, and voice communication.")}</li>
          <li>{gt("To create and manage your account and to enable features you request.")}</li>
          <li>{gt("To process payments, subscriptions, refunds, and to prevent payment fraud.")}</li>
          <li>{gt("To personalize your experience, remember preferences, and provide relevant features.")}</li>
          <li>{gt("To communicate with you about the Services, including transactional messages, service announcements, and, where permitted, marketing communications.")}</li>
          <li>{gt("To provide customer support and to investigate and respond to your inquiries and reports.")}</li>
          <li>{gt("To monitor, detect, prevent, and address fraud, abuse, security incidents, spam, and violations of our Terms of Service and community guidelines.")}</li>
          <li>{gt("To conduct analytics, research, and product development to improve and develop the Services.")}</li>
          <li>{gt("To comply with legal obligations, enforce our agreements, and establish, exercise, or defend legal claims.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("5. Legal Bases for Processing (EEA/UK)")}</H>
        <p>
          {gt("If you are located in the European Economic Area, the United Kingdom, or Switzerland, we process your personal data only where we have a valid legal basis, namely:")}
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li><strong className="text-white">{gt("Contract:")}</strong>{" "}{gt("processing necessary to perform our agreement with you and provide the Services.")}</li>
          <li><strong className="text-white">{gt("Legitimate interests:")}</strong>{" "}{gt("processing necessary for our legitimate interests, such as securing the Services, preventing abuse, and improving our products, provided those interests are not overridden by your rights.")}</li>
          <li><strong className="text-white">{gt("Consent:")}</strong>{" "}{gt("where you have given consent, such as for certain optional cookies or marketing. You may withdraw consent at any time.")}</li>
          <li><strong className="text-white">{gt("Legal obligation:")}</strong>{" "}{gt("processing necessary to comply with our legal and regulatory obligations.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("6. How We Share and Disclose Information")}</H>
        <p>
          {gt("We do not sell your personal data, and we do not \"share\" it for cross-context behavioral advertising as those terms are defined under applicable law. We may disclose personal data in the following circumstances:")}
        </p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li><strong className="text-white">{gt("With other users:")}</strong>{" "}{gt("your username, display name, avatar, status, and content are visible to other users according to the communities you join and the settings you choose.")}</li>
          <li><strong className="text-white">{gt("With service providers and processors:")}</strong>{" "}{gt("hosting, storage, content delivery, payment processing, analytics, and communications vendors who process data on our behalf under contractual confidentiality and data-protection obligations.")}</li>
          <li><strong className="text-white">{gt("For legal reasons:")}</strong>{" "}{gt("to comply with applicable law, regulation, legal process, or enforceable governmental request; to enforce our Terms; to detect or prevent fraud, security, or technical issues; or to protect the rights, property, or safety of Serika, our users, or the public.")}</li>
          <li><strong className="text-white">{gt("In corporate transactions:")}</strong>{" "}{gt("in connection with a merger, acquisition, financing, reorganization, bankruptcy, or sale of all or part of our assets, in which case personal data may be transferred as part of that transaction.")}</li>
          <li><strong className="text-white">{gt("With your consent or at your direction:")}</strong>{" "}{gt("for any other purpose disclosed to you at the time we collect the information or with your permission.")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("7. International Data Transfers")}</H>
        <p>
          {gt("We and our service providers may process and store personal data in countries other than the one in which you reside, including in jurisdictions that may not provide the same level of data protection as your home country. Where we transfer personal data internationally, we implement appropriate safeguards, such as Standard Contractual Clauses or other lawful transfer mechanisms, to protect your information.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Data Retention")}</H>
        <p>
          {gt("We retain personal data for as long as necessary to fulfill the purposes described in this Policy, unless a longer retention period is required or permitted by law. Account information is generally retained while your account remains active. Content may persist as long as the server, channel, or conversation in which it was shared exists, and copies may remain in backups for a limited period. When you delete your account, we delete or de-identify your personal data within a commercially reasonable period, except where retention is necessary for legal compliance, dispute resolution, fraud prevention, safety, or enforcement of our agreements.")}
        </p>
      </section>

      <section>
        <H>{gt("9. Cookies and Similar Technologies")}</H>
        <p>
          {gt("We use cookies, local storage, and similar technologies to operate and secure the Services. These include strictly necessary cookies that authenticate your session and enable core functionality, and preference cookies that remember your settings. Strictly necessary cookies cannot be disabled without impairing the Services. We do not use third-party advertising cookies. You can control non-essential cookies through your browser settings; disabling certain cookies may affect functionality.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Your Rights and Choices")}</H>
        <p>{gt("Subject to applicable law and verification of your identity, you may have the right to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Access and obtain a copy of the personal data we hold about you.")}</li>
          <li>{gt("Rectify inaccurate or incomplete personal data.")}</li>
          <li>{gt("Erase your personal data (\"right to be forgotten\").")}</li>
          <li>{gt("Restrict or object to certain processing, including processing based on legitimate interests.")}</li>
          <li>{gt("Data portability — receive your data in a structured, commonly used, machine-readable format.")}</li>
          <li>{gt("Withdraw consent at any time, without affecting the lawfulness of prior processing.")}</li>
          <li>{gt("Lodge a complaint with your local data protection authority.")}</li>
        </ul>
        <p className="mt-3">
          {gt("To exercise these rights, contact us at")}{" "}
          <a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.{" "}
          {gt("We will not discriminate against you for exercising your rights. We may need to verify your identity before responding, and we will respond within the timeframe required by applicable law.")}
        </p>
      </section>

      <section>
        <H>{gt("11. U.S. State Privacy Rights")}</H>
        <p>
          {gt("Depending on your state of residence (including California, Colorado, Connecticut, Virginia, Utah, and other states with comprehensive privacy laws), you may have rights to know, access, correct, delete, and obtain a portable copy of your personal information, and to opt out of the sale or \"sharing\" of personal information and of certain targeted advertising and profiling. We do not sell or share personal information as those terms are defined under these laws. California residents may also request information about our disclosure practices. You may exercise these rights, including through an authorized agent, by contacting")}{" "}
          <a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.
        </p>
      </section>

      <section>
        <H>{gt("12. Children's Privacy")}</H>
        <p>
          {gt("The Services are not directed to, and we do not knowingly collect personal information from, children under the age of 16 (or the higher minimum age required in your jurisdiction). If you are a parent or guardian and believe your child has provided us with personal information without appropriate consent, please contact us and we will take steps to delete such information. If we learn that we have collected personal data from a child in violation of applicable law, we will promptly delete it.")}
        </p>
      </section>

      <section>
        <H>{gt("13. Security")}</H>
        <p>
          {gt("We maintain administrative, technical, and organizational safeguards designed to protect personal data, including encryption in transit (TLS), hashing of passwords, access controls, and monitoring. Despite these measures, no method of transmission or storage is completely secure, and we cannot guarantee absolute security. You are responsible for maintaining the confidentiality of your credentials and for activity that occurs under your account. If we become aware of a security incident affecting your personal data, we will notify you and the relevant authorities as required by applicable law.")}
        </p>
      </section>

      <section>
        <H>{gt("14. Third-Party Links and Services")}</H>
        <p>
          {gt("The Services may contain links to, or integrations with, third-party websites, applications, bots, or services that we do not operate or control. This Policy does not apply to those third parties, and we are not responsible for their privacy practices. We encourage you to review the privacy policies of any third party before providing them with your information.")}
        </p>
      </section>

      <section>
        <H>{gt("15. Changes to This Policy")}</H>
        <p>
          {gt("We may update this Policy from time to time. When we make material changes, we will update the \"Last updated\" date above and, where required by law or otherwise appropriate, provide additional notice through the Services or by other means. Your continued use of the Services after the effective date of an updated Policy constitutes your acceptance of the changes.")}
        </p>
      </section>

      <section>
        <H>{gt("16. Contact Us")}</H>
        <p>
          {gt("If you have questions, concerns, or requests regarding this Policy or our data practices, contact Serika Company at")}{" "}
          <a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.
        </p>
      </section>
    </>
  );

  return (
    <LegalDocument
      badge={gt("Legal")}
      title={gt("Privacy Policy")}
      updated={gt("Last updated: July 19, 2026 · Effective: July 19, 2026")}
      navLink={{ href: "/terms", label: gt("Terms of Service") }}
      footerLink={{ href: "/terms", label: gt("Terms of Service") }}
      copyright={gt("© 2026 Serika Company. All rights reserved.")}
      simple={simple}
      legal={legal}
    />
  );
}
