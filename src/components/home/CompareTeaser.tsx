import Link from "next/link";
import { getGT } from "gt-next/server";
import { ArrowRight, Check, Hourglass } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

export async function CompareTeaser() {
  const gt = await getGT();

  const strengths = [
    gt("No ads, and no advertising trackers"),
    gt("End-to-end encrypted DMs and calls, on by default"),
    gt("Run from the Netherlands, under EU privacy law"),
    gt("Bots written for Discord's API can connect"),
    gt("Code you can read on GitHub"),
  ];
  const gaps = [
    gt("Far fewer people and communities than Discord, for now"),
    gt("No native iPhone app yet"),
    gt("Server channels aren't end-to-end encrypted"),
    gt("A young app from a small team, so expect some rough edges"),
  ];

  return (
    <section id="compare" aria-labelledby="hm-compare-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-compare-title"
          label={gt("How we compare")}
          title={gt("Honest about where we stand.")}
          lede={gt("We compare SerikaCord with Discord and other apps as fairly as we can, with sources, including where they're the better choice.")}
        />

        <div className="mt-6 grid gap-3 sm:mt-12 sm:gap-4 md:grid-cols-2" data-reveal>
          <div className="hm-card !rounded-[16px] p-4 sm:!rounded-[24px] sm:p-8">
            <h3 className="hm-h3 !text-[1.02rem] sm:!text-[1.2rem]">{gt("What you get with SerikaCord")}</h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm sm:mt-5 sm:gap-3 sm:text-base">
              {strengths.map((s) => (
                <li key={s} className="flex gap-3 leading-snug">
                  <span className="hm-check mt-0.5" aria-hidden>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[var(--hm-ink)]">{s}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="hm-card border-dashed !rounded-[16px] p-4 sm:!rounded-[24px] sm:p-8">
            <h3 className="hm-h3 !text-[1.02rem] sm:!text-[1.2rem]">{gt("Where we're still catching up")}</h3>
            <ul className="mt-3 flex flex-col gap-2 text-sm sm:mt-5 sm:gap-3 sm:text-base">
              {gaps.map((s) => (
                <li key={s} className="flex gap-3 leading-snug">
                  <span
                    className="mt-0.5 flex h-[1.3rem] w-[1.3rem] shrink-0 items-center justify-center rounded-full bg-[var(--hm-surface-2)] text-[var(--hm-body)]"
                    aria-hidden
                  >
                    <Hourglass className="h-3 w-3" />
                  </span>
                  <span className="text-[var(--hm-ink)]">{s}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 sm:mt-6 sm:gap-3" data-reveal>
          <Link href="/compare" className="hm-btn hm-btn-ghost hm-btn-compact">
            {gt("Read the comparisons")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </Link>
          <Link href="/compare/tier-list" className="hm-btn hm-btn-ghost hm-btn-compact">
            {gt("See the tier list")}
          </Link>
        </div>
      </div>
    </section>
  );
}
