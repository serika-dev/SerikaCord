import type { ReactNode } from "react";
import Link from "next/link";
import { getGT } from "gt-next/server";
import { Bug, HelpCircle, Lock, Mail, ShieldAlert, UserCog } from "lucide-react";
import { buildMetadata } from "@/lib/seo";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeFooter } from "@/components/home/HomeFooter";
import { homeDisplayFont } from "@/components/home/displayFont";
import "@/components/home/home.css";

/**
 * /support: how to get help (also the App Store "Support URL"). Static, in
 * the homepage's design language (src/components/home/home.css).
 */
export const metadata = buildMetadata({
  title: "Support",
  description: "Get help with SerikaCord: email the team, report a bug, report abuse, or manage your account and data.",
  path: "/support",
  keywords: ["SerikaCord support", "SerikaCord help", "contact SerikaCord", "report a bug"],
});

const ISSUES_URL = "https://issues.serika.dev";
const ACCOUNTS_URL = "https://accounts.serika.dev";

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="hm-card !rounded-2xl p-5 sm:p-6">
      <div className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--hm-accent-text)]">
          {icon}
        </span>
        <h2 className="hm-display text-lg font-semibold text-[var(--hm-ink)] sm:text-xl">{title}</h2>
      </div>
      <div className="space-y-2 text-sm leading-relaxed text-[var(--hm-body)] sm:text-[0.95rem]">{children}</div>
    </section>
  );
}

function MailLink({ to }: { to: string }) {
  return (
    <a href={`mailto:${to}`} className="hm-link break-all">
      {to}
    </a>
  );
}

export default async function SupportPage() {
  const gt = await getGT();
  const icon = "h-5 w-5";

  return (
    <div className={`hm-root ${homeDisplayFont.variable}`}>
      <HomeHeader variant="site" current="/support" />
      <main id="main" tabIndex={-1} className="outline-none">
        <div className="hm-dark hm-hero pb-8 pt-[calc(5.5rem+var(--safe-area-top))] sm:pb-14 sm:pt-28">
          <header className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
            <p className="hm-label mb-2 sm:mb-3">{gt("Support")}</p>
            <h1 className="hm-display hm-h1 hm-h1-page">{gt("How can we help?")}</h1>
            <p className="hm-lede mt-3 max-w-2xl sm:mt-5">
              {gt("Get help with SerikaCord, report a problem or reach the team. SerikaCord is made by Serika Company in the Netherlands.")}
            </p>
          </header>
        </div>

        <div className="mx-auto grid max-w-[1200px] gap-4 px-4 pb-16 pt-8 sm:grid-cols-2 sm:gap-5 sm:px-6 sm:pt-12 lg:grid-cols-3 lg:px-10">
          <Card icon={<Mail className={icon} />} title={gt("Email us")}>
            <p>{gt("Questions about the app or your account? Write to us and a person on the team will answer.")}</p>
            <p>
              <MailLink to="support@serika.dev" />
            </p>
          </Card>

          <Card icon={<HelpCircle className={icon} />} title={gt("Frequently asked questions")}>
            <p>{gt("Quick answers about pricing, encryption, bots, devices and who runs SerikaCord.")}</p>
            <p>
              <Link href="/#faq" className="hm-link">
                {gt("Read the FAQ")}
              </Link>
            </p>
          </Card>

          <Card icon={<Bug className={icon} />} title={gt("Report a bug")}>
            <p>{gt("Search known issues or file a new report on the Serika issue tracker. In the app, you can also use Settings → Feedback & Bugs.")}</p>
            <p>
              <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer" className="hm-link">
                issues.serika.dev
              </a>
            </p>
          </Card>

          <Card icon={<ShieldAlert className={icon} />} title={gt("Safety and reporting abuse")}>
            <p>{gt("Report a message from its menu (press and hold it on a phone) and block someone from their profile. Server moderators can remove content, time out and ban members.")}</p>
            <p>
              {gt("For illegal content and urgent safety reports, email")} <MailLink to="safety@serika.dev" />.{" "}
              <Link href="/guidelines" className="hm-link">
                {gt("Community guidelines")}
              </Link>
            </p>
          </Card>

          <Card icon={<UserCog className={icon} />} title={gt("Your account")}>
            <p>{gt("Your sign-in, email address and password are managed by Serika Accounts. You can change them, or delete your account, there.")}</p>
            <p>
              <a href={ACCOUNTS_URL} target="_blank" rel="noopener noreferrer" className="hm-link">
                accounts.serika.dev
              </a>
            </p>
          </Card>

          <Card icon={<Lock className={icon} />} title={gt("Privacy and your data")}>
            <p>{gt("To see, download or delete your data, or for any other privacy question, email")} <MailLink to="privacy@serika.dev" />.</p>
            <p>
              <Link href="/privacy" className="hm-link">
                {gt("Privacy policy")}
              </Link>
              {" · "}
              <Link href="/terms" className="hm-link">
                {gt("Terms of service")}
              </Link>
            </p>
          </Card>
        </div>
      </main>
      <HomeFooter />
    </div>
  );
}
