import { DocPage, P, H2, H3, Callout, InlineCode, Link2, Table } from "../../DocPage";
import { buildMetadata } from "@/lib/seo";
import { getGT } from "gt-next/server";
import { DISCORD_COMPAT } from "@/lib/constants/discordCompat.generated";

export const metadata = buildMetadata({
  title: "Discord API Compatibility",
  description:
    "Which Discord API v10 routes, gateway events and protocol features SerikaCord implements, generated from the parity checker.",
  path: "/developers/docs/topics/compatibility",
  keywords: ["SerikaCord Discord compatibility", "Discord API v10", "discord.js", "discord.py", "bot API coverage"],
});

type Status = "implemented" | "partial" | "missing";

export default async function CompatibilityDoc() {
  const gt = await getGT();
  const label = (s: string) =>
    s === "implemented" || s === "emitted" || s === "yes"
      ? gt("Supported")
      : s === "partial"
        ? gt("Partial")
        : s === "defined-unused"
          ? gt("Not sent yet")
          : gt("Missing");
  const data = DISCORD_COMPAT;
  const byArea = new Map<string, Array<(typeof data.routes)[number]>>();
  for (const r of data.routes) {
    const list = byArea.get(r.a);
    if (list) list.push(r);
    else byArea.set(r.a, [r]);
  }
  const count = (rows: ReadonlyArray<{ s: string }>, s: Status) => rows.filter((r) => r.s === s).length;

  return (
    <DocPage
      title={gt("Discord API compatibility")}
      description={gt("Every Discord API v10 route and gateway event, and whether SerikaCord supports it. Generated from the same checker the team uses in CI.")}
    >
      <P>
        {gt("Coverage: {impl} of {total} REST routes supported and {partial} partly supported.", {
          impl: data.restAll.implemented,
          total: data.restAll.total,
          partial: data.restAll.partial,
        })}{" "}
        {gt("Spec snapshot: discord-api-spec {sha}.", { sha: String(data.sources.spec.sha).slice(0, 7) })}
      </P>
      <Callout type="info" title={gt("How to read this")}>
        {gt("Supported means the route exists under /api/v10 with Discord's path and reads the documented fields. Partial means it exists with known gaps (listed in the notes). The checker can't prove behaviour; see")}{" "}
        <Link2 href="/developers/docs/topics/differences">{gt("Differences from Discord")}</Link2>.
      </Callout>

      <H2 id="areas">{gt("By area")}</H2>
      <Table
        headers={[gt("Area"), gt("Supported"), gt("Partial"), gt("Missing")]}
        rows={data.areas.map((a) => [a.title, String(a.implemented), String(a.partial), String(a.missing)])}
      />

      <H2 id="routes">{gt("REST routes")}</H2>
      {data.areas.map((a) => {
        const rows = byArea.get(a.id) ?? [];
        if (rows.length === 0) return null;
        return (
          <div key={a.id}>
            <H3 id={`area-${a.id}`}>
              {a.title} ({count(rows, "implemented")}/{rows.length})
            </H3>
            <Table
              headers={[gt("Status"), gt("Route"), gt("Notes")]}
              rows={rows.map((r) => [label(r.s), <InlineCode key="p">{`${r.m} ${r.p}`}</InlineCode>, r.n])}
            />
          </div>
        );
      })}

      <H2 id="events">{gt("Gateway events")}</H2>
      <Table headers={[gt("Status"), gt("Event"), gt("Notes")]} rows={data.events.map((e) => [label(e.s), <InlineCode key="e">{e.e}</InlineCode>, e.n])} />

      <H2 id="features">{gt("Protocol features")}</H2>
      <Table headers={[gt("Status"), gt("Feature")]} rows={data.features.map((f) => [label(f.s), f.t])} />
    </DocPage>
  );
}
