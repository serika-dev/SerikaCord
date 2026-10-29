import { getGT } from "gt-next/server";
import { Plus } from "lucide-react";
import type { FaqEntry } from "@/lib/jsonLd";
import { SectionHeading } from "./SectionHeading";

/** The homepage questions, translated. Also feeds the FAQPage JSON-LD. */
export async function getHomeFaq(): Promise<FaqEntry[]> {
  const gt = await getGT();
  return [
    {
      question: gt("Is SerikaCord free?"),
      answer: gt("Yes. Servers, voice and video calls, screen sharing and DMs are free. Serika+ is an optional subscription for extras such as bigger file uploads."),
    },
    {
      question: gt("Are my messages end-to-end encrypted?"),
      answer: gt("New DMs and group DMs, and their voice and video calls, are end-to-end encrypted by default, so only the people in the conversation can read them. You set a 6-digit PIN once to unlock them on new devices. Messages in server channels are encrypted at rest on our servers but not end to end, so bots, search and moderation can work there."),
    },
    {
      question: gt("Who runs SerikaCord?"),
      answer: gt("Serika Company, a small team based in the Netherlands. We handle your data under the EU's GDPR, we don't show ads, and we don't sell your data."),
    },
    {
      question: gt("Is SerikaCord open source?"),
      answer: gt("No, it's source available. The code is on GitHub, and you can self-host it for yourself and the people you invite, as long as it isn't commercial. For commercial use, email partners@serika.dev."),
    },
    {
      question: gt("Can I bring my Discord bot?"),
      answer: gt("Usually, yes. SerikaCord has a Discord-compatible (v10) bot API and gateway, so most discord.js and discord.py bots can connect by changing the API base URL. Create a bot and get its token in the developer portal."),
    },
    {
      question: gt("Can my Discord server and SerikaCord talk to each other?"),
      answer: gt("Yes, with the Discord bridge, which links a SerikaCord channel to a Discord channel. Messages only cross over for people who have agreed to it, on both sides."),
    },
    {
      question: gt("Is there an iPhone app?"),
      answer: gt("It's on its way: the SerikaCord app for iPhone and iPad is coming to the App Store. Until then, open serika.chat in Safari and add it to your Home Screen to use it like an app."),
    },
    {
      question: gt("Which devices does SerikaCord work on?"),
      answer: gt("Windows, macOS on Apple silicon, Linux, Android, and any modern web browser, including on iPhone and iPad."),
    },
  ];
}

export async function HomeFaq({ items }: { items: FaqEntry[] }) {
  const gt = await getGT();
  return (
    <section id="faq" aria-labelledby="hm-faq-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto grid max-w-[1200px] gap-6 px-4 sm:gap-10 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-10">
        <SectionHeading
          id="hm-faq-title"
          label={gt("FAQ")}
          title={gt("Questions, answered.")}
          lede={
            <>
              {gt("Something else on your mind? Email us at")}{" "}
              <a href="mailto:support@serika.dev" className="hm-link">
                support@serika.dev
              </a>
            </>
          }
        />
        <div className="flex flex-col gap-2 sm:gap-3" data-reveal>
          {items.map((item) => (
            <details key={item.question} className="hm-faq hm-card group !rounded-[16px]">
              <summary className="flex items-center justify-between gap-4 px-4 py-3 text-[0.95rem] font-semibold leading-snug text-[var(--hm-ink)] sm:px-5 sm:py-4 sm:text-base">
                <span>{item.question}</span>
                <Plus className="hm-faq-icon h-5 w-5 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
              </summary>
              <p className="px-4 pb-4 text-sm leading-relaxed sm:px-5 sm:pb-5 sm:text-base">{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
