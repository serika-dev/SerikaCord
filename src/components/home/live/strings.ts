/**
 * Everything the live preview says, translated. Literal gt() calls only (the
 * compile-time plugin needs literals), built once per locale.
 */
import { useMemo } from "react";
import type { Gt } from "../preview/parts";
import { SHOTS, type ChannelKind, type Msg, type Person, type RoomKey, type ServerId } from "./model";

/** Seed message times ("HH:MM"), formatted on the server so the first render matches. */
export const SEED_TIMES = ["12:04", "17:15", "18:30", "19:02", "19:05", "19:40", "20:12", "20:14", "20:31", "20:48", "20:51", "21:05", "21:12", "21:20", "21:32", "21:34", "21:38", "21:41"] as const;
export type SeedTime = (typeof SEED_TIMES)[number];
export type LiveTimes = Record<SeedTime, string> & { thread: string };

/** One line of a scripted conversation: `who` indexes the cast picked when it starts. */
export interface Line {
  who: number;
  text: string;
  /** Replies to the line before it (the app's reply preview). */
  reply?: boolean;
  image?: string;
}

/** What a visitor's message is about, so answers can make sense. */
export interface ReplyContext {
  text: string;
  /** The message the visitor replied to, if any. */
  replyTo?: { author: string; text: string };
  kind?: "image" | "sticker";
  dm?: boolean;
}

export interface ChannelDef {
  id: string;
  name: string;
  kind: ChannelKind;
}

export interface ServerDef {
  id: ServerId;
  name: string;
  members: Person[];
  /** Who sits in each voice channel to begin with. */
  voice: Record<string, Person[]>;
  categories: { id: string; name: string; channels: ChannelDef[] }[];
}

