import Link from "next/link";
import { getGT } from "gt-next/server";
import { Activity, Code2, Github, MessagesSquare } from "lucide-react";
import { STATUS_PAGE_URL } from "@/lib/statusPage";
import { BrandMark } from "./BrandMark";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { HomeHeroActions } from "./HomeNav";

const GITHUB_URL = "https://github.com/serika-dev/SerikaCord";
const LICENSE_URL = "https://github.com/serika-dev/SerikaCord/blob/canary/LICENSE";
const ISSUES_URL = "https://issues.serika.dev/issues/new?project=serikacord";
const COMMUNITY_URL = "https://serika.cc/serika";

/** Closing call to action: the start of the dark brand band that runs into the footer. */
export async function HomeFinalCta() {
  const gt = await getGT();
  return (
    <section aria-labelledby="hm-cta-title" className="hm-dark hm-band-night relative py-14 sm:py-32">
      <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6" data-reveal data-reveal-stagger>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
        <img
          src="/logo-icon.svg"
          alt=""
          width={64}
          height={64}
          className="mx-auto mb-5 h-12 w-12 drop-shadow-[0_12px_30px_rgba(139,92,246,0.45)]"
        />
        <h2 id="hm-cta-title" className="hm-display hm-h2">
          {gt("Bring your people.")}
        </h2>
        <p className="hm-lede mx-auto mt-3 max-w-xl sm:mt-5">
          {gt("Create an account, start a server and share the invite link. It's free, and there are no ads.")}
        </p>
        <div className="mt-6 sm:mt-10">
          <HomeHeroActions />
        </div>
      </div>
    </section>
  );
}

export async function HomeFooter() {
  const gt = await getGT();
  const year = new Date().getFullYear();

  const columns: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
    {
      title: gt("Product"),
      links: [
        { label: gt("Open SerikaCord"), href: "/channels/me" },
        { label: gt("Download"), href: "/download" },
        { label: gt("Discover servers"), href: "/channels/explore" },
        { label: gt("What's new"), href: "/changelog" },
        { label: gt("Service status"), href: STATUS_PAGE_URL, external: true },
      ],
    },
    {
      title: gt("Developers"),
      links: [
        { label: gt("Bot library"), href: "/bots" },
        { label: gt("Developer portal"), href: "/developers" },
        { label: gt("API docs"), href: "/developers/docs/intro" },
        { label: gt("Source code"), href: GITHUB_URL, external: true },
      ],
    },
    {
      title: gt("Resources"),
      links: [
        { label: gt("Support"), href: "/support" },
        { label: gt("Report a bug"), href: ISSUES_URL, external: true },
        { label: gt("How SerikaCord compares"), href: "/compare" },
        { label: gt("Chat app tier list"), href: "/compare/tier-list" },
      ],
    },
    {
      title: gt("Company"),
      links: [
        { label: gt("About Serika"), href: "https://serika.pro", external: true },
        { label: gt("Serika Accounts"), href: "https://accounts.serika.dev", external: true },
        { label: gt("Terms of service"), href: "/terms" },
        { label: gt("Privacy policy"), href: "/privacy" },
        { label: gt("Community guidelines"), href: "/guidelines" },
      ],
    },
  ];

  const socials = [
    { label: gt("Source code on GitHub"), href: GITHUB_URL, icon: Github },
    { label: gt("Join the Serika server"), href: COMMUNITY_URL, icon: MessagesSquare },
    { label: gt("Service status"), href: STATUS_PAGE_URL, icon: Activity },
  ];

  return (
    <footer className="hm-dark hm-footer relative overflow-hidden pt-12 sm:pt-20">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,2.85fr)] lg:gap-12">
          <div className="max-w-sm">
            <p className="hm-display text-[1.6rem] font-bold leading-[1.1] sm:text-[2rem]">
              {gt("Your place to talk.")}
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              {gt("Free chat for communities and friends, made by Serika Company in the Netherlands.")}
            </p>
            <LocaleSelector className="mt-6 h-10 w-[200px]" />
            <ul className="mt-6 flex items-center gap-2">
              {socials.map((s) => (
                <li key={s.href}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--hm-ink)] transition-colors hover:bg-white/10 hover:text-[var(--hm-accent-text)]"
                  >
                    <s.icon className="h-5 w-5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <nav aria-label={gt("Footer")} className="grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-8 md:grid-cols-4">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-[var(--hm-accent-text)]">{col.title}</h3>
                <ul className="mt-3 flex flex-col gap-2.5 text-[0.95rem] sm:mt-4 sm:gap-3">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {l.external ? (
                        <a href={l.href} target="_blank" rel="noopener noreferrer" className="text-[var(--hm-ink)] opacity-85 transition hover:underline hover:opacity-100">
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className="text-[var(--hm-ink)] opacity-85 transition hover:underline hover:opacity-100">
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="mt-12 flex flex-col gap-5 border-t border-[color-mix(in_srgb,var(--brand-violet)_45%,transparent)] pt-7 sm:mt-16 sm:flex-row sm:items-center sm:justify-between sm:pt-8">
          <Link href="/" aria-label={gt("SerikaCord home")} className="inline-block self-start sm:self-auto">
            <BrandMark />
          </Link>
          <p className="flex items-start gap-2 text-sm leading-relaxed sm:order-none">
            <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
            <span>
              {gt("Code on GitHub. Self-host it for you and your friends.")}{" "}
              <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="hm-link">
                {gt("License")}
              </a>
            </span>
          </p>
          <Link href="/register" className="hm-btn hm-btn-primary hm-btn-sm self-start sm:self-auto">
            {gt("Sign up")}
          </Link>
        </div>
        <p className="mt-6 text-xs text-[var(--hm-faint)] sm:mt-4">{gt("© {year} Serika Company. All rights reserved.", { year })}</p>
      </div>

      {/* The wordmark, as big as the page is wide (product names are never translated). */}
      <p className="hm-footer-word" aria-hidden>
        SerikaCord
      </p>
    </footer>
  );
}
