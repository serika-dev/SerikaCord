"use client";
/**
 * The Activity shelf (launcher) for a chat or a call (CORD-92): what's running
 * here (join it) and the Activities that can be launched here. Launching in a
 * text chat posts a Game Invitation; in a call the Activity is bound to the call.
 */
import { useEffect, useState } from "react";
import { useGT } from "gt-next";
import { Rocket, Users } from "lucide-react";
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
}

interface ShelfData { available: boolean; apps: ShelfApp[]; running: InstanceView[] }

export default function ActivityShelf({ request }: { request: ShelfRequest }) {
  const gt = useGT();
  const [data, setData] = useState<ShelfData | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ channelId: request.channelId, voice: request.voice ? "1" : "0" });
    fetch(`/api/activities/shelf?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: ShelfData) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [request.channelId, request.voice]);

  const platform = platformHint();
  const running = (data?.running ?? []).filter((r) => (r.location?.voice ?? false) === request.voice);

  const launch = async (appId: string) => {
    setBusy(appId);
    await launchActivity(appId, request.channelId, request.voice);
    setBusy(null);
  };
  const join = async (id: string) => {
    setBusy(id);
    await joinActivity(id);
    setBusy(null);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) closeActivityShelf(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket className="size-5" style={{ color: "var(--app-accent)" }} />{gt("Activities")}</DialogTitle>
          <DialogDescription>
            {request.voice ? gt("Play together with everyone in this call.") : gt("Start an Activity here. Everyone in the chat can join.")}
          </DialogDescription>
        </DialogHeader>

        {!data && !failed && <div className="flex justify-center py-10"><Loader size={24} className="size-6" /></div>}
        {failed && <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{gt("Couldn't load Activities. Try again.")}</p>}
        {data && !data.available && <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{gt("Activities are not available on this server.")}</p>}

        {data?.available && running.length > 0 && (
          <section className="mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--app-muted)" }}>{gt("Playing now")}</h3>
            <ul className="space-y-2">
              {running.map((r) => (
                <li key={r.id} className="flex items-center gap-3 rounded-lg border p-2.5" style={{ borderColor: "var(--app-border)" }}>
                  {r.app?.icon ? <img src={cdnImage(r.app.icon)} alt="" className="size-10 rounded-lg object-cover" /> : <div className="size-10 rounded-lg" style={{ background: "var(--app-accent)" }} />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{r.app?.name}</p>
                    <p className="text-xs flex items-center gap-1" style={{ color: "var(--app-muted)" }}><Users className="size-3" />{gt("{count} playing", { count: r.participants?.length ?? 0 })}</p>
                  </div>
                  <button type="button" disabled={busy !== null} onClick={() => void join(r.id)} className="px-3 py-1.5 text-sm rounded-lg font-medium text-white disabled:opacity-50" style={{ background: "var(--app-accent)" }}>
                    {busy === r.id ? <Loader size={16} className="size-4" /> : gt("Join")}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {data?.available && (
          data.apps.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: "var(--app-muted)" }}>{gt("No Activities can be started here yet.")}</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.apps.map((a) => {
                const supported = a.supportedPlatforms.includes(platform);
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      disabled={!supported || busy !== null}
                      onClick={() => void launch(a.id)}
                      className="w-full text-left rounded-lg border overflow-hidden hover:opacity-90 disabled:opacity-50"
                      style={{ borderColor: "var(--app-border)", background: "var(--app-surface)" }}
                    >
                      <div className="aspect-video w-full" style={{ background: "var(--app-bg)" }}>
                        {(a.imageUrl || a.icon) && <img src={cdnImage(a.imageUrl ?? a.icon)} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="p-2.5">
                        <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                          {a.name}
                          {a.ageGated && <span className="text-[10px] px-1 rounded" style={{ background: "var(--app-border)" }}>{gt("18+")}</span>}
                          {a.developer && <span className="text-[10px] px-1 rounded" style={{ background: "var(--app-border)" }}>{gt("Dev")}</span>}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--app-muted)" }}>
                          {busy === a.id ? gt("Starting…") : supported ? (a.description || gt("Start")) : gt("Not available on this device")}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
