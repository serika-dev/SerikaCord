import Link from "next/link";
import type { ReactNode } from "react";
import { getGT } from "gt-next/server";
import { ArrowRight, Plus } from "lucide-react";
import type { CompareFaqItem } from "@/lib/compare";
import { HomeHeader } from "@/components/home/HomeHeader";
import { HomeFooter } from "@/components/home/HomeFooter";
import { homeDisplayFont } from "@/components/home/displayFont";
import "@/components/home/home.css";

/**
 * Building blocks for the public comparison pages (/compare/*). Server
 * components in the homepage's design language: the same header, footer,
 * brand-band hero and `hm-*` tokens (src/components/home/home.css), so the
 * body follows the visitor's light / dark theme like the homepage does.
 */

export async function CompareShell({ hero, current, children }: { hero: ReactNode; current?: string; children: ReactNode }) {
  return (
    <div className={`hm-root ${homeDisplayFont.variable}`}>
      <HomeHeader variant="site" current={current} />

      <main id="main" tabIndex={-1} className="outline-none">
        {/* Brand band, like the homepage hero. */}
        <div className="hm-dark hm-hero pb-10 pt-[calc(5.75rem+var(--safe-area-top))] sm:pb-16 sm:pt-32">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">{hero}</div>
        </div>

        <div className="mx-auto max-w-[1200px] px-4 pb-6 pt-10 text-[var(--hm-ink)] sm:px-6 sm:pb-12 sm:pt-16 lg:px-10">{children}</div>

        <CompareCta />
      </main>

      <HomeFooter />
    </div>
  );
}

export async function Breadcrumbs({ items }: { items: { href?: string; label: string }[] }) {
  const gt = await getGT();
  return (
    <nav aria-label={gt("Breadcrumb")} className="mb-5 text-sm text-[var(--hm-faint)] sm:mb-7">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={item.label} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>/</span>}
            {item.href ? (
              <Link href={item.href} className="transition-colors hover:text-[var(--hm-ink)]">{item.label}</Link>
            ) : (
              <span aria-current="page" className="text-[var(--hm-ink)]">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ eyebrow, title, intro, meta }: { eyebrow: string; title: string; intro: ReactNode; meta: ReactNode }) {
  return (
    <header className="max-w-3xl">
      <p className="hm-label mb-2 sm:mb-3">{eyebrow}</p>
      <h1 className="hm-display hm-h1 hm-h1-page">{title}</h1>
      <div className="hm-lede mt-4 space-y-3 sm:mt-6 sm:space-y-4">{intro}</div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--hm-faint)] sm:mt-6">{meta}</div>
    </header>
  );
}

export function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-12 scroll-mt-24 sm:mb-20">
      <h2 id={`${id}-title`} className="hm-display hm-h2-page">{title}</h2>
      {intro && <div className="mt-2 max-w-3xl text-[0.95rem] leading-relaxed text-[var(--hm-body)] sm:mt-3 sm:text-base">{intro}</div>}
      <div className="mt-5 sm:mt-7">{children}</div>
    </section>
  );
}

/** Two "pick this if" cards side by side (stacked on phones). */
export function PickCards({ cards }: { cards: { title: string; points: string[] }[] }) {
  return (
    <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
      {cards.map((card) => (
        <div key={card.title} className="hm-card !rounded-[16px] p-4 sm:!rounded-[24px] sm:p-6">
          <h3 className="hm-h3 mb-3">{card.title}</h3>
          <ul className="space-y-2 text-sm leading-relaxed text-[var(--hm-body)]">
            {card.points.map((p) => (
              <li key={p} className="flex gap-2">
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hm-accent-text)] rtl:rotate-180" aria-hidden />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** A list of strengths, each with a bold lead-in and an explanation. */
export function PointList({ points }: { points: { title: string; text: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
      {points.map((p) => (
        <li key={p.title} className="hm-card !rounded-[16px] p-4 sm:!rounded-[24px] sm:p-6">
          <h3 className="hm-h3 mb-1">{p.title}</h3>
          <p className="text-sm leading-relaxed text-[var(--hm-body)]">{p.text}</p>
        </li>
      ))}
    </ul>
  );
}

export function FaqList({ items }: { items: CompareFaqItem[] }) {
  return (
    <div className="flex flex-col gap-2 sm:gap-3">
      {items.map((item) => (
        <details key={item.question} className="hm-faq hm-card group !rounded-[16px]">
          <summary className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4">
            <h3 className="text-[0.95rem] font-semibold leading-snug text-[var(--hm-ink)] sm:text-base">{item.question}</h3>
            <Plus className="hm-faq-icon mt-0.5 h-5 w-5 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
          </summary>
          <p className="px-4 pb-4 text-sm leading-relaxed text-[var(--hm-body)] sm:px-5 sm:pb-5">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}

/** Closing call to action: the night-purple brand band, like the homepage's. */
export async function CompareCta() {
  const gt = await getGT();
  return (
    <section aria-labelledby="cmp-cta-title" className="hm-dark hm-band-night py-14 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG mark */}
        <img
          src="/logo-icon.svg"
          alt=""
          width={64}
          height={64}
          className="mx-auto mb-5 h-12 w-12 drop-shadow-[0_12px_30px_rgba(139,92,246,0.45)] sm:mb-8 sm:h-16 sm:w-16"
        />
        <h2 id="cmp-cta-title" className="hm-display hm-h2">{gt("Try SerikaCord for yourself")}</h2>
        <p className="hm-lede mx-auto mt-3 max-w-xl sm:mt-5">
          {gt("It's free, it runs in your browser, and there are apps for Windows, macOS, Linux and Android. Bring your friends, or bridge your Discord server while you decide.")}
        </p>
        <div className="mx-auto mt-6 flex w-full max-w-[22rem] flex-col items-stretch justify-center gap-2.5 sm:mt-10 sm:w-auto sm:max-w-none sm:flex-row sm:gap-3">
          <Link href="/register" className="hm-btn hm-btn-primary sm:min-w-[200px]">
            {gt("Create a free account")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
          <Link href="/download" className="hm-btn hm-btn-ghost sm:min-w-[200px]">
            {gt("Download the app")}
          </Link>
        </div>
      </div>
    </section>
  );
}
