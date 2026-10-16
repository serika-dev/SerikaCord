import { getGT } from "gt-next/server";
import { BarChart3, Check, ClipboardCheck, MessagesSquare, Shield, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    // Phones: a compact row (icon beside the text); from sm up: a roomy card.
    <article className="hm-card flex gap-3 !rounded-[16px] p-3.5 sm:flex-col sm:gap-4 sm:!rounded-[24px] sm:p-7" data-reveal>
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)] sm:h-11 sm:w-11 sm:rounded-[12px]"
        aria-hidden
      >
        <Icon className="h-[18px] w-[18px] sm:h-5 sm:w-5" />
      </span>
      <div className="min-w-0">
        <h3 className="hm-h3 !text-[1rem] sm:!text-[1.2rem]">{title}</h3>
        <p className="mt-0.5 text-sm leading-snug sm:mt-1.5 sm:text-[0.95rem] sm:leading-relaxed">{text}</p>
      </div>
    </article>
  );
}

export async function CommunitiesSection() {
  const gt = await getGT();

  const features = [
    {
      icon: UserCog,
      title: gt("Roles and permissions"),
      text: gt("Give people roles with their own colors and exactly the permissions they need, for the whole server or a single channel."),
    },
    {
      icon: ClipboardCheck,
      title: gt("Onboarding and rules screening"),
      text: gt("Ask new members a few questions that hand out roles, and keep channels hidden until they accept the rules."),
    },
    {
      icon: MessagesSquare,
      title: gt("Forums, threads and tickets"),
      text: gt("Give long conversations their own space, and handle support requests as private tickets inside your server."),
    },
    {
      icon: BarChart3,
      title: gt("Polls"),
      text: gt("Ask a question with up to 10 answers and watch the votes come in live, in servers, DMs and group DMs."),
    },
    {
      icon: Shield,
      title: gt("Moderation that keeps up"),
      text: gt("Spam and raid protection, AutoMod, timeouts, and an audit log of who changed what and why."),
    },
  ];

  const extras = [
    gt("Custom emoji and stickers"),
    gt("Soundboard"),
    gt("Announcement channels"),
    gt("Search with filters"),
    gt("Server discovery"),
    gt("Webhooks"),
  ];

  return (
    <section id="features" aria-labelledby="hm-features-title" className="scroll-mt-20 py-8 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-features-title"
          label={gt("Communities")}
          title={gt("Run your server the way you want.")}
          lede={gt("Channels, roles and permissions work the way you're used to, with the tools to welcome new people and keep the place friendly as it grows.")}
        />

        <div className="mt-6 grid gap-2 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {features.map((f) => (
            <Feature key={f.title} icon={f.icon} title={f.title} text={f.text} />
          ))}
          <article className="hm-card flex flex-col gap-2.5 !rounded-[16px] p-3.5 sm:gap-4 sm:!rounded-[24px] sm:p-7" data-reveal>
            <h3 className="hm-h3 !text-[1rem] sm:!text-[1.2rem]">{gt("Also included")}</h3>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-col sm:gap-2.5">
              {extras.map((x) => (
                <li key={x} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--hm-ink)] sm:items-center sm:gap-2.5 sm:text-[0.95rem]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--hm-accent-text)] sm:mt-0 sm:h-4 sm:w-4" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}
