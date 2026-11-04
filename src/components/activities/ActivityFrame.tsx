"use client";
/**
 * The SerikaCord side of the Embedded App SDK protocol (CORD-92).
 *
 * Loads the app's relay page (https://<client_id>.<ACTIVITIES_DOMAIN>/.serika/frame)
 * in a sandboxed, cross-site iframe; the relay nests the app on the same origin
 * so the stock SDK's origin check passes. Every message is checked against the
 * relay's window and origin and treated as untrusted. Commands that need data
 * or change state go to /api/activities/instances/:id/rpc with this window's
 * own session (the frame never gets it); authorize() and openExternalLink()
 * always ask the user first. Unknown commands fail with INVALID_COMMAND.
 * Protocol details: docs/architecture/activities.md, section 1.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGT, useLocale } from "gt-next";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { FRAME_ALLOW_BASE, FRAME_SANDBOX, RELAY_ENVELOPE } from "@/lib/activities/relay";
import {
  Opcode, RpcClose, RpcError, SUBSCRIBABLE_EVENTS, closeFrame, dispatchFrame, errorFrame, parseAuthorizeScopes, parseInboundFrame,
  replyFrame, safeExternalLink,
} from "@/lib/activities/instances";
import { HEARTBEAT_INTERVAL_MS } from "@/lib/activities/instances";
import { activityRpc, heartbeat, onActivityEvent, type FrameInfo } from "@/lib/activities/clientStore";

/** SerikaCord's media CDN (READY's cdn_host, like Discord's cdn.discordapp.com). */
const CDN_HOST = "cdn.serika.chat";

/** Discord's layout modes: 0 focused, 1 picture-in-picture, 2 grid. */
export type LayoutMode = 0 | 1 | 2;

type Pending =
  | { kind: "authorize"; nonce: string; scopes: string[]; codeChallenge?: unknown; codeChallengeMethod?: unknown }
  | { kind: "link"; nonce: string; url: string };

const SERVER_COMMANDS = new Set([
  "AUTHENTICATE", "GET_CHANNEL", "GET_CHANNEL_PERMISSIONS", "GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS", "GET_USER",
  "SET_ACTIVITY", "GET_RELATIONSHIPS",
]);

function newFrameId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function screenOrientation(): 0 | 1 {
  if (typeof window === "undefined") return 0;
  return window.matchMedia?.("(orientation: landscape)").matches ? 1 : 0;
}

