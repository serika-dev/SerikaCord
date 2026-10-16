import { Suspense } from "react";
import { getGT } from "gt-next/server";
import { Code2, EyeOff, Lock, MapPin } from "lucide-react";
import { HomeHeroActions } from "./HomeNav";
import { ChannelPreview } from "./AppPreview";
import { AccountCount } from "./AccountCount";

export async function HomeHero() {
  const gt = await getGT();

  const facts = [
    { icon: MapPin, title: gt("Based in the Netherlands"), text: gt("Serika Company runs SerikaCord under the EU's GDPR.") },
    { icon: EyeOff, title: gt("No ads, no trackers"), text: gt("No advertising trackers, and we never sell your data.") },
    { icon: Lock, title: gt("Encrypted DMs"), text: gt("New DMs and their calls are end-to-end encrypted.") },
    { icon: Code2, title: gt("Code on GitHub"), text: gt("Read the source and report issues in the open.") },
  ];

  return (
    <section
      aria-labelledby="hm-hero-title"
      className="hm-dark hm-hero relative overflow-hidden pb-10 pt-[calc(6rem+var(--safe-area-top))] sm:pb-28 sm:pt-40"
    >
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[52rem] text-center">
          <h1 id="hm-hero-title" className="hm-display hm-h1">
            <span className="block">{gt("Your people, your servers.")}</span>
            <span className="hm-accent block">{gt("No ads in between.")}</span>
          </h1>
          <p className="hm-lede mx-auto mt-4 max-w-2xl sm:mt-7">
            {gt("SerikaCord is a free chat app for communities and friends, with servers, voice and video, and end-to-end encrypted DMs. Made by a small team in the Netherlands.")}
          </p>
          <div className="mt-6 sm:mt-10">
            <HomeHeroActions />
          </div>
          {/* Reserved height: the count streams in without moving the page. */}
          <div className="flex min-h-6 items-center justify-center sm:mt-2 sm:min-h-7">
            <Suspense fallback={null}>
              <AccountCount />
            </Suspense>
          </div>
        </div>

        <div className="relative mx-auto mt-6 max-w-[1120px] sm:mt-20">
          <div className="hm-stage">
            <ChannelPreview />
          </div>
        </div>

        {/* Phones: a dense 2×2 grid of headlines (the details are in the sections
            below); wider screens: one roomy row with the details. */}
        <ul className="mx-auto mt-7 grid max-w-[1120px] grid-cols-2 gap-x-4 gap-y-4 sm:mt-20 sm:gap-8 lg:mt-28 lg:grid-cols-4" data-reveal>
          {facts.map((f) => (
            <li key={f.title} className="flex items-start gap-2 sm:gap-3">
              <f.icon className="mt-px h-4 w-4 shrink-0 text-[var(--hm-accent-text)] sm:mt-0.5 sm:h-5 sm:w-5" aria-hidden />
              <span>
                <span className="block text-sm font-semibold leading-snug text-[var(--hm-ink)] sm:text-base">{f.title}</span>
                <span className="mt-1 hidden text-sm leading-snug sm:block">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
