"use client";
/**
 * Stage channels (docs/architecture/voice-sfu.md): who's speaking vs in the
 * audience, raising / lowering a hand, stepping down, and — for stage
 * moderators — inviting raised hands to speak. The server enforces all of it
 * (an audience member's audio is never forwarded); this is the controls.
 */
import { useState } from "react";
import { useGT } from "gt-next";
import { Hand, Mic, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { cdnImage, cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { VoiceParticipant } from "@/lib/services/voiceService";

async function post(path: string, body: unknown): Promise<boolean> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return res?.ok === true;
}

export function StageBar({ roomId, participants, myId, moderator }: { roomId: string; participants: VoiceParticipant[]; myId: string; moderator: boolean }) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const me = participants.find((p) => p.userId === myId);
  const speakers = participants.filter((p) => p.stageSpeaker);
  const audience = participants.filter((p) => !p.stageSpeaker);
  const hands = audience.filter((p) => p.requestToSpeakAt).sort((a, b) => String(a.requestToSpeakAt).localeCompare(String(b.requestToSpeakAt)));
  const base = `/api/voice/stage/${encodeURIComponent(roomId)}`;

  const act = async (path: string, body: unknown, failure: string) => {
    setBusy(true);
    const ok = await post(`${base}/${path}`, body);
    setBusy(false);
    if (!ok) toast.error(failure);
  };

  return (
    <div className="mx-3 sm:mx-4 mt-3 rounded-xl border px-3 py-2 flex flex-col gap-2" style={{ background: "var(--app-surface)", borderColor: "var(--app-border)" }}>
      <div className="flex items-center gap-3 flex-wrap text-sm" style={{ color: "var(--app-muted)" }}>
        <span><span className="font-semibold" style={{ color: "var(--text-primary)" }}>{speakers.length}</span> {gt("speaking")}</span>
        <span><span className="font-semibold" style={{ color: "var(--text-primary)" }}>{audience.length}</span> {gt("in the audience")}</span>
        <div className="flex-1" />
        {me && !me.stageSpeaker && (
          moderator ? (
            <button type="button" disabled={busy} onClick={() => void act("speaker", { userId: myId, speaker: true }, gt("Couldn't make you a speaker."))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-medium disabled:opacity-60" style={{ background: "var(--app-accent)" }}>
              <Mic className="size-4" />{gt("Become a speaker")}
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => void act("hand", { raised: !me.requestToSpeakAt }, gt("Couldn't change your request to speak."))}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-60", me.requestToSpeakAt ? "" : "text-white")}
              style={me.requestToSpeakAt ? { background: "var(--app-surface-alt)", color: "var(--text-primary)" } : { background: "var(--app-accent)" }}>
              <Hand className="size-4" />{me.requestToSpeakAt ? gt("Lower hand") : gt("Request to speak")}
            </button>
          )
        )}
        {me?.stageSpeaker && (
          <button type="button" disabled={busy} onClick={() => void act("speaker", { userId: myId, speaker: false }, gt("Couldn't move you to the audience."))}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium disabled:opacity-60" style={{ background: "var(--app-surface-alt)", color: "var(--text-primary)" }}>
            <UserMinus className="size-4" />{gt("Move to audience")}
          </button>
        )}
      </div>
      {moderator && hands.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--app-muted)" }}>{gt("Requests to speak")}</div>
          {hands.map((p) => (
            <div key={p.userId} className="flex items-center gap-2">
              <Avatar className="w-7 h-7">
                {p.avatar && <AvatarImage src={cdnImage(p.avatar)} alt="" />}
                <AvatarFallback className="text-xs">{(p.displayName || p.username || "?").charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-sm truncate flex-1" style={{ color: "var(--text-primary)" }}>{p.displayName || p.username}</span>
              <button type="button" disabled={busy} onClick={() => void act("speaker", { userId: p.userId, speaker: true }, gt("Couldn't invite them to speak."))}
                className="px-2.5 py-1 rounded-md text-xs font-medium text-white disabled:opacity-60" style={{ background: "var(--app-accent)" }}>
                {gt("Invite to speak")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
