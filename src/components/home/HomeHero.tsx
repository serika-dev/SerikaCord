import { Suspense } from "react";
import { getGT } from "gt-next/server";
import { Code2, EyeOff, Lock, MapPin } from "lucide-react";
import { HomeHeroActions } from "./HomeNav";
import { ChannelPreview, HeroDevicesPreview } from "./AppPreview";
import { AccountCount } from "./AccountCount";
import { SectionHeading } from "./SectionHeading";
import { Laptop } from "./Devices";

/**
 * The hero: the pitch on one side and the app on a computer and a phone on
 * the other (HeroDevices.tsx). Phones stack them: text first, then the devices.
 */
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
      className="hm-dark hm-hero relative overflow-hidden pb-10 pt-[calc(5.5rem+var(--safe-area-top))] sm:pb-24 sm:pt-32 lg:pt-36"
    >
      <div className="relative mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-10">
        <div className="grid items-center gap-10 sm:gap-14 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:gap-8">
          <div className="hm-hero-in mx-auto max-w-[36rem] text-center lg:mx-0 lg:text-start">
            <h1 id="hm-hero-title" className="hm-display hm-hero-title">
              <span className="block">{gt("Your people, your servers.")}</span>
              <span className="hm-accent block">{gt("No ads in between.")}</span>
            </h1>
            <p className="hm-lede mx-auto mt-4 max-w-xl sm:mt-6 lg:mx-0">
              {gt("SerikaCord is a free chat app for communities and friends, with servers, voice and video, and end-to-end encrypted DMs. Made by a small team in the Netherlands.")}
            </p>
            <div className="mt-6 sm:mt-8">
              <HomeHeroActions align="hero" note={false} />
            </div>
            {/* Reserved height: the count streams in without moving the page. */}
            <div className="mt-4 flex min-h-6 items-center justify-center sm:mt-5 sm:min-h-7 lg:justify-start [&_p]:lg:text-start">
              <Suspense fallback={null}>
                <AccountCount />
              </Suspense>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[760px] lg:-me-[4%] lg:max-w-none">
            <HeroDevicesPreview />
          </div>
        </div>

        {/* Phones: a dense 2×2 grid of headlines (the details are in the sections
            below); wider screens: one roomy row with the details. */}
        <ul className="mx-auto mt-12 grid max-w-[1200px] grid-cols-2 gap-x-4 gap-y-4 border-t border-[var(--hm-line)] pt-7 sm:mt-20 sm:gap-8 sm:pt-10 lg:mt-24 lg:grid-cols-4" data-reveal data-reveal-stagger>
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

/** The playable app at full size, right under the hero (live/LivePreview.tsx). */
export async function TrySection() {
  const gt = await getGT();
  return (
    <section id="try" aria-labelledby="hm-try-title" className="scroll-mt-20 py-10 sm:py-24">
      <div className="mx-auto max-w-[1320px] px-4 sm:px-8 lg:px-16">
        <SectionHeading
          id="hm-try-title"
          align="center"
          label={gt("Try it")}
          title={gt("Click around. It's the real app.")}
          lede={gt("Switch servers, join a voice channel, open profiles, reply and react. People chat on their own, and nothing you type leaves this page.")}
        />
        <Laptop className="mx-auto mt-6 max-w-[1180px] sm:mt-12">
          <ChannelPreview />
        </Laptop>
      </div>
    </section>
  );
}
