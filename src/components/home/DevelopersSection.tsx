import Link from "next/link";
import { getGT } from "gt-next/server";
import { ArrowRight, Check, Copy, ShieldCheck } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

export async function DevelopersSection() {
  const gt = await getGT();

  return (
    <section id="developers" aria-labelledby="hm-dev-title" className="scroll-mt-20 py-20 sm:py-28">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">
        <SectionHeading
          id="hm-dev-title"
          label={gt("Bots and Discord")}
          title={gt("Bring your bots. Bridge your Discord.")}
          lede={gt("SerikaCord speaks Discord's bot API, so the tools your community relies on can come along, and a consent-based bridge keeps you connected while people move over.")}
        />

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {/* Bot API */}
          <article className="hm-card flex flex-col" data-reveal>
            {/* The endpoints block from /developers/docs/intro, drawn like the docs' CodeBlock. */}
            <div className="hm-card-art p-4 sm:p-6" aria-hidden="true">
              <div className="rounded-xl border border-white/[0.08] overflow-hidden bg-[#0d0d0d]" dir="ltr">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
                  <span className="text-xs font-mono text-green-400 uppercase tracking-wide">bash</span>
                  <span className="text-xs text-[#666] flex items-center gap-1.5 px-2 py-1 rounded">
                    <Copy className="size-3" />
                    <span>{gt("Copy")}</span>
                  </span>
                </div>
                <pre className="p-4 overflow-x-auto text-[13px]">
                  <code className="font-mono text-[#dbdee1] leading-relaxed">{`REST     https://api.serika.chat/api/v10
Gateway  wss://api.serika.chat/api/v10/gateway
OAuth2   https://api.serika.chat/api/oauth2/authorize`}</code>
                </pre>
              </div>
            </div>
            <div className="flex flex-1 flex-col p-5 sm:p-6">
              <h3 className="hm-h3">{gt("A Discord-compatible bot API")}</h3>
              <p className="mt-1.5 text-[0.93rem] leading-relaxed">
                {gt("The same v10 REST routes, gateway events and data structures. Existing discord.js and discord.py bots can usually connect by changing the API base URL.")}
              </p>
              <ul className="mt-4 flex flex-col gap-2 text-[0.93rem]">
                {[
                  gt("Slash commands, buttons and other interactions"),
                  gt("Webhooks and rich embeds"),
                  gt("The official serika.js SDK for TypeScript"),
                ].map((x) => (
                  <li key={x} className="flex gap-2.5">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
                    <span className="text-[var(--hm-ink)]">{x}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap gap-x-5 gap-y-2 pt-6">
                <Link href="/developers" className="hm-link inline-flex items-center gap-1.5">
                  {gt("Open the developer portal")}
                  <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Link>
                <Link href="/developers/docs/intro" className="hm-link">
                  {gt("Read the API docs")}
                </Link>
              </div>
            </div>
          </article>

          {/* Discord bridge */}
          <article className="hm-card flex flex-col" data-reveal>
            <div className="flex flex-1 flex-col p-5 sm:p-6">
              <h3 className="hm-h3">{gt("A Discord bridge built on consent")}</h3>
              <p className="mt-1.5 text-[0.93rem] leading-relaxed">
                {gt("Link a SerikaCord channel to a Discord channel and talk across both while your community moves. Nobody's messages cross over unless they've agreed to it, in either direction.")}
              </p>
              <p className="mt-4 flex gap-2.5 text-[0.93rem]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--hm-accent-text)]" aria-hidden />
                <span className="text-[var(--hm-ink)]">
                  {gt("People on Discord can change their mind at any time and ask for their bridged data to be deleted.")}
                </span>
              </p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
