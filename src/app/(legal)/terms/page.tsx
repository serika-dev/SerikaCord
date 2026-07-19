import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { LegalDocument } from "@/components/legal/LegalDocument";

export const metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "Read the SerikaCord Terms of Service. Understand the rules for using our messaging platform, accounts, subscriptions, content, and intellectual property.",
  path: "/terms",
  keywords: [
    "SerikaCord terms of service",
    "Serika terms",
    "user agreement",
    "Serika+ subscription",
    "acceptable use",
  ],
});

export default async function TermsPage() {
  const gt = await getGT();

  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 className="text-white text-xl font-semibold mb-3">{children}</h2>
  );

  // ------------------------------------------------------------------
  // SIMPLE — plain-language summary
  // ------------------------------------------------------------------
  const simple = (
    <>
      <section>
        <H>{gt("1. Agreement to Terms")}</H>
        <p>
          {gt("These Terms of Service (\"Terms\") constitute a legally binding agreement between you and")}{" "}
          <strong className="text-white">{gt("Serika Company")}</strong>{" "}
          {gt("(\"Serika\", \"we\", \"us\", or \"our\"), governing your access to and use of SerikaCord, including our website, APIs, and all related services (collectively, the \"Services\").")}
        </p>
        <p className="mt-3">
          {gt("By accessing or using the Services, you confirm that you are at least 16 years of age, have read and understood these Terms, and agree to be bound by them. If you do not agree, you must not use the Services.")}
        </p>
      </section>

      <section>
        <H>{gt("2. The Services")}</H>
        <p>
          {gt("SerikaCord provides real-time messaging, voice communication, community server creation, and related features. We reserve the right to modify, suspend, or discontinue any part of the Services at any time with or without notice.")}
        </p>
      </section>

      <section>
        <H>{gt("3. Your Account")}</H>
        <p>{gt("You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account. You must:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Provide accurate registration information")}</li>
          <li>{gt("Keep your password secure")}</li>
          <li>{gt("Notify us immediately of any unauthorized use")}</li>
          <li>{gt("Not share your account with others")}</li>
        </ul>
        <p className="mt-3">{gt("We reserve the right to suspend or terminate accounts that violate these Terms.")}</p>
      </section>

      <section>
        <H>{gt("4. Acceptable Use")}</H>
        <p>{gt("You agree not to use the Services to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Violate any applicable laws or regulations")}</li>
          <li>{gt("Harass, abuse, threaten, or harm others")}</li>
          <li>{gt("Distribute spam, malware, or malicious content")}</li>
          <li>{gt("Share illegal content including CSAM")}</li>
          <li>{gt("Impersonate other individuals or entities")}</li>
          <li>{gt("Attempt to gain unauthorized access to our systems")}</li>
          <li>{gt("Interfere with or disrupt the Services")}</li>
        </ul>
      </section>

      <section>
        <H>{gt("5. Content")}</H>
        <p>
          {gt("You retain ownership of content you post to the Services. By posting content, you grant Serika Company a non-exclusive, royalty-free, worldwide license to host, store, transmit, and display your content solely for the purpose of providing the Services.")}
        </p>
        <p className="mt-3">
          {gt("You are solely responsible for content you post. We do not endorse or assume liability for any user content.")}
        </p>
      </section>

      <section>
        <H>{gt("6. Serika+ Subscriptions")}</H>
        <p>
          {gt("Serika+ is a paid subscription offering premium features. Subscriptions are billed in advance and are non-refundable except as required by applicable law. Serika Company reserves the right to change subscription pricing with 30 days notice.")}
        </p>
      </section>

      <section>
        <H>{gt("7. Intellectual Property")}</H>
        <p>
          {gt("The Services, including all software, designs, logos, and trademarks, are owned by Serika Company and protected by applicable intellectual property laws. You may not copy, modify, or distribute our proprietary materials without written permission.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Disclaimer of Warranties")}</H>
        <p>
          {gt("The Services are provided \"as is\" and \"as available\" without warranties of any kind, express or implied. Serika Company does not warrant that the Services will be uninterrupted, error-free, or free of harmful components.")}
        </p>
      </section>

      <section>
        <H>{gt("9. Limitation of Liability")}</H>
        <p>
          {gt("To the maximum extent permitted by law, Serika Company shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Services, even if we have been advised of the possibility of such damages.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Governing Law")}</H>
        <p>
          {gt("These Terms are governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved through binding arbitration or in the courts of competent jurisdiction.")}
        </p>
      </section>

      <section>
        <H>{gt("11. Changes to Terms")}</H>
        <p>
          {gt("We may update these Terms from time to time. We will notify you of material changes by posting the updated Terms and updating the \"Last updated\" date above. Continued use of the Services after changes constitutes acceptance.")}
        </p>
      </section>

      <section>
        <H>{gt("12. Contact")}</H>
        <p>
          {gt("If you have questions about these Terms, please contact us at")}{" "}
          <a href="mailto:legal@serika.dev" className="text-[#8B5CF6] hover:underline">legal@serika.dev</a>.
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
        <H>{gt("1. Agreement to Terms")}</H>
        <p>
          {gt("These Terms of Service (\"Terms\") constitute a legally binding agreement between you (\"you\" or \"User\") and")}{" "}
          <strong className="text-white">{gt("Serika Company")}</strong>{" "}
          {gt("and its affiliates (collectively, \"Serika\", \"we\", \"us\", or \"our\"), governing your access to and use of SerikaCord, including our websites, applications, APIs, bots, and all related products, features, and services (collectively, the \"Services\").")}
        </p>
        <p className="mt-3">
          {gt("By creating an account, or by accessing or using the Services, you represent and warrant that you are at least 16 years of age (or the higher minimum age required in your jurisdiction), that you have the legal capacity to enter into these Terms, and that you have read, understood, and agree to be bound by these Terms and our Privacy Policy, which is incorporated by reference. If you use the Services on behalf of an organization, you represent that you are authorized to bind that organization, and \"you\" refers to that organization. If you do not agree, you must not access or use the Services.")}
        </p>
      </section>

      <section>
        <H>{gt("2. Eligibility and Age Requirements")}</H>
        <p>
          {gt("The Services are not available to any User previously removed from the Services by Serika, or to any person barred from receiving the Services under applicable law. You must not use the Services if you are under 16 years of age. Where a community, feature, or applicable law imposes a higher minimum age, you must meet that requirement. You are responsible for ensuring that your use of the Services complies with all laws applicable to you.")}
        </p>
      </section>

      <section>
        <H>{gt("3. The Services and Modifications")}</H>
        <p>
          {gt("SerikaCord provides real-time text messaging, voice and video communication, community server creation and management, direct and group messaging, bots and integrations, and related features. We continuously develop the Services and may add, change, suspend, limit, or discontinue any part of the Services, temporarily or permanently, with or without notice. We are not liable to you or any third party for any such modification, suspension, or discontinuation, except as expressly provided in these Terms.")}
        </p>
      </section>

      <section>
        <H>{gt("4. Accounts and Account Security")}</H>
        <p>{gt("To use most features you must register for an account. You agree to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Provide accurate, current, and complete registration information and keep it up to date.")}</li>
          <li>{gt("Maintain the confidentiality and security of your credentials and any authentication methods.")}</li>
          <li>{gt("Take responsibility for all activities that occur under your account.")}</li>
          <li>{gt("Notify us immediately of any unauthorized access to or use of your account or any other security breach.")}</li>
          <li>{gt("Not sell, transfer, license, or share your account or credentials with any third party.")}</li>
        </ul>
        <p className="mt-3">
          {gt("You are responsible for configuring and securing your own devices and networks. We are not liable for any loss or damage arising from your failure to comply with these obligations. We may reclaim or disable usernames or accounts at our discretion, including for inactivity, impersonation, trademark concerns, or violations of these Terms.")}
        </p>
      </section>

      <section>
        <H>{gt("5. Acceptable Use and Prohibited Conduct")}</H>
        <p>{gt("You agree not to, and not to attempt to, use the Services to:")}</p>
        <ul className="list-disc list-inside mt-2 space-y-1">
          <li>{gt("Violate any applicable law, regulation, or third-party right, including intellectual property, privacy, and publicity rights.")}</li>
          <li>{gt("Harass, bully, threaten, defame, stalk, or otherwise harm others, or incite others to do so.")}</li>
          <li>{gt("Transmit spam, chain messages, pyramid schemes, or engage in unsolicited advertising.")}</li>
          <li>{gt("Distribute malware, viruses, or any code of a destructive or disruptive nature.")}</li>
          <li>{gt("Upload, share, or facilitate access to illegal content, including child sexual abuse material (CSAM), which we report to the appropriate authorities.")}</li>
          <li>{gt("Promote, glorify, or organize violence, terrorism, self-harm, or hateful conduct against protected groups.")}</li>
          <li>{gt("Impersonate any person or entity, or misrepresent your affiliation with any person or entity.")}</li>
          <li>{gt("Access, tamper with, or use non-public areas of the Services, our systems, or the systems of our providers without authorization.")}</li>
          <li>{gt("Probe, scan, or test the vulnerability of any system or breach security or authentication measures.")}</li>
          <li>{gt("Scrape, crawl, harvest, or index the Services or any data except as expressly permitted through our published APIs and rate limits.")}</li>
          <li>{gt("Interfere with, disrupt, overload, or impair the integrity or performance of the Services, including through denial-of-service attacks or automated abuse.")}</li>
          <li>{gt("Circumvent, disable, or otherwise interfere with security-related features or usage limits.")}</li>
        </ul>
        <p className="mt-3">
          {gt("Communities and their moderators may establish additional rules for their spaces. You are responsible for complying with those rules in addition to these Terms and our community guidelines.")}
        </p>
      </section>

      <section>
        <H>{gt("6. User Content and License")}</H>
        <p>
          {gt("\"User Content\" means any content you create, upload, post, transmit, or display through the Services, including messages, images, audio, video, and files. As between you and Serika, you retain all ownership rights you have in your User Content.")}
        </p>
        <p className="mt-3">
          {gt("By making User Content available through the Services, you grant Serika a worldwide, non-exclusive, royalty-free, sublicensable, and transferable license to host, store, cache, reproduce, adapt (for technical purposes such as formatting and transcoding), publish, transmit, and display that User Content, solely as reasonably necessary to operate, provide, secure, and improve the Services. This license ends when you delete your User Content, except to the extent it has been shared with others who have not deleted it, or where retention is required by law, backup processes, or the Services' normal operation.")}
        </p>
        <p className="mt-3">
          {gt("You represent and warrant that you own or have the necessary rights to your User Content and that it does not infringe or violate the rights of any third party or any law. You are solely responsible for your User Content and the consequences of sharing it. We do not endorse, and we assume no liability for, any User Content.")}
        </p>
      </section>

      <section>
        <H>{gt("7. Content Moderation and Enforcement")}</H>
        <p>
          {gt("We are not obligated to monitor User Content, but we may review, screen, and moderate content and conduct. We may, at our sole discretion and without liability, remove or restrict access to any content, and warn, suspend, limit, or terminate any account, for any violation of these Terms, our community guidelines, or applicable law, or where necessary to protect users, third parties, or Serika. Where feasible and lawful, we will provide notice and, where appropriate, an opportunity to appeal enforcement decisions.")}
        </p>
      </section>

      <section>
        <H>{gt("8. Intellectual Property; Feedback")}</H>
        <p>
          {gt("The Services and all associated software, source code, designs, text, graphics, logos, and trademarks (excluding User Content) are owned by Serika or its licensors and are protected by intellectual property and other laws. Subject to your compliance with these Terms, we grant you a limited, revocable, non-exclusive, non-transferable, non-sublicensable license to access and use the Services for your personal, non-commercial use, or your internal business use where applicable. You may not copy, modify, distribute, sell, lease, reverse engineer, or create derivative works of any part of the Services except as expressly permitted by law or by us in writing.")}
        </p>
        <p className="mt-3">
          {gt("If you submit suggestions, ideas, or feedback about the Services, you grant us an unrestricted, perpetual, irrevocable, royalty-free license to use them for any purpose without obligation or compensation to you.")}
        </p>
      </section>

      <section>
        <H>{gt("9. Third-Party Services, Bots, and Integrations")}</H>
        <p>
          {gt("The Services may allow you to access or interact with third-party websites, applications, bots, and integrations that we do not own or control. Your use of such third-party services is governed by their terms and privacy policies, not these Terms. We are not responsible or liable for third-party services, and their availability through the Services does not constitute an endorsement.")}
        </p>
        <p className="mt-3">
          {gt("Discord bridge. Servers may bridge a Discord server to SerikaCord. When you use the bridge, you also agree to Discord's Terms of Service, Developer Terms of Service, and Developer Policy. The bridge is consent-based: messages sent by a Discord user are not processed or mirrored unless that user has agreed to data processing by Serika, and messages sent by a SerikaCord user are not forwarded to Discord unless that user has enabled \"Allow data processing by Discord\" in their settings. Consent may be withdrawn at any time, and we will delete the associated bridged data. Data obtained through Discord's APIs is used solely to operate the bridge, is not sold or shared with advertisers or data brokers, and is deleted when it is no longer necessary or upon request by the user or by Discord.")}
        </p>
      </section>

      <section>
        <H>{gt("10. Serika+ Subscriptions, Billing, and Refunds")}</H>
        <p>
          {gt("Serika+ and other paid offerings provide premium features for a recurring or one-time fee. By purchasing a subscription, you authorize us and our payment processors to charge the applicable fees and any taxes to your selected payment method. Unless otherwise stated, subscriptions renew automatically at the end of each billing period until cancelled.")}
        </p>
        <p className="mt-3">
          {gt("You may cancel at any time; cancellation takes effect at the end of the current billing period, and you will retain access to paid features until then. Except where required by applicable law or expressly stated by us, fees are non-refundable and there are no refunds or credits for partial periods, unused features, or downgrades. We may change pricing or the features included in a paid plan; we will provide reasonable advance notice (at least 30 days for price increases affecting an active subscription), and changes apply at your next renewal. If a payment fails, we may suspend or downgrade your access to paid features.")}
        </p>
      </section>

      <section>
        <H>{gt("11. Termination")}</H>
        <p>
          {gt("You may stop using the Services and delete your account at any time. We may suspend or terminate your access to all or part of the Services at any time, with or without notice, for any conduct that we reasonably believe violates these Terms or applicable law, that harms other users or third parties, or that creates liability for or harm to Serika. Upon termination, your right to use the Services ceases immediately. Sections that by their nature should survive termination — including those regarding User Content licenses that remain in shared spaces, intellectual property, disclaimers, limitation of liability, indemnification, and dispute resolution — will survive.")}
        </p>
      </section>

      <section>
        <H>{gt("12. Disclaimers of Warranties")}</H>
        <p>
          {gt("TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SERVICES ARE PROVIDED \"AS IS\" AND \"AS AVAILABLE,\" WITH ALL FAULTS AND WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE, INCLUDING ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. SERIKA DOES NOT WARRANT THAT THE SERVICES WILL BE UNINTERRUPTED, SECURE, ACCURATE, ERROR-FREE, OR FREE OF HARMFUL COMPONENTS, OR THAT ANY CONTENT WILL BE PRESERVED OR AVAILABLE. SOME JURISDICTIONS DO NOT ALLOW THE EXCLUSION OF CERTAIN WARRANTIES, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.")}
        </p>
      </section>

      <section>
        <H>{gt("13. Limitation of Liability")}</H>
        <p>
          {gt("TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL SERIKA, ITS AFFILIATES, OR THEIR RESPECTIVE OFFICERS, DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES, ARISING OUT OF OR RELATING TO YOUR USE OF OR INABILITY TO USE THE SERVICES, WHETHER BASED ON WARRANTY, CONTRACT, TORT (INCLUDING NEGLIGENCE), OR ANY OTHER LEGAL THEORY, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.")}
        </p>
        <p className="mt-3">
          {gt("TO THE MAXIMUM EXTENT PERMITTED BY LAW, SERIKA'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THESE TERMS OR THE SERVICES WILL NOT EXCEED THE GREATER OF (A) THE AMOUNTS YOU PAID TO SERIKA FOR THE SERVICES IN THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS (US$100). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS OF LIABILITY, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.")}
        </p>
      </section>

      <section>
        <H>{gt("14. Indemnification")}</H>
        <p>
          {gt("To the maximum extent permitted by law, you agree to defend, indemnify, and hold harmless Serika, its affiliates, and their respective officers, directors, employees, and agents from and against any claims, liabilities, damages, losses, and expenses (including reasonable legal fees) arising out of or in any way connected with your access to or use of the Services, your User Content, your violation of these Terms, or your violation of any law or the rights of any third party.")}
        </p>
      </section>

      <section>
        <H>{gt("15. Governing Law and Dispute Resolution")}</H>
        <p>
          {gt("These Terms and any dispute arising out of or relating to them or the Services are governed by the laws applicable at Serika Company's principal place of business, without regard to conflict-of-laws principles, except where mandatory local consumer-protection laws provide otherwise. You and Serika agree to first attempt to resolve any dispute informally by contacting us. If a dispute is not resolved within a reasonable period, it will be resolved through binding arbitration or in the courts of competent jurisdiction, as permitted by applicable law. To the extent permitted by law, you and Serika agree that any dispute will be brought in an individual capacity and not as a plaintiff or class member in any purported class or representative proceeding. Nothing in this section prevents either party from seeking injunctive or equitable relief for infringement or misuse of intellectual property.")}
        </p>
      </section>

      <section>
        <H>{gt("16. Changes to These Terms")}</H>
        <p>
          {gt("We may revise these Terms from time to time. When we make material changes, we will update the \"Last updated\" date above and provide notice through the Services or by other reasonable means before the changes take effect. Your continued use of the Services after the effective date constitutes your acceptance of the revised Terms. If you do not agree to the changes, you must stop using the Services and may delete your account.")}
        </p>
      </section>

      <section>
        <H>{gt("17. General Provisions")}</H>
        <p>
          {gt("These Terms, together with the Privacy Policy and any additional terms you agree to, constitute the entire agreement between you and Serika regarding the Services and supersede any prior agreements. If any provision is held unenforceable, the remaining provisions will remain in full force and effect, and the unenforceable provision will be modified to the minimum extent necessary. Our failure to enforce any right or provision is not a waiver. You may not assign or transfer these Terms without our prior written consent; we may assign them without restriction. There are no third-party beneficiaries to these Terms. Any notices to you may be provided through the Services or to the contact information associated with your account.")}
        </p>
      </section>

      <section>
        <H>{gt("18. Contact")}</H>
        <p>
          {gt("If you have questions about these Terms, please contact us at")}{" "}
          <a href="mailto:legal@serika.dev" className="text-[#8B5CF6] hover:underline">legal@serika.dev</a>.
        </p>
      </section>
    </>
  );

  return (
    <LegalDocument
      badge={gt("Legal")}
      title={gt("Terms of Service")}
      updated={gt("Last updated: July 19, 2026 · Effective: July 19, 2026")}
      navLink={{ href: "/privacy", label: gt("Privacy Policy") }}
      footerLink={{ href: "/privacy", label: gt("Privacy Policy") }}
      copyright={gt("© 2026 Serika Company. All rights reserved.")}
      simple={simple}
      legal={legal}
    />
  );
}
