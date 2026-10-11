"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { T, useGT } from "gt-next";
import { ChevronRight, Hash, Megaphone, MessageSquare, ScrollText, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cdnImage, cn } from "@/lib/utils";

interface ServerWelcomeModalProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which step to open on; falls back to whatever the server has. */
  initialStep?: "welcome" | "rules";
}

function ChannelGlyph({ type }: { type?: string }) {
  const cls = "w-4 h-4 shrink-0 text-[var(--text-muted)]";
  if (type === "voice" || type === "stage") return <Volume2 className={cls} />;
  if (type === "announcement") return <Megaphone className={cls} />;
  if (type === "forum") return <MessageSquare className={cls} />;
  return <Hash className={cls} />;
}

/**
 * Discord's Welcome Screen + Rules Screening for new members: the server's
 * description and up to five recommended channels, then (when screening is
 * on) the rules with an "I agree" checkbox that unlocks talking.
 */
export default function ServerWelcomeModal({ serverId, open, onOpenChange, initialStep }: ServerWelcomeModalProps) {
  const gt = useGT();
  const router = useRouter();
  const { channels } = useServer();
  const { data, blocked, accept } = useServerOnboarding(serverId);
  const [stepChoice, setStepChoice] = useState<"welcome" | "rules" | null>(initialStep ?? null);
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const hasWelcome = Boolean(data?.welcomeScreen);
  const hasRules = Boolean(data?.screening && blocked);
  const step: "welcome" | "rules" = stepChoice === "rules" && hasRules
    ? "rules"
    : stepChoice === "welcome" && hasWelcome
      ? "welcome"
      : hasWelcome ? "welcome" : "rules";

  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  if (!data) return null;
  const server = data.server;
  const icon = server.icon ? cdnImage(server.icon) : null;

  const goToChannel = (channelId: string) => {
    onOpenChange(false);
    router.push(`/channels/${serverId}/${channelId}`);
  };

  const submit = async () => {
    if (!agreed || submitting) return;
    setSubmitting(true);
    const ok = await accept();
    setSubmitting(false);
    if (ok) {
      toast.success(gt("You can now talk in this server."));
      onOpenChange(false);
    } else {
      toast.error(gt("Could not accept the rules. Try again."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-md max-h-[90dvh] flex flex-col bg-[var(--bg-app)]">
        <div className="flex flex-col items-center text-center px-6 pt-8 pb-4 shrink-0">
          <div className="w-16 h-16 rounded-2xl overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center text-xl font-semibold text-[var(--text-primary)] mb-3">
            {icon ? <img src={icon} alt="" className="w-full h-full object-cover" /> : server.name.slice(0, 2).toUpperCase()}
          </div>
          <DialogTitle className="text-xl font-bold text-[var(--text-primary)]">
            {step === "welcome"
              ? gt("Welcome to {server}!", { server: decodeHtmlEntities(server.name) })
              : gt("Before you can talk in {server}", { server: decodeHtmlEntities(server.name) })}
          </DialogTitle>
          <DialogDescription className="text-sm text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">
            {step === "welcome"
              ? decodeHtmlEntities(data.welcomeScreen?.description || server.description || "")
              : data.screening?.description
                ? decodeHtmlEntities(data.screening.description)
                : gt("Read and agree to the server rules to start chatting.")}
          </DialogDescription>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          {step === "welcome" && data.welcomeScreen && data.welcomeScreen.welcomeChannels.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold uppercase text-[var(--text-muted)] px-1">
                <T>Here are some popular channels to get you started</T>
              </div>
              {data.welcomeScreen.welcomeChannels.map((wc) => {
                const ch = channelById.get(wc.channelId);
                return (
                  <button
                    key={wc.channelId}
                    type="button"
                    onClick={() => goToChannel(wc.channelId)}
                    className="w-full flex items-center gap-3 p-3 min-h-[56px] rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-left transition-colors"
                  >
                    <span className="w-9 h-9 rounded-full bg-[var(--app-surface-alt)] flex items-center justify-center text-lg shrink-0" aria-hidden>
                      {wc.emojiName && !wc.emojiId ? wc.emojiName : <ChannelGlyph type={ch?.type} />}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">
                        {wc.description ? decodeHtmlEntities(wc.description) : `#${ch?.name ?? ""}`}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] truncate">
                        <ChannelGlyph type={ch?.type} />
                        <span className="truncate">{ch?.name ?? gt("channel")}</span>
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  </button>
                );
              })}
            </div>
          )}

          {step === "rules" && data.screening && (
            <div className="rounded-lg bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-3">
                <ScrollText className="w-4 h-4 text-[var(--app-accent)]" />
                <T>Server Rules</T>
              </div>
              <ol className="space-y-3">
                {data.screening.rules.map((rule, i) => (
                  <li key={i} className="flex gap-3 text-sm text-[var(--text-primary)]">
                    <span className="font-semibold text-[var(--text-muted)] tabular-nums">{i + 1}.</span>
                    <span className="whitespace-pre-wrap break-words min-w-0">{decodeHtmlEntities(rule)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3">
          {step === "rules" && hasRules && (
            <label className="flex items-center gap-3 text-sm text-[var(--text-primary)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="w-5 h-5 accent-[var(--app-accent)]"
              />
              <T>I have read and agree to the rules</T>
            </label>
          )}
          <div className="flex gap-2">
            {step === "welcome" && hasRules ? (
              <button
                type="button"
                onClick={() => setStepChoice("rules")}
                className="flex-1 h-11 rounded-lg bg-[var(--app-accent)] text-white font-semibold text-sm hover:opacity-90"
              >
                <T>Continue</T>
              </button>
            ) : step === "rules" && hasRules ? (
              <>
                {hasWelcome && (
                  <button
                    type="button"
                    onClick={() => setStepChoice("welcome")}
                    className="h-11 px-4 rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <T>Back</T>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!agreed || submitting}
                  className={cn(
                    "flex-1 h-11 rounded-lg bg-[var(--app-accent)] text-white font-semibold text-sm",
                    (!agreed || submitting) ? "opacity-50 cursor-not-allowed" : "hover:opacity-90",
                  )}
                >
                  {submitting ? gt("Submitting...") : gt("Submit")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="flex-1 h-11 rounded-lg bg-[var(--app-accent)] text-white font-semibold text-sm hover:opacity-90"
              >
                <T>Got it</T>
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
