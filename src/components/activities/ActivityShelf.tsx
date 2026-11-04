"use client";
/**
 * The Activity shelf (launcher) for a chat or a call (CORD-92), like Discord's:
 * what's running here, recents, and the Activities this person may start
 * (verified apps, their own apps, apps they authorized). With Developer Mode
 * on it is the "Developer Activity Shelf": own apps can launch from a URL
 * override (a tunnel to your machine) without touching the URL mappings.
 * Launching in a text chat posts a Game Invitation; in a call it's bound to the call.
 */
import { useEffect, useMemo, useState } from "react";
import { useGT } from "gt-next";
import { BadgeCheck, Rocket, Search, Users, Wrench } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { cdnImage } from "@/lib/utils";
import {
  closeActivityShelf, joinActivity, launchActivity, platformHint, type InstanceView, type ShelfRequest,
} from "@/lib/activities/clientStore";

interface ShelfApp {
  id: string;
  name: string;
  icon: string | null;
  imageUrl: string | null;
  description: string;
  ageGated: boolean;
  supportedPlatforms: string[];
  developer: boolean;
  verified: boolean;
}

interface ShelfData { available: boolean; developerMode?: boolean; apps: ShelfApp[]; recents?: string[]; running: InstanceView[] }

const OVERRIDE_KEY = "sc:activity-url-override";

function readOverride(): { on: boolean; url: string } {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    const v = raw ? JSON.parse(raw) as { on?: unknown; url?: unknown } : null;
    return { on: v?.on === true, url: typeof v?.url === "string" ? v.url : "" };
  } catch {
    return { on: false, url: "" };
  }
}

function writeOverride(v: { on: boolean; url: string }) {
  try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(v)); } catch { /* storage off */ }
}

