import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { cache } from "react";
import { BadgeCheck, CalendarDays, ExternalLink, FileText, Globe, LifeBuoy, Lock, Plus, Server, Shield, Star } from "lucide-react";
import { getGT, getLocale } from "gt-next/server";
import { buildMetadata } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";
import { AppIcon, OfficialPill, VerifiedMark, formatCount } from "@/components/apps/AppDirectoryCard";
import { appCategoryLabel } from "@/lib/appDirectory/listing";
import { getDirectoryAppCached } from "@/lib/services/appDirectory";
import { cdnImage } from "@/lib/utils";
import { BotsShell, botsHref } from "../BotsParts";
import { BotCommands } from "./BotCommands";
import { BotDescription } from "./BotDescription";

export const dynamic = "force-dynamic";

type Params = Promise<{ appId: string }>;

// One lookup per request, shared by generateMetadata and the page.
const loadApp = cache(async (appId: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) return null;
  try {
    return await getDirectoryAppCached(appId);
  } catch (err) {
    console.error("[bots] app load failed:", (err as Error)?.message ?? err);
    return null;
  }
});

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { appId } = await params;
  const app = await loadApp(appId);
  const gt = await getGT();
  if (!app) return buildMetadata({ title: gt("Bot not found"), path: `/bots/${appId}`, noIndex: true });
  return buildMetadata({
    title: gt("{name}: SerikaCord bot", { name: app.name }),
    description: app.shortDescription || gt("Add {name} to your SerikaCord server.", { name: app.name }),
    path: `/bots/${app.id}`,
    image: app.coverImage ? cdnImage(app.coverImage) : app.icon ? cdnImage(app.icon) : undefined,
    keywords: [app.name, "SerikaCord bot", ...app.categories, ...app.tags],
  });
}

