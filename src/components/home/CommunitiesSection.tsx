import { getGT } from "gt-next/server";
import { BarChart3, Check, ClipboardCheck, MessagesSquare, Shield, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

function Feature({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <article className="hm-card flex flex-col gap-4 p-6 sm:p-7" data-reveal>
      <span
        className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)]"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h3 className="hm-h3">{title}</h3>
        <p className="mt-1.5 text-[0.95rem] leading-relaxed">{text}</p>
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
    <section id="features" aria-labelledby="hm-features-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-features-title"
          label={gt("Communities")}
          title={gt("Run your server the way you want.")}
          lede={gt("Channels, roles and permissions work the way you're used to, with the tools to welcome new people and keep the place friendly as it grows.")}
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Feature key={f.title} icon={f.icon} title={f.title} text={f.text} />
          ))}
          <article className="hm-card flex flex-col gap-4 p-6 sm:p-7" data-reveal>
            <h3 className="hm-h3">{gt("Also included")}</h3>
            <ul className="flex flex-col gap-2.5">
              {extras.map((x) => (
                <li key={x} className="flex items-center gap-2.5 text-[0.95rem] text-[var(--hm-ink)]">
                  <Check className="h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
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
