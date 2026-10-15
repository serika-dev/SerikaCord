import Link from "next/link";
import { getGT } from "gt-next/server";
import { Code2 } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { LocaleSelector } from "@/components/ui/LocaleSelector";
import { HomeHeroActions } from "./HomeNav";

const GITHUB_URL = "https://github.com/serika-dev/SerikaCord";
const LICENSE_URL = "https://github.com/serika-dev/SerikaCord/blob/canary/LICENSE";

/** Closing call to action: the start of the dark brand band that runs into the footer. */
export async function HomeFinalCta() {
  const gt = await getGT();
  return (
    <section aria-labelledby="hm-cta-title" className="hm-dark hm-band-night relative py-24 sm:py-32">
      <div className="relative mx-auto max-w-3xl px-4 text-center sm:px-6" data-reveal>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
        <img
          src="/logo-icon.svg"
          alt=""
          width={64}
          height={64}
          className="mx-auto mb-8 h-16 w-16 drop-shadow-[0_12px_30px_rgba(139,92,246,0.45)]"
        />
        <h2 id="hm-cta-title" className="hm-display hm-h2">
          {gt("Bring your people.")}
        </h2>
        <p className="hm-lede mx-auto mt-5 max-w-xl">
          {gt("Create an account, start a server and share the invite link. It's free, and there are no ads.")}
        </p>
        <div className="mt-10">
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
        { label: gt("What's new"), href: "/changelog" },
        { label: gt("Service status"), href: "https://status.serika.dev", external: true },
      ],
    },
    {
      title: gt("Developers"),
      links: [
        { label: gt("Developer portal"), href: "/developers" },
        { label: gt("API docs"), href: "/developers/docs/intro" },
        { label: gt("Source code"), href: GITHUB_URL, external: true },
      ],
    },
    {
      title: gt("Compare"),
      links: [
        { label: gt("How SerikaCord compares"), href: "/compare" },
        { label: gt("Chat app tier list"), href: "/compare/tier-list" },
      ],
    },
    {
      title: gt("Company"),
      links: [
        { label: gt("About Serika"), href: "https://serika.pro", external: true },
        { label: gt("Serika Accounts"), href: "https://accounts.serika.dev", external: true },
        { label: gt("Support"), href: "mailto:support@serika.dev", external: true },
      ],
    },
    {
      title: gt("Legal"),
      links: [
        { label: gt("Terms of service"), href: "/terms" },
        { label: gt("Privacy policy"), href: "/privacy" },
        { label: gt("Community guidelines"), href: "/guidelines" },
      ],
    },
  ];

  return (
    <footer
      className="hm-dark pb-[calc(2.5rem+var(--safe-area-bottom))] pt-16"
      style={{ background: "linear-gradient(180deg, var(--brand-night) 0%, var(--brand-black) 60%)" }}
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="grid gap-10 border-t border-[var(--hm-line)] pt-14 lg:grid-cols-[1.2fr_3fr]">
          <div className="max-w-xs">
            <Link href="/" aria-label={gt("SerikaCord home")} className="inline-block">
              <Logo size="sm" />
            </Link>
            <p className="mt-4 text-sm leading-relaxed">
              {gt("Free chat for communities and friends, made by Serika Company in the Netherlands.")}
            </p>
            <p className="mt-4 flex gap-2 text-sm leading-relaxed">
              <Code2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
              <span>
                {gt("Code on GitHub. Self-host it for you and your friends.")}{" "}
                <a href={LICENSE_URL} target="_blank" rel="noopener noreferrer" className="hm-link">
                  {gt("License")}
                </a>
              </span>
            </p>
          </div>
          <nav aria-label={gt("Footer")} className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-5">
            {columns.map((col) => (
              <div key={col.title}>
                <h3 className="text-sm font-semibold text-[var(--hm-ink)]">{col.title}</h3>
                <ul className="mt-4 flex flex-col gap-3 text-sm">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      {l.external ? (
                        <a
                          href={l.href}
                          {...(l.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                          className="transition-colors hover:text-[var(--hm-ink)]"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link href={l.href} className="transition-colors hover:text-[var(--hm-ink)]">
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

        <div className="mt-14 flex flex-col items-start justify-between gap-4 border-t border-[var(--hm-line)] pt-8 sm:flex-row sm:items-center">
          <p className="text-xs text-[var(--hm-faint)]">{gt("© {year} Serika Company. All rights reserved.", { year })}</p>
          <LocaleSelector className="h-9 w-[180px]" />
        </div>
      </div>
    </footer>
  );
}