export default async function BotPage({ params }: { params: Params }) {
  const { appId } = await params;
  const app = await loadApp(appId);
  if (!app) notFound();
  const gt = await getGT();
  const locale = await getLocale();

  const categories = app.categories.map((c) => ({ id: c, label: appCategoryLabel(c, gt) }));
  const links = [
    app.supportUrl && { href: app.supportUrl, label: gt("Support server"), icon: LifeBuoy },
    app.website && { href: app.website, label: gt("Website"), icon: Globe },
    app.termsOfServiceUrl && { href: app.termsOfServiceUrl, label: gt("Terms of Service"), icon: FileText },
    app.privacyPolicyUrl && { href: app.privacyPolicyUrl, label: gt("Privacy Policy"), icon: Shield },
  ].filter(Boolean) as { href: string; label: string; icon: typeof Globe }[];
  const servers = app.serverCount === 1 ? gt("1 server") : gt("{count} servers", { count: formatCount(app.serverCount, locale) });

  const hero = (
    <div>
      <nav aria-label={gt("Breadcrumb")} className="mb-5 text-sm text-[var(--hm-faint)]">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li><Link href="/bots" className="transition-colors hover:text-[var(--hm-ink)]">{gt("Bot library")}</Link></li>
          {categories[0] && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden>/</span>
              <Link href={botsHref({ category: categories[0].id })} className="transition-colors hover:text-[var(--hm-ink)]">{categories[0].label}</Link>
            </li>
          )}
          <li className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden>/</span>
            <span aria-current="page" className="truncate text-[var(--hm-ink)]">{app.name}</span>
          </li>
        </ol>
      </nav>

      {app.coverImage && (
        <div className="mb-6 aspect-[3/1] w-full overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.04] sm:mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-uploaded CDN cover */}
          <img src={cdnImage(app.coverImage)} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <AppIcon icon={app.icon} name={app.name} size={88} className="border border-white/10 max-sm:!h-16 max-sm:!w-16" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="hm-display truncate text-[1.75rem] font-bold leading-tight sm:text-[2.4rem]">{app.name}</h1>
              {app.verified && <VerifiedMark label={gt("Verified app")} className="[&_svg]:h-6 [&_svg]:w-6" />}
              {app.official && <OfficialPill label={gt("Official")} hint={gt("Made by SerikaCord")} className="text-[11px]" />}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--hm-body)]">
              <span className="inline-flex items-center gap-1"><Server className="h-4 w-4" aria-hidden />{servers}</span>
              {app.official ? (
                <span className="inline-flex items-center gap-1"><BadgeCheck className="h-4 w-4" aria-hidden />{gt("Made by SerikaCord")}</span>
              ) : app.verified ? (
                <span className="inline-flex items-center gap-1"><BadgeCheck className="h-4 w-4" aria-hidden />{gt("Verified")}</span>
              ) : null}
              {app.featured && <span className="inline-flex items-center gap-1"><Star className="h-4 w-4" aria-hidden />{gt("Staff pick")}</span>}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {app.installUrl ? (
            <a href={app.installUrl} className="hm-btn hm-btn-primary">
              <Plus className="h-5 w-5" aria-hidden />
              {gt("Add to Server")}
            </a>
          ) : (
            <span className="flex flex-col gap-1.5">
              <button type="button" disabled aria-describedby="bot-private-note" className="hm-btn hm-btn-ghost cursor-not-allowed opacity-60">
                <Lock className="h-4 w-4" aria-hidden />
                {gt("Add to Server")}
              </button>
              <span id="bot-private-note" className="max-w-xs text-xs text-[var(--hm-body)]">
                {gt("This bot is private right now: only its developer can add it to servers.")}
              </span>
            </span>
          )}
          {app.supportUrl && (
            <a href={app.supportUrl} target="_blank" rel="noopener noreferrer nofollow" className="hm-btn hm-btn-ghost">
              <LifeBuoy className="h-4 w-4" aria-hidden />
              {gt("Support")}
            </a>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <BotsShell hero={hero}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: app.name,
          description: app.shortDescription || undefined,
          applicationCategory: "CommunicationApplication",
          operatingSystem: "Web",
          url: `https://serika.chat/bots/${app.id}`,
          image: app.icon ?? undefined,
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
        }}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <div className="min-w-0 space-y-10">
          <section aria-labelledby="about-title">
            <h2 id="about-title" className="hm-display hm-h2-page mb-4">{gt("About {name}", { name: app.name })}</h2>
            {app.shortDescription && <p className="mb-4 text-base font-medium text-[var(--hm-ink)]">{app.shortDescription}</p>}
            {app.longDescription ? (
              <BotDescription content={app.longDescription} />
            ) : (
              !app.shortDescription && <p className="text-sm text-[var(--hm-body)]">{gt("The developer hasn't written a description yet.")}</p>
            )}
          </section>

          {app.commands.length > 0 && <BotCommands commands={app.commands} />}
        </div>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--hm-faint)]">{gt("At a glance")}</h2>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-2 text-[var(--hm-body)]"><Server className="h-4 w-4 shrink-0 text-[var(--hm-faint)]" aria-hidden />{gt("Servers")}</dt>
                <dd className="font-semibold text-[var(--hm-ink)]">{formatCount(app.serverCount, locale)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-2 text-[var(--hm-body)]"><BadgeCheck className="h-4 w-4 shrink-0 text-[var(--hm-faint)]" aria-hidden />{gt("Status")}</dt>
                <dd className="text-end font-semibold text-[var(--hm-ink)]">
                  {app.official ? gt("Official app") : app.verified ? gt("Verified app") : gt("Community app")}
                </dd>
              </div>
              {app.createdAt && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="inline-flex items-center gap-2 text-[var(--hm-body)]"><CalendarDays className="h-4 w-4 shrink-0 text-[var(--hm-faint)]" aria-hidden />{gt("Created")}</dt>
                  <dd className="font-semibold text-[var(--hm-ink)]">{new Date(app.createdAt).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--hm-faint)]">{gt("Categories")}</h2>
            {categories.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {categories.map((c) => (
                  <li key={c.id}>
                    <Link href={botsHref({ category: c.id })} className="hm-chip !py-1 text-sm hover:border-[var(--brand-violet)]">{c.label}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--hm-body)]">{gt("Not categorized")}</p>
            )}
            {app.tags.length > 0 && (
              <>
                <h2 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-[var(--hm-faint)]">{gt("Tags")}</h2>
                <ul className="flex flex-wrap gap-1.5">
                  {app.tags.map((t) => (
                    <li key={t} className="rounded-full bg-[var(--hm-surface-2)] px-2.5 py-0.5 text-xs text-[var(--hm-body)]">{t}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {links.length > 0 && (
            <div className="rounded-2xl border border-[var(--hm-line)] bg-[var(--hm-surface)] p-5">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-[var(--hm-faint)]">{gt("Links")}</h2>
              <ul className="space-y-2">
                {links.map(({ href, label, icon: Icon }) => (
                  <li key={label}>
                    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2 text-sm text-[var(--hm-ink)] hover:text-[var(--hm-accent-text)]">
                      <Icon className="h-4 w-4 shrink-0 text-[var(--hm-faint)]" aria-hidden />
                      <span className="truncate">{label}</span>
                      <ExternalLink className="ms-auto h-3.5 w-3.5 shrink-0 text-[var(--hm-faint)]" aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="px-1 text-xs leading-relaxed text-[var(--hm-faint)]">
            {app.official
              ? gt("This is an official app, made and run by the SerikaCord team. Check the permissions it asks for before adding it.")
              : gt("Bots are made by independent developers, not by SerikaCord. Check the permissions a bot asks for before adding it.")}
          </p>
        </aside>
      </div>
    </BotsShell>
  );
}
