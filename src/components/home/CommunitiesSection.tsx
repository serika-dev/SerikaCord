import type { CSSProperties, ReactNode } from "react";
import { getGT } from "gt-next/server";
import { BarChart3, Check, ClipboardCheck, Hash, MessagesSquare, Shield, ShieldAlert, UserCog } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeading } from "./SectionHeading";
import { Av } from "./preview/parts";

/**
 * Communities, as a bento grid. Each card has a small working piece of the
 * app on top (toggles, a poll, a checklist that ticks itself, posts that fan
 * out) built with CSS and native inputs only, so the section stays a server
 * component. Phones get the
 * compact text rows without the art.
 */

function Card({
  icon: Icon,
  title,
  text,
  art,
  className,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  art?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("hm-card hm-bento flex gap-3 !rounded-[16px] p-3.5 sm:flex-col sm:gap-0 sm:!rounded-[24px] sm:p-0", className)}>
      {art && <div className="hm-bento-art hidden sm:block">{art}</div>}
      <div className="flex min-w-0 gap-3 sm:flex-col sm:gap-3 sm:p-6">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--brand-violet)_14%,transparent)] text-[var(--hm-accent-text)] sm:hidden"
          aria-hidden
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <h3 className="hm-h3 flex items-center gap-2 !text-[1rem] sm:!text-[1.15rem]">
            <Icon className="hidden h-[18px] w-[18px] text-[var(--hm-accent-text)] sm:block" aria-hidden />
            {title}
          </h3>
          <p className="mt-0.5 text-sm leading-snug sm:mt-1.5 sm:text-[0.95rem] sm:leading-relaxed">{text}</p>
        </div>
      </div>
    </article>
  );
}

