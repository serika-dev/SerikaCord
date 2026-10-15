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
      className="hm-dark hm-hero relative overflow-hidden pb-20 pt-[calc(7.5rem+var(--safe-area-top))] sm:pb-28 sm:pt-40"
    >
      <div className="relative mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-[52rem] text-center">
          <h1 id="hm-hero-title" className="hm-display hm-h1">
            <span className="block">{gt("Your people, your servers.")}</span>
            <span className="hm-accent block">{gt("No ads in between.")}</span>
          </h1>
          <p className="hm-lede mx-auto mt-7 max-w-2xl">
            {gt("SerikaCord is a free chat app for communities and friends, with servers, voice and video, and end-to-end encrypted DMs. Made by a small team in the Netherlands.")}
          </p>
          <div className="mt-10">
            <HomeHeroActions />
          </div>
          {/* Reserved height: the count streams in without moving the page. */}
          <div className="mt-2 flex min-h-7 items-center justify-center">
            <Suspense fallback={null}>
              <AccountCount />
            </Suspense>
          </div>
        </div>

        <div className="relative mx-auto mt-14 max-w-[1120px] sm:mt-20">
          <div className="hm-stage">
            <ChannelPreview />
          </div>
        </div>

        <ul className="mx-auto mt-20 grid max-w-[1120px] gap-8 sm:grid-cols-2 lg:mt-28 lg:grid-cols-4" data-reveal>
          {facts.map((f) => (
            <li key={f.title} className="flex gap-3">
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
              <span>
                <span className="block font-semibold text-[var(--hm-ink)]">{f.title}</span>
                <span className="mt-1 block text-sm leading-snug">{f.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
