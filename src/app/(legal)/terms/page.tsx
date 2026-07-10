import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

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
  return (
    <div className="min-h-screen bg-[#000] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000]/80 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link href="/privacy" className="text-sm text-[#888] hover:text-white transition-colors">
            {gt("Privacy Policy")} →
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-28 pb-20">
        <p className="text-sm text-[#8B5CF6] font-medium mb-3">{gt("Legal")}</p>
        <h1 className="text-4xl font-bold mb-2">{gt("Terms of Service")}</h1>
        <p className="text-[#555] text-sm mb-10">{gt("Last updated: June 29, 2026 · Effective: June 29, 2026")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-[#aaa] leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("1. Agreement to Terms")}</h2>
            <p>
              {gt("These Terms of Service (\"Terms\") constitute a legally binding agreement between you and")}{" "}<strong className="text-white">{gt("Serika Company")}</strong>{" "}{gt("(\"Serika\", \"we\", \"us\", or \"our\"), governing your access to and use of SerikaCord, including our website, APIs, and all related services (collectively, the \"Services\").")}
            </p>
            <p className="mt-3">
              {gt("By accessing or using the Services, you confirm that you are at least 13 years of age, have read and understood these Terms, and agree to be bound by them. If you do not agree, you must not use the Services.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("2. The Services")}</h2>
            <p>
              {gt("SerikaCord provides real-time messaging, voice communication, community server creation, and related features. We reserve the right to modify, suspend, or discontinue any part of the Services at any time with or without notice.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("3. Your Account")}</h2>
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
            <h2 className="text-white text-xl font-semibold mb-3">{gt("4. Acceptable Use")}</h2>
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
            <h2 className="text-white text-xl font-semibold mb-3">{gt("5. Content")}</h2>
            <p>
              {gt("You retain ownership of content you post to the Services. By posting content, you grant Serika Company a non-exclusive, royalty-free, worldwide license to host, store, transmit, and display your content solely for the purpose of providing the Services.")}
            </p>
            <p className="mt-3">
              {gt("You are solely responsible for content you post. We do not endorse or assume liability for any user content.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("6. Serika+ Subscriptions")}</h2>
            <p>
              {gt("Serika+ is a paid subscription offering premium features. Subscriptions are billed in advance and are non-refundable except as required by applicable law. Serika Company reserves the right to change subscription pricing with 30 days notice.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("7. Intellectual Property")}</h2>
            <p>
              {gt("The Services, including all software, designs, logos, and trademarks, are owned by Serika Company and protected by applicable intellectual property laws. You may not copy, modify, or distribute our proprietary materials without written permission.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("8. Disclaimer of Warranties")}</h2>
            <p>
              {gt("The Services are provided \"as is\" and \"as available\" without warranties of any kind, express or implied. Serika Company does not warrant that the Services will be uninterrupted, error-free, or free of harmful components.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("9. Limitation of Liability")}</h2>
            <p>
              {gt("To the maximum extent permitted by law, Serika Company shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Services, even if we have been advised of the possibility of such damages.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("10. Governing Law")}</h2>
            <p>
              {gt("These Terms are governed by and construed in accordance with applicable law. Any disputes arising under these Terms shall be resolved through binding arbitration or in the courts of competent jurisdiction.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("11. Changes to Terms")}</h2>
            <p>
              {gt("We may update these Terms from time to time. We will notify you of material changes by posting the updated Terms and updating the \"Last updated\" date above. Continued use of the Services after changes constitutes acceptance.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("12. Contact")}</h2>
            <p>
              {gt("If you have questions about these Terms, please contact us at")}{" "}
              <a href="mailto:legal@serika.dev" className="text-[#8B5CF6] hover:underline">legal@serika.dev</a>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex items-center justify-between text-sm text-[#444]">
          <span>{gt("© 2026 Serika Company. All rights reserved.")}</span>
          <Link href="/privacy" className="text-[#8B5CF6] hover:underline">{gt("Privacy Policy")}</Link>
        </div>
      </main>
    </div>
  );
}