const pick2 = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export function useLiveStrings(gt: Gt, times: LiveTimes) {
  return useMemo(() => {
    const servers: ServerDef[] = [
      {
        id: "night-owls",
        name: "Night Owls",
        members: ["Theo", "Aya", "Rin", "Mika", "Jun", "Sora"],
        voice: { lounge: ["Mika", "Aya", "Jun"], gaming: [] },
        categories: [
          {
            id: "info",
            name: gt("Information"),
            channels: [
              { id: "rules", name: gt("rules"), kind: "text" },
              { id: "announcements", name: gt("announcements"), kind: "announcement" },
            ],
          },
          {
            id: "text",
            name: gt("Text channels"),
            channels: [
              { id: "general", name: gt("general"), kind: "text" },
              { id: "clips", name: gt("clips"), kind: "text" },
              { id: "help-desk", name: gt("help-desk"), kind: "forum" },
            ],
          },
          {
            id: "voice",
            name: gt("Voice channels"),
            channels: [
              { id: "lounge", name: gt("Lounge"), kind: "voice" },
              { id: "gaming", name: gt("Gaming"), kind: "voice" },
            ],
          },
        ],
      },
      {
        id: "pixel-club",
        name: "Pixel Club",
        members: ["Kai", "Nova", "Leo", "Jun", "Sora"],
        voice: { squad: ["Kai", "Nova"] },
        categories: [
          {
            id: "text",
            name: gt("Text channels"),
            channels: [
              { id: "general", name: gt("general"), kind: "text" },
              { id: "lfg", name: gt("looking-for-group"), kind: "text" },
              { id: "screenshots", name: gt("screenshots"), kind: "text" },
            ],
          },
          { id: "voice", name: gt("Voice channels"), channels: [{ id: "squad", name: gt("Squad"), kind: "voice" }] },
        ],
      },
      {
        id: "art-corner",
        name: "Art Corner",
        members: ["Aya", "Mika", "Rin", "Leo", "Sora"],
        voice: { studio: ["Aya"] },
        categories: [
          {
            id: "text",
            name: gt("Text channels"),
            channels: [
              { id: "general", name: gt("general"), kind: "text" },
              { id: "wip", name: gt("work-in-progress"), kind: "text" },
              { id: "critiques", name: gt("critiques"), kind: "text" },
            ],
          },
          { id: "voice", name: gt("Voice channels"), channels: [{ id: "studio", name: gt("Studio"), kind: "voice" }] },
        ],
      },
      {
        id: "lofi-lounge",
        name: "Lofi Lounge",
        members: ["Rin", "Jun", "Mika", "Nova", "Sora"],
        voice: { listening: ["Rin", "Jun", "Mika"] },
        categories: [
          {
            id: "text",
            name: gt("Text channels"),
            channels: [
              { id: "general", name: gt("general"), kind: "text" },
              { id: "requests", name: gt("song-requests"), kind: "text" },
            ],
          },
          { id: "voice", name: gt("Voice channels"), channels: [{ id: "listening", name: gt("Listening Room"), kind: "voice" }] },
        ],
      },
    ];

    let n = 0;
    const m = (author: Person, at: SeedTime, text: string, extra: Partial<Msg> = {}): Msg => ({
      id: `s${n++}`,
      author,
      time: times[at],
      text,
      reactions: [],
      ...extra,
    });

    const seeds: Record<RoomKey, Msg[]> = {
      "night-owls:rules": [m("Theo", "12:04", gt("1. be kind 2. no spam 3. have fun ✨"), { reactions: [{ emoji: "💜", count: 12 }], pinned: true })],
      "night-owls:announcements": [
        m("Theo", "17:15", gt("Movie night this Friday at 8 🍿 react if you're in"), { reactions: [{ emoji: "🍿", count: 9 }, { emoji: "🎉", count: 4 }], pinned: true }),
        m("Theo", "18:30", gt("New owl emoji just dropped, go wild 🦉")),
      ],
      "night-owls:general": [
        m("Rin", "21:32", gt("anyone up for a match tonight?"), { reactions: [{ emoji: "🙋", count: 4, mine: true }, { emoji: "🔥", count: 2 }] }),
        m("Theo", "21:34", gt("after dinner. poll so we can pick a time"), { kind: "poll", pinned: true }),
        m("Aya", "21:38", gt("the patch notes thread is something else"), { kind: "thread" }),
        m("Mika", "21:41", gt("hopping in Lounge, come hang")),
      ],
      "night-owls:clips": [
        m("Jun", "20:48", gt("Octopath Traveler at night, look at this snowy cliff 😍"), { kind: "image", src: SHOTS.snowyCliff, reactions: [{ emoji: "🔥", count: 5 }] }),
        m("Rin", "20:51", gt("how is that pixel art?? the light rays 😭"), { replyTo: { author: "Jun", text: gt("Octopath Traveler at night, look at this snowy cliff 😍") } }),
        m("Mika", "21:05", gt("finally finished my Planet Coaster forest ride 🎢"), { kind: "image", src: SHOTS.coaster, reactions: [{ emoji: "🎢", count: 3 }] }),
        m("Theo", "21:12", gt("the track diving through the trees is genius"), { replyTo: { author: "Mika", text: gt("finally finished my Planet Coaster forest ride 🎢") } }),
      ],
      "pixel-club:general": [
        m("Kai", "21:05", gt("who's still up for ranked?")),
        m("Nova", "21:12", gt("me!! give me 5 min")),
        m("Kai", "21:20", gt("bring snacks 🍕"), { reactions: [{ emoji: "🍕", count: 3 }] }),
      ],
      "pixel-club:lfg": [m("Nova", "20:31", gt("LFG: 2 more for the raid tonight ⚔️"), { reactions: [{ emoji: "👋", count: 3 }] }), m("Leo", "21:05", gt("count me in"))],
      "pixel-club:screenshots": [
        m("Leo", "19:40", gt("Final Fantasy XVI photo mode: Clive at sunset, with the Mothercrystal behind him"), { kind: "image", src: SHOTS.castle, reactions: [{ emoji: "😍", count: 7 }] }),
        m("Kai", "20:31", gt("that sky is unreal, which chapter is this?"), { replyTo: { author: "Leo", text: gt("Final Fantasy XVI photo mode: Clive at sunset, with the Mothercrystal behind him") } }),
        m("Leo", "20:48", gt("right before the big Eikon fight, no spoilers 🤐")),
      ],
      "art-corner:general": [
        m("Aya", "19:02", gt("sketch dump incoming 🎨")),
        m("Mika", "19:05", gt("omg the colors")),
        m("Aya", "20:12", gt("what do you think of the new banner?"), { mention: true, reactions: [{ emoji: "✨", count: 2 }] }),
      ],
      "art-corner:wip": [m("Leo", "20:14", gt("lineart done, coloring tomorrow 🖌️"))],
      "art-corner:critiques": [m("Rin", "18:30", gt("honest feedback welcome! be nice tho 🥹"))],
      "lofi-lounge:general": [m("Rin", "21:05", gt("now playing: rainy day mix ☔")), m("Jun", "21:12", gt("perfect study vibes"), { reactions: [{ emoji: "☕", count: 4 }] })],
      "lofi-lounge:requests": [m("Mika", "20:31", gt("can we get some city pop next?"))],
      "dm:Aya": [m("Aya", "20:12", gt("sent you the birthday plan, don't tell Rin")), m("Sora", "20:14", gt("my lips are sealed. so is this chat"))],
      "dm:Theo": [m("Theo", "21:34", gt("you joining game night?"))],
      "dm:Rin": [m("Rin", "19:40", gt("made you a playlist 🎧"), { reactions: [{ emoji: "💜", count: 1, mine: true }] })],
    };

    const forumPosts = [
      { title: gt("Bug: can't join voice"), by: "Jun" as Person, tag: gt("Solved"), replies: 6 },
      { title: gt("Share your setups 🖥️"), by: "Aya" as Person, tag: gt("Showcase"), replies: 23 },
      { title: gt("Patch notes megathread"), by: "Theo" as Person, tag: gt("News"), replies: 12 },
      { title: gt("Suggestion: a cozy music bot"), by: "Rin" as Person, tag: gt("Idea"), replies: 4 },
    ];

    const thread = [
      { author: "Theo" as Person, text: gt("patch is live! the new map is huge") },
      { author: "Jun" as Person, text: gt("the new map is so much better") },
      { author: "Aya" as Person, text: gt("the lighting at night 😍") },
      { author: "Rin" as Person, text: gt("who wants to explore it later?") },
    ];

    // Scripted conversations, per channel ("server:*" and "*" as fallbacks).
    const L = (who: number, text: string, extra: Partial<Line> = {}): Line => ({ who, text, ...extra });
    const talks: Record<string, Line[][]> = {
      "night-owls:general": [
        [L(0, gt("game night poll closes in 10, vote if you haven't!")), L(1, gt("voted 9! can't do earlier"), { reply: true }), L(0, gt("9 it is then 🎮"), { reply: true })],
        [L(0, gt("anyone else playing Octopath Traveler? I'm stuck on the chapter 2 boss")), L(1, gt("level up your thief and steal a few elemental items first"), { reply: true }), L(0, gt("omg that worked, thank you 😭"))],
        [L(0, gt("brb, making tea ☕")), L(1, gt("bring me one too")), L(0, gt("only if you carry me in ranked later 😤"), { reply: true })],
        [L(0, gt("who's hopping in Lounge tonight?")), L(1, gt("me after dinner!"), { reply: true }), L(2, gt("I'll stream Final Fantasy XVI if anyone wants to watch"))],
      ],
      "night-owls:clips": [
        [L(0, gt("my Planet Coaster park at night, all the lights are custom 🎢"), { image: SHOTS.coaster }), L(1, gt("the station in the trees!! how long did that take?"), { reply: true }), L(0, gt("about 6 hours, don't tell my boss"), { reply: true })],
        [L(0, gt("Octopath's HD-2D style never gets old"), { image: SHOTS.snowyCliff }), L(1, gt("that blur on the background makes it look like a diorama"), { reply: true })],
        [L(0, gt("Clive vs Ifrit, no hits taken 😤")), L(1, gt("clip or it didn't happen"), { reply: true }), L(0, gt("Final Fantasy XVI proof:"), { image: SHOTS.castle })],
      ],
      "night-owls:announcements": [[L(0, gt("reminder: movie night is Friday at 8 🍿")), L(1, gt("I'm bringing snacks!"), { reply: true })]],
      "night-owls:rules": [[L(0, gt("small update to rule 3: memes go in #clips 😂"))]],
      "pixel-club:general": [
        [L(0, gt("Final Fantasy XVI Eikon fights are the best boss fights in years")), L(1, gt("Titan was ridiculous, I was screaming"), { reply: true }), L(2, gt("no spoilers, I'm only at Ifrit!!"))],
        [L(0, gt("who's still up for ranked?")), L(1, gt("give me 5 min, finishing a raid"), { reply: true }), L(0, gt("ok, I'll wait in Squad"))],
        [L(0, gt("Palworld update just dropped 👀")), L(1, gt("my pals are going on strike again aren't they"), { reply: true }), L(0, gt("they unionized 😂"), { reply: true })],
      ],
      "pixel-club:lfg": [[L(0, gt("LFG: 2 more for the raid at 10 ⚔️")), L(1, gt("count me in, healer"), { reply: true }), L(2, gt("I can tank!")), L(0, gt("full team, see you in Squad 🎮"))]],
      "pixel-club:screenshots": [
        [L(0, gt("Final Fantasy XVI photo mode again, I can't stop"), { image: SHOTS.castle }), L(1, gt("this should be a wallpaper"), { reply: true })],
        [L(0, gt("built my first Planet Coaster ride, rate it"), { image: SHOTS.coaster }), L(1, gt("10/10, would scream"), { reply: true })],
      ],
      "art-corner:*": [
        [L(0, gt("sketch dump incoming 🎨")), L(1, gt("omg the colors"), { reply: true }), L(0, gt("thank youuu, it's for the server banner"))],
        [L(0, gt("Octopath's pixel art is giving me so many ideas"), { image: SHOTS.snowyCliff }), L(1, gt("the lighting in that game is a masterclass"), { reply: true })],
        [L(0, gt("lineart done, coloring tomorrow 🖌️")), L(1, gt("can't wait to see it!"), { reply: true })],
      ],
      "lofi-lounge:*": [
        [L(0, gt("now playing: rainy day mix ☔")), L(1, gt("perfect study vibes"), { reply: true })],
        [L(0, gt("can we get some city pop next?")), L(1, gt("queued! 3 songs out"), { reply: true }), L(0, gt("you're the best 💜"))],
        [L(0, gt("the Octopath Traveler soundtrack is so good for focusing")), L(1, gt("Primrose's theme on repeat 🎻"), { reply: true })],
      ],
      "dm:Aya": [[L(0, gt("also, the cake is purple. obviously 💜")), L(0, gt("are you coming at 6:30 to help with balloons?"))]],
      "dm:Theo": [[L(0, gt("we start at 9, I'll stream Final Fantasy XVI first")), L(0, gt("bring your best soundboard sounds 😂"))]],
      "dm:Rin": [[L(0, gt("did you listen to it yet? the 3rd song is my favorite")), L(0, gt("it's the one from Octopath Traveler 🎻"))]],
      "*": [[L(0, gt("good evening everyone ✨")), L(1, gt("evening! 👋"), { reply: true })]],
    };

    /** An answer to the visitor that fits what they said. */
    const replyFor = (c: ReplyContext): string => {
      const t = c.text.toLowerCase();
      const has = (re: RegExp) => re.test(t);
      if (c.kind === "image") return pick2([gt("wait that's gorgeous, what game is that?"), gt("ok that's going straight to my wallpapers"), gt("the lighting!!")]);
      if (c.kind === "sticker") return pick2([gt("that sticker 😂"), gt("lmaooo I need that one")]);
      if (c.replyTo) {
        const q = c.replyTo.text.toLowerCase();
        if (has(/\b(yes|yeah|yep|sure|ok|okay|me|i'm in|im in|down|let's go|lets go)\b/)) return pick2([gt("yay! see you there 🎮"), gt("perfect, I'll save you a spot"), gt("let's gooo")]);
        if (has(/\b(no|nah|can't|cant|busy|sorry)\b/)) return pick2([gt("aw, next time then 💜"), gt("no worries, we'll miss you!")]);
        if (q.includes("?")) return pick2([gt("ooh good answer"), gt("fair, I didn't think of that"), gt("ok that settles it")]);
      }
      if (has(/\b(hi|hey|hello|yo|sup|hii+|heya)\b/)) return c.dm ? gt("heyyy! what's up? 👋") : pick2([gt("hiii Sora 👋"), gt("heyy, welcome back!"), gt("yo! 👋")]);
      if (has(/octopath/)) return gt("the HD-2D style is so pretty, which character did you start with?");
      if (has(/planet coaster|coaster|rollercoaster/)) return gt("post your park when it's done, I want to ride it 🎢");
      if (has(/final fantasy|ff ?16|ffxvi|xvi|clive|eikon/)) return gt("the Eikon fights 😭 no spoilers past Titan please");
      if (has(/palworld|\bpals?\b/)) return gt("my pals are on strike again 😂");
      if (has(/lol|lmao|haha|😂|🤣/)) return pick2([gt("😂😂"), gt("stop I'm crying")]);
      if (has(/thank|thx|ty\b/)) return gt("anytime 💜");
      if (has(/\b(game|play|vc|voice|lounge|tonight)\b/)) return gt("I'm in! hop in Lounge when you're ready");
      if (has(/\?$|\bwho\b|\bwhat\b|\bwhen\b|\bwhere\b|\bhow\b|\banyone\b/)) return pick2([gt("hmm, I'd say yes"), gt("good question, after dinner maybe?"), gt("me! 🙋")]);
      if (has(/love|cute|nice|cool|pretty|amazing|beautiful/)) return pick2([gt("right?? 💜"), gt("so true")]);
      return pick2([gt("haha same"), gt("real"), gt("100%"), gt("honestly yeah")]);
    };
    const mentions = [gt("you coming tonight?"), gt("check this out when you're back!"), gt("we saved you a spot in vc 💜"), gt("can you settle this debate for us?")];
    const joins = ["Kai", "Nova", "Leo"] as Person[];

    const bios: Record<Person, string> = {
      Sora: gt("just vibing ✨"),
      Theo: gt("server owner · always up for game night"),
      Aya: gt("illustrator · coffee lover ☕"),
      Rin: gt("lo-fi curator · night owl 🦉"),
      Mika: gt("plays way too many indie games"),
      Jun: gt("clip enjoyer, rarely sleeps"),
      Kai: gt("ranked grinder 🎮"),
      Nova: gt("raid leader · pink everything"),
      Leo: gt("screenshots & sunsets 📸"),
    };
    // Rich presence (game name, a detail line, the game's art).
    const activity: Partial<Record<Person, { kind: "game" | "music"; text: string; detail?: string; art?: string }>> = {
      Theo: { kind: "game", text: "Final Fantasy XVI", detail: gt("Photo mode"), art: SHOTS.castle },
      Aya: { kind: "game", text: "Octopath Traveler", detail: gt("Chapter 2, Frostlands"), art: SHOTS.snowyCliff },
      Mika: { kind: "game", text: "Planet Coaster", detail: gt("Building a park"), art: SHOTS.coaster },
      Rin: { kind: "music", text: "Lo-fi Beats — Chillhop" },
      Kai: { kind: "game", text: "Final Fantasy XVI", detail: gt("Fighting an Eikon"), art: SHOTS.castle },
      Leo: { kind: "game", text: "Palworld", detail: gt("At base"), art: "/home/screenshare-palworld.webp" },
    };

    return { servers, seeds, forumPosts, thread, talks, replyFor, mentions, joins, bios, activity };
  }, [gt, times]);
}

export type LiveStrings = ReturnType<typeof useLiveStrings>;
