import Link from "next/link";
import { Logo } from "@/components/ui/Logo";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";

export const metadata = buildMetadata({
  title: "Community Guidelines",
  description:
    "Read the SerikaCord Community Guidelines. Learn the rules for respectful, safe, and positive interactions across servers, DMs, and public spaces.",
  path: "/guidelines",
  keywords: [
    "SerikaCord community guidelines",
    "SerikaCord rules",
    "community standards",
    "acceptable use",
    "safety",
  ],
});

export default async function GuidelinesPage() {
  const gt = await getGT();
  return (
    <div className="min-h-screen bg-[#000] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000]/80 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <div className="flex items-center gap-4 text-sm text-[#888]">
            <Link href="/terms" className="hover:text-white transition-colors">{gt("Terms")}</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">{gt("Privacy")}</Link>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-28 pb-20">
        <p className="text-sm text-[#8B5CF6] font-medium mb-3">{gt("Legal")}</p>
        <h1 className="text-4xl font-bold mb-2">{gt("Community Guidelines")}</h1>
        <p className="text-[#555] text-sm mb-10">{gt("Last updated: June 29, 2026")}</p>

        <p className="text-[#aaa] leading-relaxed mb-10">
          {gt("SerikaCord is built for communities. To keep it a place where everyone can talk, hang out, and build together, we ask all users to follow these guidelines. Violations may result in content removal, warnings, or account termination depending on severity.")}
        </p>

        <div className="space-y-8 text-[#aaa] leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("1. Respect Everyone")}</h2>
            <p>{gt("Treat all users with basic respect. Do not harass, bully, threaten, or intimidate others — in public channels, DMs, or any other context on the platform. Targeted hate or discrimination based on race, ethnicity, gender, sexual orientation, religion, disability, or national origin is strictly prohibited.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("2. No Illegal Content")}</h2>
            <p>{gt("You must not share content that is illegal under applicable law. This includes, but is not limited to:")}</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>{gt("Child sexual abuse material (CSAM) — zero tolerance, immediately reported to authorities")}</li>
              <li>{gt("Content that facilitates real-world violence or terrorism")}</li>
              <li>{gt("Doxxing (sharing private personal information without consent)")}</li>
              <li>{gt("Pirated software, media, or copyrighted content distributed without authorisation")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("3. No Spam or Manipulation")}</h2>
            <p>{gt("Do not send unsolicited bulk messages, run automated bots without server permission, or attempt to manipulate users through deceptive means. This includes phishing links, misleading invites, or artificially inflating server metrics.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("4. Age-Restricted Content")}</h2>
            <p>{gt("Explicit or adult content may only be shared in servers and channels explicitly designated for that purpose by server administrators, and only where permitted under local law. It must never be accessible to users under 18 or in general/unaged channels.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("5. No Platform Abuse")}</h2>
            <p>{gt("Do not attempt to exploit, reverse-engineer, or disrupt the Services. This includes:")}</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>{gt("Attempting unauthorised access to accounts or systems")}</li>
              <li>{gt("Distributing malware or exploits through the platform")}</li>
              <li>{gt("Running API bots that abuse rate limits or bypass restrictions")}</li>
              <li>{gt("Creating fake accounts or impersonating real users or staff")}</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("6. Server Responsibility")}</h2>
            <p>{gt("Server owners and administrators are responsible for maintaining community standards within their servers. Servers that consistently host content violating these guidelines may be removed from the platform. Server owners must ensure appropriate moderation is in place, especially for large or public communities.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("7. Authentic Identity")}</h2>
            <p>{gt("You may not impersonate Serika Company staff, other users, public figures, or any entity in a way that is deceptive or misleading. Parody accounts must be clearly labelled as such.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("8. Self-Harm & Crisis Content")}</h2>
            <p>{gt("Content that promotes, glorifies, or provides instruction for self-harm or suicide is not permitted. If you or someone you know is in crisis, please reach out to a local crisis line or emergency services.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("9. Enforcement")}</h2>
            <p>{gt("Serika Company reserves the right to remove content, issue warnings, restrict features, or permanently ban accounts that violate these guidelines. We aim to be proportionate, but some violations — particularly those involving CSAM, violence, or serious platform abuse — result in immediate permanent action and law enforcement referral where required.")}</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("10. Reporting")}</h2>
            <p>
              {gt("If you encounter content or behaviour that violates these guidelines, please report it through the in-app reporting tools or contact us at")}{" "}
              <a href="mailto:safety@serika.dev" className="text-[#8B5CF6] hover:underline">safety@serika.dev</a>.
              {gt("We take all reports seriously and review them promptly.")}
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-semibold mb-3">{gt("11. Updates")}</h2>
            <p>{gt("These guidelines may be updated from time to time to reflect the evolving needs of our community and platform. Continued use of the Services after changes are posted constitutes acceptance of the updated guidelines.")}</p>
          </section>

        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-4 text-sm text-[#444]">
          <span>{gt("© 2026 Serika Company. All rights reserved.")}</span>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="text-[#8B5CF6] hover:underline">{gt("Terms of Service")}</Link>
            <Link href="/privacy" className="text-[#8B5CF6] hover:underline">{gt("Privacy Policy")}</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