export default function ActivityFrame({
  instanceId,
  frame,
  appName,
  appIcon,
  layoutMode,
  inviteLink,
  onClose,
}: {
  instanceId: string;
  frame: FrameInfo;
  appName: string;
  appIcon: string | null;
  layoutMode: LayoutMode;
  /** A link to the place the Activity runs (openInviteDialog); null in DMs (Discord refuses there). */
  inviteLink: string | null;
  onClose: (reason?: string) => void;
}) {
  const gt = useGT();
  const locale = useLocale();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameId] = useState(newFrameId);
  const [pending, setPending] = useState<Pending | null>(null);
  const ready = useRef(false);
  const scopes = useRef<string[]>([]);
  const subscriptions = useRef(new Set<string>());
  const publicIds = useRef(new Map<string, string>());

  const src = useMemo(() => {
    const q = new URLSearchParams({ ...frame.query, frame_id: frameId });
    return `${frame.origin}/.serika/frame?${q.toString()}`;
  }, [frame, frameId]);

  const send = useCallback((tuple: unknown) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ [RELAY_ENVELOPE]: 1, data: tuple }, frame.origin);
  }, [frame.origin]);

  const dispatch = useCallback((evt: string, data: unknown) => {
    if (subscriptions.current.has(evt)) send(dispatchFrame(evt, data));
  }, [send]);

  // ─── Event sources ──────────────────────────────────────────
  const pushParticipants = useCallback(async () => {
    if (!subscriptions.current.has("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE")) return;
    const r = await activityRpc(instanceId, "GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS");
    if (r.ok) dispatch("ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE", r.data);
  }, [dispatch, instanceId]);

  const pushVoiceStates = useCallback(async () => {
    if (!subscriptions.current.has("VOICE_STATE_UPDATE")) return;
    const r = await activityRpc(instanceId, "SERIKA_VOICE_STATES");
    if (r.ok && Array.isArray(r.data)) for (const s of r.data) dispatch("VOICE_STATE_UPDATE", s);
  }, [dispatch, instanceId]);

  const pushSpeaking = useCallback(async (userId: string, speaking: boolean) => {
    const evt = speaking ? "SPEAKING_START" : "SPEAKING_STOP";
    if (!subscriptions.current.has(evt)) return;
    let id = publicIds.current.get(userId.toLowerCase());
    if (!id) {
      const r = await activityRpc(instanceId, "SERIKA_PUBLIC_IDS", { userIds: [userId] });
      if (!r.ok) return;
      const map = r.data as Record<string, string>;
      id = map[userId.toLowerCase()];
      if (!id) return;
      publicIds.current.set(userId.toLowerCase(), id);
    }
    dispatch(evt, { user_id: id, channel_id: frame.query.channel_id });
  }, [dispatch, frame.query.channel_id, instanceId]);

  const pushInitial = useCallback(async (evt: string) => {
    switch (evt) {
      case "ORIENTATION_UPDATE": {
        const o = screenOrientation();
        dispatch(evt, { screen_orientation: o, orientation: o === 1 ? "landscape" : "portrait" });
        break;
      }
      case "ACTIVITY_LAYOUT_MODE_UPDATE": dispatch(evt, { layout_mode: layoutMode }); break;
      case "THERMAL_STATE_UPDATE": dispatch(evt, { thermal_state: 0 }); break;
      case "CURRENT_USER_UPDATE": {
        const r = await activityRpc(instanceId, "SERIKA_CURRENT_USER");
        if (r.ok) dispatch(evt, r.data);
        break;
      }
      case "CURRENT_GUILD_MEMBER_UPDATE": {
        const r = await activityRpc(instanceId, "SERIKA_GUILD_MEMBER");
        if (r.ok) dispatch(evt, r.data);
        break;
      }
      case "VOICE_STATE_UPDATE": await pushVoiceStates(); break;
      default: break;
    }
  }, [dispatch, instanceId, layoutMode, pushVoiceStates]);

  // ─── Commands ───────────────────────────────────────────────
  const finishAuthorize = useCallback(async (p: Extract<Pending, { kind: "authorize" }>, allowed: boolean) => {
    if (!allowed) { send(errorFrame("AUTHORIZE", p.nonce, 5000, "OAuth2 Error: access_denied: The resource owner or authorization server denied the request")); return; }
    const r = await activityRpc(instanceId, "AUTHORIZE", { scopes: p.scopes, code_challenge: p.codeChallenge, code_challenge_method: p.codeChallengeMethod });
    if (r.ok) send(replyFrame("AUTHORIZE", p.nonce, r.data));
    else send(errorFrame("AUTHORIZE", p.nonce, r.code, r.message));
  }, [instanceId, send]);

  const handleCommand = useCallback(async (cmd: string, args: Record<string, unknown>, nonce: string) => {
    const reply = (data: unknown) => send(replyFrame(cmd, nonce, data));
    const error = (code: number, message: string) => send(errorFrame(cmd, nonce, code, message));
    if (!ready.current) { error(RpcError.INVALID_PAYLOAD, "Not ready"); return; }
    switch (cmd) {
      case "SUBSCRIBE":
      case "UNSUBSCRIBE": {
        const evt = typeof args.evt === "string" ? args.evt : null;
        // The SDK puts evt beside args; accept either place.
        if (!evt || !(evt in SUBSCRIBABLE_EVENTS)) { error(RpcError.INVALID_EVENT, `Invalid event: ${String(evt)}`); return; }
        if (cmd === "UNSUBSCRIBE") { subscriptions.current.delete(evt); reply({ evt }); return; }
        const need = SUBSCRIBABLE_EVENTS[evt];
        if (need && !scopes.current.includes(need)) { error(RpcError.INVALID_PERMISSIONS, `Missing scope: ${need}`); return; }
        subscriptions.current.add(evt);
        reply({ evt });
        void pushInitial(evt);
        return;
      }
      case "CAPTURE_LOG":
      case "SEND_ANALYTICS_EVENT":
      case "SET_CERTIFIED_DEVICES":
        reply(null);
        return;
      case "ENCOURAGE_HW_ACCELERATION": reply({ enabled: true }); return;
      case "GET_PLATFORM_BEHAVIORS": reply({ iosKeyboardResizesView: false }); return;
      case "SET_CONFIG": reply({ use_interactive_pip: Boolean(args.use_interactive_pip) }); return;
      case "SET_ORIENTATION_LOCK_STATE": {
        void lockOrientation(args.lock_state);
        reply(null);
        return;
      }
      case "USER_SETTINGS_GET_LOCALE":
        if (!scopes.current.includes("identify")) { error(RpcError.INVALID_PERMISSIONS, "Missing scope: identify"); return; }
        reply({ locale: locale || "en-US" });
        return;
      // Monetization is out of scope: nothing to buy, nothing owned.
      case "GET_SKUS": case "GET_ENTITLEMENTS": reply(null); return;
      case "GET_SKUS_EMBEDDED": reply({ skus: [] }); return;
      case "GET_ENTITLEMENTS_EMBEDDED": reply({ entitlements: [] }); return;
      case "OPEN_INVITE_DIALOG": {
        if (!inviteLink) { error(RpcError.INVALID_CHANNEL, "Invites are not available in DMs"); return; }
        try { await navigator.clipboard.writeText(inviteLink); } catch { /* no clipboard */ }
        const { toast } = await import("sonner");
        toast.success(gt("Link to this Activity copied"));
        reply(null);
        return;
      }
      case "OPEN_SHARE_MOMENT_DIALOG": {
        const url = safeExternalLink(args.mediaUrl);
        if (!url) { error(RpcError.INVALID_PAYLOAD, "Invalid mediaUrl"); return; }
        try { await navigator.clipboard.writeText(url); } catch { /* no clipboard */ }
        const { toast } = await import("sonner");
        toast.success(gt("Link copied"));
        reply(null);
        return;
      }
      case "OPEN_EXTERNAL_LINK": {
        const url = safeExternalLink(args.url);
        if (!url) { reply({ opened: false }); return; }
        setPending({ kind: "link", nonce, url });
        return;
      }
      case "AUTHORIZE": {
        if (typeof args.client_id === "string" && args.client_id !== frame.clientId) { error(RpcError.INVALID_CLIENTID, "Invalid client_id"); return; }
        const parsed = parseAuthorizeScopes(args.scope ?? args.scopes);
        if (!parsed.ok) { error(RpcError.INVALID_PAYLOAD, parsed.message); return; }
        const request = { kind: "authorize" as const, nonce, scopes: parsed.scopes, codeChallenge: args.code_challenge, codeChallengeMethod: args.code_challenge_method };
        if (args.prompt === "none") {
          const known = await fetch(`/api/activities/instances/${encodeURIComponent(instanceId)}/authorized?scopes=${encodeURIComponent(parsed.scopes.join(","))}`)
            .then((r) => (r.ok ? r.json() : null)).catch(() => null) as { authorized?: boolean } | null;
          if (known?.authorized) { await finishAuthorize(request, true); return; }
        }
        setPending(request);
        return;
      }
      default:
        if (SERVER_COMMANDS.has(cmd)) {
          const r = await activityRpc(instanceId, cmd, args);
          if (!r.ok) { error(r.code, r.message); return; }
          if (cmd === "AUTHENTICATE") {
            const granted = (r.data as { scopes?: unknown }).scopes;
            scopes.current = Array.isArray(granted) ? granted.filter((s): s is string => typeof s === "string") : [];
          }
          reply(r.data);
          return;
        }
        error(RpcError.INVALID_COMMAND, `Invalid command: ${cmd}`);
    }
  }, [finishAuthorize, frame.clientId, gt, instanceId, inviteLink, locale, pushInitial, send]);

  const resolvePending = useCallback((allowed: boolean) => {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "authorize") { void finishAuthorize(p, allowed); return; }
    if (allowed) {
      window.open(p.url, "_blank", "noopener,noreferrer");
      send(replyFrame("OPEN_EXTERNAL_LINK", p.nonce, { opened: true }));
    } else {
      send(replyFrame("OPEN_EXTERNAL_LINK", p.nonce, { opened: false }));
    }
  }, [finishAuthorize, pending, send]);

  // ─── Message pump ───────────────────────────────────────────
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow || e.origin !== frame.origin) return;
      const envelope = e.data as Record<string, unknown> | null;
      if (!envelope || envelope[RELAY_ENVELOPE] !== 1) return;
      // The relay announcing itself: answer once so it learns our origin.
      if (envelope.hello) { iframeRef.current?.contentWindow?.postMessage({ [RELAY_ENVELOPE]: 1 }, frame.origin); return; }
      const parsed = parseInboundFrame(envelope.data);
      if (!parsed) return;
      if (parsed.op === Opcode.HANDSHAKE) {
        const h = parsed.handshake;
        if (h.v !== 1) { send(closeFrame(RpcClose.INVALID_VERSION, "Invalid Version")); return; }
        if (h.encoding && h.encoding !== "json") { send(closeFrame(RpcClose.INVALID_ENCODING, "Invalid Encoding")); return; }
        if (h.client_id !== frame.clientId) { send(closeFrame(RpcClose.INVALID_CLIENTID, "Invalid Client ID")); return; }
        if (h.frame_id !== frameId) { send(closeFrame(RpcClose.INVALID_ORIGIN, "Invalid Frame ID")); return; }
        ready.current = true;
        send(dispatchFrame("READY", { v: 1, config: { cdn_host: CDN_HOST, api_endpoint: `//${window.location.host}/api`, environment: "production" } }));
        return;
      }
      if (parsed.op === Opcode.FRAME) {
        const f = parsed.frame;
        const args = f.cmd === "SUBSCRIBE" || f.cmd === "UNSUBSCRIBE" ? { ...f.args, evt: f.evt ?? f.args.evt } : f.args;
        void handleCommand(f.cmd, args, f.nonce);
        return;
      }
      if (parsed.op === Opcode.CLOSE) onClose(parsed.close.message);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame.clientId, frame.origin, frameId, handleCommand, onClose, send]);

  // Participants changed (server), layout / orientation changed (here).
  useEffect(() => onActivityEvent((e) => {
    if (e.type === "activity_update" && e.instance.id === instanceId) void pushParticipants();
  }), [instanceId, pushParticipants]);

  useEffect(() => {
    if (ready.current) dispatch("ACTIVITY_LAYOUT_MODE_UPDATE", { layout_mode: layoutMode });
  }, [dispatch, layoutMode]);

  useEffect(() => {
    const mq = window.matchMedia?.("(orientation: landscape)");
    if (!mq) return;
    const onChange = () => { if (ready.current) void pushInitial("ORIENTATION_UPDATE"); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pushInitial]);

  // Voice-bound Activities: voice states and speaking from the call.
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    void import("@/lib/services/voiceService").then(({ voiceService }) => {
      if (cancelled) return;
      unsub = voiceService.subscribe((ev) => {
        if (!ready.current) return;
        if (ev.type === "speaking") void pushSpeaking(ev.userId, ev.speaking);
        else if (ev.type === "participants_changed" || ev.type === "mute_toggled" || ev.type === "deafen_toggled") void pushVoiceStates();
      });
    }).catch(() => {});
    return () => { cancelled = true; unsub?.(); };
  }, [pushSpeaking, pushVoiceStates]);

  // Heartbeat: the server drops participants whose frame went quiet.
  useEffect(() => {
    const t = window.setInterval(() => {
      void heartbeat(instanceId).then((active) => { if (!active) onClose("ended"); });
    }, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [instanceId, onClose]);

  const allow = FRAME_ALLOW_BASE.join("; ");

  return (
    <div className="relative w-full h-full" style={{ background: "#000" }}>
      <iframe
        ref={iframeRef}
        src={src}
        title={appName}
        sandbox={FRAME_SANDBOX}
        allow={allow}
        allowFullScreen
        referrerPolicy="origin"
        className="w-full h-full block border-0"
      />
      {pending && (
        <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl border p-5 shadow-xl" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)", color: "var(--app-text)" }}>
            <div className="flex items-center gap-3 mb-3">
              {appIcon ? <img src={appIcon} alt="" className="size-10 rounded-lg object-cover" /> : <div className="size-10 rounded-lg" style={{ background: "var(--app-accent)" }} />}
              <div className="min-w-0">
                <p className="font-semibold truncate">{appName}</p>
                <p className="text-xs" style={{ color: "var(--app-muted)" }}>
                  {pending.kind === "authorize" ? gt("wants to access your account") : gt("wants to open a link")}
                </p>
              </div>
            </div>
            {pending.kind === "authorize" ? (
              <ul className="text-sm space-y-1.5 mb-4">
                {pending.scopes.map((s) => (
                  <li key={s} className="flex items-center gap-2"><ShieldCheck className="size-4 shrink-0" style={{ color: "var(--app-accent)" }} /><span>{scopeLabel(s, gt)}</span></li>
                ))}
              </ul>
            ) : (
              <p className="text-sm mb-4 break-all flex items-start gap-2"><ExternalLink className="size-4 shrink-0 mt-0.5" style={{ color: "var(--app-muted)" }} /><span>{pending.url}</span></p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => resolvePending(false)} className="px-3 py-2 text-sm rounded-lg" style={{ color: "var(--app-text)" }}>
                {gt("Cancel")}
              </button>
              <button type="button" onClick={() => resolvePending(true)} className="px-3 py-2 text-sm rounded-lg font-medium text-white" style={{ background: "var(--app-accent)" }}>
                {pending.kind === "authorize" ? gt("Authorize") : gt("Open link")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function scopeLabel(scope: string, gt: ReturnType<typeof useGT>): string {
  switch (scope) {
    case "identify": return gt("Know your username and avatar");
    case "email": return gt("Know your email address");
    case "guilds": return gt("Know which servers you are in");
    case "guilds.members.read": return gt("Read your member info in servers (nickname, roles)");
    case "rpc.voice.read": return gt("See who is talking in the call");
    case "rpc.activities.write": return gt("Update what you are playing");
    case "applications.commands": return gt("Use the app's commands");
    case "relationships.read": return gt("Know who your friends are");
    case "activities.read": return gt("See your activity");
    case "activities.write": return gt("Update your activity");
    case "connections": return gt("Know your connected accounts");
    case "openid": return gt("Sign you in to the app");
    case "role_connections.write": return gt("Update your linked roles");
    case "dm_channels.read": return gt("See your direct messages list");
    default: return scope;
  }
}

async function lockOrientation(lockState: unknown): Promise<void> {
  // 1 unlocked, 2 portrait, 3 landscape (OrientationLockState). Best-effort:
  // native apps lock through the platform; browsers only inside fullscreen.
  try {
    const so = (screen as unknown as { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
    if (lockState === 2) await so?.lock?.("portrait");
    else if (lockState === 3) await so?.lock?.("landscape");
    else so?.unlock?.();
  } catch { /* not allowed here */ }
}