export default function ActivityShelf({ request }: { request: ShelfRequest }) {
  const gt = useGT();
  const [data, setData] = useState<ShelfData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [override, setOverride] = useState(readOverride);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ channelId: request.channelId, voice: request.voice ? "1" : "0" });
    fetch(`/api/activities/shelf?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ShelfData) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [request.channelId, request.voice]);

  const updateOverride = (v: { on: boolean; url: string }) => { setOverride(v); writeOverride(v); };
  const platform = platformHint();
  const running = (data?.running ?? []).filter((r) => (r.location?.voice ?? false) === request.voice);
  const apps = useMemo(() => {
    const list = data?.apps ?? [];
    const q = query.trim().toLowerCase();
    return q ? list.filter((a) => a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)) : list;
  }, [data, query]);
  const recents = useMemo(() => {
    const byId = new Map((data?.apps ?? []).map((a) => [a.id.toLowerCase(), a]));
    return (data?.recents ?? []).map((id) => byId.get(id.toLowerCase())).filter((a): a is ShelfApp => !!a);
  }, [data]);
  const devShelf = Boolean(data?.developerMode);

  const launch = async (app: ShelfApp) => {
    setBusy(app.id);
    const url = devShelf && override.on && app.developer && override.url.trim() ? override.url.trim() : undefined;
    await launchActivity(app.id, request.channelId, request.voice, false, app.name, url);
    setBusy(null);
  };
  const join = async (id: string, name: string) => {
    setBusy(id);
    await joinActivity(id, false, name);
    setBusy(null);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) closeActivityShelf(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="size-5" style={{ color: "var(--app-accent)" }} />{gt("Activities")}</DialogTitle>
          <DialogDescription>
            {request.voice ? gt("Play together with everyone in this call.") : gt("Start an Activity here. Everyone in the chat can join.")}
          </DialogDescription>
        </DialogHeader>

        {devShelf && (
          <section className="rounded-lg border p-3 space-y-2" style={{ borderColor: "var(--app-border)" }}>
            <p className="text-sm flex items-center gap-2" style={{ color: "var(--app-muted)" }}>
              <Wrench className="size-4" />{gt("You are using the Developer Activity Shelf. Your own apps are listed first.")}
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={override.on} onChange={(e) => updateOverride({ ...override, on: e.target.checked })} className="accent-[var(--app-accent)]" />
              {gt("Use Activity URL Override")}
            </label>
            {override.on && (
              <>
                <input
                  value={override.url}
                  onChange={(e) => updateOverride({ ...override, url: e.target.value })}
                  placeholder="my-tunnel.trycloudflare.com"
                  aria-label={gt("Activity URL Override")}
                  className="w-full rounded-lg border px-3 py-2 text-sm bg-transparent font-mono"
                  style={{ borderColor: "var(--app-border)", color: "var(--app-text)" }}
                />
                <p className="text-xs" style={{ color: "var(--app-muted)" }}>
                  {gt("Your own apps launch from this address instead of their root URL mapping. It must be a public domain (e.g. a tunnel); other mappings still apply.")}
                </p>
              </>
            )}
          </section>
        )}

        {data?.available && (
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--app-muted)" }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={gt("Search")}
              aria-label={gt("Search Activities")}
              className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm bg-transparent"
              style={{ borderColor: "var(--app-border)", color: "var(--app-text)" }}
            />
          </div>
        )}

        {!data && !failed && <div className="flex justify-center py-10"><Loader size={24} className="size-6" /></div>}
        {failed && <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{gt("Couldn't load Activities. Try again.")}</p>}
        {data && !data.available && <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{gt("Activities are not available on this server.")}</p>}

        {data?.available && running.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--app-muted)" }}>{gt("Playing now")}</h3>
            <ul className="space-y-2">
              {running.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: "var(--app-border)" }}>
                  {r.app?.icon ? <img src={cdnImage(r.app.icon)} alt="" className="size-10 rounded-lg object-cover" /> : <div className="size-10 rounded-lg" style={{ background: "var(--app-accent)" }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.app?.name}</p>
                    <p className="text-xs flex items-center gap-1" style={{ color: "var(--app-muted)" }}><Users className="size-3" />{gt("{count} playing", { count: r.participants?.length ?? 0 })}</p>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => void join(r.id, r.app?.name ?? "")} className="px-3 py-1.5 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: "var(--app-accent)" }}>
                    {busy === r.id ? <Loader size={16} className="size-4" /> : gt("Join")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data?.available && recents.length > 0 && !query && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--app-muted)" }}>{gt("Recents")}</h3>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {recents.map((a) => (
                <button key={a.id} type="button" title={a.name} aria-label={a.name} disabled={busy !== null} onClick={() => void launch(a)} className="size-14 shrink-0 rounded-xl overflow-hidden border hover:opacity-90 disabled:opacity-50" style={{ borderColor: "var(--app-border)", background: "var(--app-surface)" }}>
                  {a.icon ? <img src={cdnImage(a.icon)} alt="" className="w-full h-full object-cover" /> : <Rocket className="size-6 m-auto" />}
                </button>
              ))}
            </div>
          </section>
        )}

        {data?.available && (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--app-muted)" }}>{gt("Activities")}</h3>
            {apps.length === 0 ? (
              <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{query ? gt("No Activities match your search.") : gt("No Activities can be started here yet.")}</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {apps.map((a) => {
                  const supported = a.supportedPlatforms.includes(platform);
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={!supported || busy !== null}
                        onClick={() => void launch(a)}
                        className="w-full text-left rounded-xl border overflow-hidden hover:opacity-90 disabled:opacity-50"
                        style={{ borderColor: "var(--app-border)", background: "var(--app-surface)" }}
                      >
                        <div className="relative aspect-video w-full" style={{ background: "var(--app-bg)" }}>
                          {(a.imageUrl || a.icon) && <img src={cdnImage(a.imageUrl ?? a.icon)} alt="" className="w-full h-full object-cover" />}
                          <div className="absolute top-2 right-2 flex gap-1">
                            {a.ageGated && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>{gt("18+")}</span>}
                            {a.developer && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,.6)", color: "#fff" }}>{gt("Your app")}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2.5 p-2.5">
                          {a.icon ? <img src={cdnImage(a.icon)} alt="" className="size-9 rounded-full object-cover shrink-0" /> : <span className="size-9 rounded-full shrink-0" style={{ background: "var(--app-accent)" }} />}
                          <div className="min-w-0">
                            <p className="text-sm font-semibold truncate flex items-center gap-1">
                              {a.name}
                              {a.verified && <BadgeCheck className="size-3.5 shrink-0" style={{ color: "var(--app-accent)" }} aria-label={gt("Verified")} />}
                            </p>
                            <p className="text-xs truncate" style={{ color: "var(--app-muted)" }}>
                              {busy === a.id ? gt("Starting…") : supported ? (a.description || gt("Start")) : gt("Not available on this device")}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
