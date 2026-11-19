import type { ReactNode } from "react";
import { getGT } from "gt-next/server";
import { Eye, Monitor } from "lucide-react";
import { twemojiSvgUrl } from "@/lib/twemoji-helpers";
import { SectionHeading } from "./SectionHeading";
import { Av } from "./preview/parts";
import { SHOTS } from "./live/model";

/**
 * Game nights: three screenshots, each shown the way SerikaCord shows it
 * (a Go Live tile, a profile's activity card, a post in #clips). The pieces
 * copy the app's markup (voice/CallStage.tsx tiles, the profile activity card,
 * MessageGroup + MessageReactions) and the reactions toggle like the app's,
 * with native checkboxes so the section stays a server component.
 */

function Card({ art, game, title, text }: { art: ReactNode; game: string; title: string; text: string }) {
  return (
    <article className="hm-card group flex flex-col !rounded-[20px] sm:!rounded-[24px]">
      <div className="hm-game-art relative aspect-[16/11] overflow-hidden">{art}</div>
      <div className="flex flex-1 flex-col p-4 sm:p-6">
        <p className="text-[13px] font-medium text-[var(--hm-faint)]">{game}</p>
        <h3 className="hm-h3 mt-1 !text-[1.05rem] sm:!text-[1.2rem]">{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed sm:text-[0.95rem]">{text}</p>
      </div>
    </article>
  );
}

function Shot({ src }: { src: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static sample screenshot
    <img
      src={src}
      alt=""
      width={1280}
      height={720}
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none"
    />
  );
}

/** A reaction chip you can click, as MessageReactions toggles yours on and off. */
function Reaction({ emoji, count, mine }: { emoji: string; count: number; mine?: boolean }) {
  return (
    <label className="hm-react cursor-pointer">
      <input type="checkbox" className="peer sr-only" defaultChecked={mine} />
      <span className="flex items-center gap-1 rounded-full border border-[var(--app-border)] bg-[var(--app-surface-alt)] px-2 py-0.5 text-sm text-[var(--app-muted)] transition-colors hover:border-[var(--app-accent)]">
        <span className="twemoji inline-flex items-center text-base leading-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- Twemoji SVG, same source as the app */}
          <img className="emoji" src={twemojiSvgUrl(emoji)} alt={emoji} draggable={false} loading="lazy" />
        </span>
        {/* Without your reaction / with it. */}
        <span className="hm-react-off tabular-nums">{mine ? count - 1 : count}</span>
        <span className="hm-react-on tabular-nums">{mine ? count : count + 1}</span>
      </span>
    </label>
  );
}

export async function GamesSection() {
  const gt = await getGT();

  return (
    <section id="games" aria-labelledby="hm-games-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-games-title"
          align="center"
          label={gt("Game nights")}
          title={gt("Made for playing together.")}
          lede={gt("Stream your game to the voice channel, let friends see what you're playing, and post your best shots for everyone to react to.")}
        />

        <div className="mt-6 grid gap-3 sm:mt-12 sm:gap-4 md:grid-cols-3" data-reveal data-reveal-stagger>
          {/* Go Live: a screen share tile from the call grid. */}
          <Card
            game="Final Fantasy XVI"
            title={gt("Go Live in any voice channel")}
            text={gt("Share your game at up to 1440p and 60 FPS. Friends click your tile to watch, and you all keep talking.")}
            art={
              <>
                <Shot src={SHOTS.castle} />
                <span className="absolute inset-0 rounded-t-[inherit] ring-2 ring-inset ring-[#23a55a]" aria-hidden />
                <span className="absolute left-3 top-3 rounded-md bg-[#e11d48] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {gt("Live")}
                </span>
                <span className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur-md">
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                  {gt("{count} watching", { count: 4 })}
                </span>
                <span className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/45 px-2 py-1 text-xs font-medium text-white backdrop-blur-md">
                  <Monitor className="h-3 w-3" aria-hidden />
                  {gt("{name}'s screen", { name: "Theo" })}
                </span>
              </>
            }
          />

          {/* Rich presence: the activity card from a profile. */}
          <Card
            game="Octopath Traveler"
            title={gt("Show what you're playing")}
            text={gt("Your game shows on your profile and in the member list, so friends know when to jump in.")}
            art={
              <>
                <Shot src={SHOTS.snowyCliff} />
                <div className="absolute inset-x-3 bottom-3 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--bg-card)] shadow-xl">
                  <div className="flex items-center gap-1.5 px-3 pb-2 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--app-muted)]">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />
                    {gt("Playing a Game")}
                  </div>
                  <div className="flex items-center gap-3 px-3 pb-3">
                    <span className="relative shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element -- static sample game art */}
                      <img src={SHOTS.snowyCliff} alt="" width={56} height={56} loading="lazy" className="h-12 w-12 rounded-[8px] object-cover ring-1 ring-inset ring-white/[0.06]" />
                      <Av name="Aya" className="absolute -bottom-1 -right-1 h-5 w-5 ring-2 ring-[var(--bg-card)]" fallbackClassName="text-[8px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Octopath Traveler</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{gt("Chapter 2, Frostlands")}</p>
                      <p className="mt-1 text-[10.5px] tabular-nums text-[var(--app-muted)]">{gt("{h}h {m}m elapsed", { h: 1, m: 12 })}</p>
                    </div>
                  </div>
                </div>
              </>
            }
          />

          {/* Clips: a post with reactions you can toggle. */}
          <Card
            game="Planet Coaster"
            title={gt("Post your best shots")}
            text={gt("Drop screenshots and clips in a channel. Everyone can react, reply or open a thread about it.")}
            art={
              <>
                <Shot src={SHOTS.coaster} />
                <div className="absolute inset-x-3 bottom-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] p-3 shadow-xl">
                  <div className="flex gap-3">
                    <Av name="Mika" className="h-8 w-8" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="!text-[0.8rem] font-medium leading-tight text-[var(--text-primary)]">Mika</span>
                        <span className="text-[10px] leading-none text-[var(--text-muted)]">#{gt("clips")}</span>
                      </div>
                      <p className="twemoji chat-message-body mt-0.5 truncate text-sm text-[var(--app-text)]">{gt("finally finished my Planet Coaster forest ride 🎢")}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <Reaction emoji="🎢" count={3} mine />
                        <Reaction emoji="🔥" count={5} />
                        <Reaction emoji="😍" count={2} />
                      </div>
                    </div>
                  </div>
                </div>
              </>
            }
          />
        </div>
      </div>
    </section>
  );
}
