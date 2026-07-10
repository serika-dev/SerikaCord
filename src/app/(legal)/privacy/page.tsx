import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

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
  return (
    <div className="min-h-screen bg-[#000] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000]/80 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link href="/terms" className="text-sm text-[#888] hover:text-white transition-colors">
            {gt("Terms of Service")} →
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-28 pb-20">
        <p className="text-sm text-[#8B5CF6] font-medium mb-3">{gt("Legal")}</p>
        <h1 className="text-4xl font-bold mb-2">{gt("Privacy Policy")}</h1>
        <p className="text-[#555] text-sm mb-10">{gt("Last updated: June 29, 2026 · Effective: June 29, 2026")}</p>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-[#aaa] leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("1. About This Policy")}</h2>
            <p>
              {gt("This Privacy Policy describes how")}{" "}<strong className="text-white">{gt("Serika Company")}</strong>{" "}{gt("(\"Serika\", \"we\", \"us\", or \"our\") collects, uses, and shares information when you use SerikaCord and related services (the \"Services\"). We are committed to protecting your privacy and handling your data transparently.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("2. Information We Collect")}</h2>
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
            <h2 className="text-white text-xl font-semibold mb-3">{gt("3. How We Use Your Information")}</h2>
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
            <h2 className="text-white text-xl font-semibold mb-3">{gt("4. Information Sharing")}</h2>
            <p>{gt("We do not sell your personal data. We may share information:")}</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong className="text-white">{gt("With other users:")}</strong>{" "}{gt("your username, display name, avatar, and status are visible to users you interact with")}</li>
              <li><strong className="text-white">{gt("Service providers:")}</strong>{" "}{gt("third-party vendors who assist in operating the Services under strict confidentiality agreements")}</li>
              <li><strong className="text-white">{gt("Legal compliance:")}</strong>{" "}{gt("when required by law, court order, or to protect the rights and safety of users and the public")}</li>
              <li><strong className="text-white">{gt("Business transfers:")}</strong>{" "}{gt("in connection with a merger, acquisition, or sale of assets")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("5. Data Retention")}</h2>
            <p>
              {gt("We retain your account information for as long as your account is active. Messages and content may be stored as long as the server or conversation exists. You may request deletion of your account and associated data by contacting us.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("6. Your Rights")}</h2>
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
            <h2 className="text-white text-xl font-semibold mb-3">{gt("7. Cookies")}</h2>
            <p>
              {gt("We use cookies and similar technologies to authenticate sessions and maintain your preferences. Session cookies are essential for the Services to function. We do not use third-party advertising cookies.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("8. Children's Privacy")}</h2>
            <p>
              {gt("The Services are not directed to children under 13. We do not knowingly collect personal information from children under 13. If we become aware of such collection, we will promptly delete the information.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("9. Security")}</h2>
            <p>
              {gt("We implement industry-standard security measures including encryption in transit (TLS), hashed passwords, and access controls. However, no system is completely secure and we cannot guarantee absolute security of your data.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("10. Changes to This Policy")}</h2>
            <p>
              {gt("We may update this Privacy Policy periodically. We will notify you of material changes by updating the \"Last updated\" date and, where appropriate, through in-app notification.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("11. Contact Us")}</h2>
            <p>
              {gt("For privacy-related questions or requests, contact Serika Company at")}{" "}
              <a href="mailto:privacy@serika.dev" className="text-[#8B5CF6] hover:underline">privacy@serika.dev</a>.
            </p>
          </section>
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex items-center justify-between text-sm text-[#444]">
          <span>{gt("© 2026 Serika Company. All rights reserved.")}</span>
          <Link href="/terms" className="text-[#8B5CF6] hover:underline">{gt("Terms of Service")}</Link>
        </div>
      </main>
    </div>
  );
}