/** Role pills, with permission switches you can flip. */
function RolesArt({ gt }: { gt: Awaited<ReturnType<typeof getGT>> }) {
  const roles = [
    { name: gt("Admin"), color: "#ef4444" },
    { name: gt("Moderator"), color: "#3BA55C" },
    { name: gt("Artist"), color: "#ec4899" },
    { name: gt("Member"), color: "#8b5cf6" },
  ];
  const perms = [
    { label: gt("Manage messages"), on: true },
    { label: gt("Kick members"), on: false },
    { label: gt("Mention @everyone"), on: true },
  ];
  return (
    <div className="grid h-full grid-cols-[0.9fr_1.1fr] items-center gap-6 px-7 py-6">
      <div className="hm-role-stack" aria-hidden="true">
        {roles.map((r, i) => (
          <span key={r.name} className="hm-role" style={{ "--i": i, "--c": r.color } as CSSProperties}>
            <span className="h-3 w-3 rounded-full" style={{ background: r.color }} />
            {r.name}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-2.5">
        {perms.map((p) => (
          <label key={p.label} className="hm-perm">
            <span className="text-sm font-medium text-[var(--app-text)]">{p.label}</span>
            <input type="checkbox" defaultChecked={p.on} tabIndex={-1} className="peer sr-only" aria-label={p.label} />
            <span className="hm-switch" aria-hidden />
          </label>
        ))}
      </div>
    </div>
  );
}

/** A poll you can vote in (radio inputs). */
function PollArt({ gt }: { gt: Awaited<ReturnType<typeof getGT>> }) {
  const answers = [
    { text: gt("Pizza 🍕"), pct: 54 },
    { text: gt("Ramen 🍜"), pct: 31 },
    { text: gt("Tacos 🌮"), pct: 15 },
  ];
  return (
    <fieldset className="flex h-full flex-col justify-center gap-2 px-6 py-6">
      <legend className="sr-only">{gt("Dinner tonight?")}</legend>
      <p className="mb-1 text-sm font-semibold text-[var(--app-text)]" aria-hidden>
        {gt("Dinner tonight?")}
      </p>
      {answers.map((a, i) => (
        <label key={a.text} className="hm-poll-row" style={{ "--p": `${a.pct}%`, "--i": i } as CSSProperties}>
          <input type="radio" name="hm-bento-poll" defaultChecked={i === 0} tabIndex={-1} className="peer sr-only" />
          <span className="hm-poll-fill" aria-hidden />
          <span className="relative flex-1 text-sm text-[var(--app-text)]">{a.text}</span>
          <Check className="hm-poll-check relative h-4 w-4 text-[var(--app-accent)]" aria-hidden />
          <span className="relative w-9 text-end text-sm font-semibold text-[var(--app-text)]">{a.pct}%</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Onboarding steps that tick themselves off, on a loop. */
function OnboardingArt({ gt }: { gt: Awaited<ReturnType<typeof getGT>> }) {
  const steps = [gt("Read the rules"), gt("Pick your games"), gt("Say hi in #welcome")];
  return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-6 py-6" aria-hidden="true">
      {steps.map((s, i) => (
        <div key={s} className="hm-step" style={{ "--i": i } as CSSProperties}>
          <span className="hm-step-box">
            <Check className="h-3.5 w-3.5" />
          </span>
          <span className="text-sm text-[var(--app-text)]">{s}</span>
        </div>
      ))}
    </div>
  );
}

/** Forum posts stacked in depth; they fan out when you hover the card. */
function ForumArt({ gt }: { gt: Awaited<ReturnType<typeof getGT>> }) {
  const posts = [
    { title: gt("Bug: can't join voice"), by: "Jun", tag: gt("Solved") },
    { title: gt("Share your setups 🖥️"), by: "Aya", tag: gt("Showcase") },
    { title: gt("Patch notes megathread"), by: "Theo", tag: gt("News") },
  ];
  return (
    <div className="hm-posts" aria-hidden="true">
      {posts.map((p, i) => (
        <div key={p.title} className="hm-post" style={{ "--i": i } as CSSProperties}>
          <Av name={p.by} className="h-7 w-7" fallbackClassName="text-xs" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--app-text)]">{p.title}</div>
            <div className="text-xs text-[var(--app-muted)]">{p.by}</div>
          </div>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--app-accent)_18%,transparent)] px-2 py-0.5 text-[11px] font-semibold text-[var(--app-accent)]">{p.tag}</span>
        </div>
      ))}
    </div>
  );
}

/** AutoMod catching a scam link. */
function ModerationArt({ gt }: { gt: Awaited<ReturnType<typeof getGT>> }) {
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-6 py-6" aria-hidden="true">
      <div className="hm-blocked">
        <div className="flex items-center gap-2 text-xs text-[var(--app-muted)]">
          <Hash className="h-3.5 w-3.5" />
          {gt("general")}
        </div>
        <p className="mt-1 text-sm text-[var(--app-text)] line-through decoration-[#ef4444]/70">{gt("free gift cards 👉 totally-legit.link")}</p>
      </div>
      <div className="hm-automod">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span className="text-[13px] font-medium">{gt("AutoMod blocked a message")}</span>
      </div>
    </div>
  );
}

export async function CommunitiesSection() {
  const gt = await getGT();

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

        <div className="hm-bento-grid mt-6 grid gap-2 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3" data-reveal data-reveal-stagger>
          <Card
            className="lg:col-span-2"
            icon={UserCog}
            title={gt("Roles and permissions")}
            text={gt("Give people roles with their own colors and exactly the permissions they need, for the whole server or a single channel.")}
            art={<RolesArt gt={gt} />}
          />
          <Card
            icon={BarChart3}
            title={gt("Polls")}
            text={gt("Ask a question with up to 10 answers and watch the votes come in live, in servers, DMs and group DMs.")}
            art={<PollArt gt={gt} />}
          />
          <Card
            icon={ClipboardCheck}
            title={gt("Onboarding and rules screening")}
            text={gt("Ask new members a few questions that hand out roles, and keep channels hidden until they accept the rules.")}
            art={<OnboardingArt gt={gt} />}
          />
          <Card
            icon={MessagesSquare}
            title={gt("Forums, threads and tickets")}
            text={gt("Give long conversations their own space, and handle support requests as private tickets inside your server.")}
            art={<ForumArt gt={gt} />}
          />
          <Card
            icon={Shield}
            title={gt("Moderation that keeps up")}
            text={gt("Spam and raid protection, AutoMod, timeouts, and an audit log of who changed what and why.")}
            art={<ModerationArt gt={gt} />}
          />
          <article className="hm-card flex flex-col gap-2.5 !rounded-[16px] p-3.5 sm:col-span-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-2.5 sm:!rounded-[24px] sm:px-7 sm:py-5 lg:col-span-3">
            <h3 className="hm-h3 !text-[1rem] sm:me-3 sm:!text-[1.1rem]">{gt("Also included")}</h3>
            <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:flex sm:flex-wrap sm:gap-x-6 sm:gap-y-2">
              {extras.map((x) => (
                <li key={x} className="flex items-start gap-2 text-[13px] leading-snug text-[var(--hm-ink)] sm:items-center sm:!text-[0.92rem]">
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
