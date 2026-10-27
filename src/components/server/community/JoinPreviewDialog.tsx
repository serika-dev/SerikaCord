"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { T, useGT } from "gt-next";
import { ArrowRight, CalendarDays, Eye, Mail, Signpost, Sparkles, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { fetchOnboardingPreview, type ServerOnboarding } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cdnImage, cn } from "@/lib/utils";
import { ServerJoinFlow, type OnboardingFlowStep } from "./ServerJoinFlow";
import { ServerGuideView } from "./ServerGuideView";
import { ServerConnectionsList, ServerIconTile, ServerStats, useEstablishedLabel } from "./serverProfileBits";

export interface JoinPreviewDialogProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Unsaved settings drafts layered over the server's saved config, so admins
   * can preview before saving. Shallow-merged into the preview data.
   */
  overrides?: Partial<Pick<ServerOnboarding, "welcomeScreen" | "onboarding" | "guide" | "screening" | "connections">>;
  /** Where the preview starts: the invite card, the join flow, or the Server Guide. */
  startAt?: "invite" | "flow" | "guide";
}

type PreviewStep = "invite" | "flow" | "guide";

/** The invite page's card, as a new member would see it (static, nothing joins). */
function InviteCardReplica({ data, onAccept }: { data: ServerOnboarding; onAccept: () => void }) {
  const gt = useGT();
  const server = data.server;
  const established = useEstablishedLabel(server.createdAt);
  const description = server.description ? decodeHtmlEntities(server.description) : "";
  const applies = Boolean(data.screening?.manualApproval);

  return (
    <div className="relative min-h-full flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Blurred banner backdrop, like the invite page */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        {server.banner ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: `url(${cdnImage(server.banner)})`, filter: "blur(36px) saturate(1.2)", transform: "scale(1.15)" }}
            />
            <div className="theme-solid absolute inset-0 bg-[var(--app-bg)]/70" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--app-accent) 22%, transparent) 0%, transparent 55%), radial-gradient(circle at 75% 75%, color-mix(in srgb, var(--app-accent) 16%, transparent) 0%, transparent 55%), var(--app-bg)",
            }}
          />
        )}
      </div>

      <div className="relative w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none">
        <div className="theme-solid bg-[var(--app-surface)]/80 backdrop-blur-2xl border border-[var(--app-border)]/80 rounded-3xl overflow-hidden shadow-2xl">
          <div className="pt-8 px-6 pb-6">
            <ServerIconTile
              name={server.name}
              icon={server.icon}
              className="w-20 h-20 rounded-3xl text-3xl shadow-[0_0_0_4px_color-mix(in_srgb,var(--app-accent)_25%,transparent)]"
            />
            <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-[var(--app-accent)]">
              <T>You&apos;ve been invited to join</T>
            </p>
            <h2 className="text-2xl font-bold text-[var(--app-text)] leading-tight break-words">{decodeHtmlEntities(server.name)}</h2>
            {description && <p className="text-sm text-[var(--app-muted)] mt-2 leading-relaxed line-clamp-2">{description}</p>}
            <ServerStats online={server.onlineCount} members={server.memberCount} className="mt-4" />
            {established && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--app-muted)]">
                <CalendarDays className="w-3.5 h-3.5" aria-hidden />
                {established}
              </div>
            )}
            {data.connections.length > 0 && <ServerConnectionsList connections={data.connections} variant="chips" className="mt-4" />}
            <button
              type="button"
              onClick={onAccept}
              className="mt-5 w-full flex items-center justify-center gap-2 px-5 py-3 bg-[var(--app-accent)] hover:brightness-110 text-[var(--text-on-accent)] font-semibold rounded-xl transition-all text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-surface)]"
            >
              {applies ? gt("Apply to Join") : gt("Accept Invite")}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewBody({
  serverId,
  data,
  startAt,
  onClose,
}: {
  serverId: string;
  data: ServerOnboarding | null;
  startAt: PreviewStep;
  onClose: () => void;
}) {
  const gt = useGT();
  const tabsId = useId();
  const [step, setStep] = useState<PreviewStep>(startAt);
  // Bumped to restart the flow (from the invite, or the guide's roles to-do).
  const [flowRun, setFlowRun] = useState<{ seq: number; initialStep?: OnboardingFlowStep }>({ seq: 0 });

  const openFlow = (initialStep?: OnboardingFlowStep) => {
    setFlowRun((prev) => ({ seq: prev.seq + 1, initialStep }));
    setStep("flow");
  };

  const tabs: Array<{ id: PreviewStep; label: string; icon: React.ReactNode }> = [
    { id: "invite", label: gt("Invite"), icon: <Mail className="w-4 h-4" aria-hidden /> },
    { id: "flow", label: gt("Join flow"), icon: <Sparkles className="w-4 h-4" aria-hidden /> },
    { id: "guide", label: gt("Server Guide"), icon: <Signpost className="w-4 h-4" aria-hidden /> },
  ];

  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = tabs[(index + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (next.id === "flow") openFlow();
    else setStep(next.id);
    document.getElementById(`${tabsId}-${next.id}`)?.focus();
  };

  return (
    <>
      {/* Top bar */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-[var(--border-subtle)] bg-[var(--bg-card)]">
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <span className="w-8 h-8 rounded-lg bg-[var(--app-accent)]/15 text-[var(--app-accent)] flex items-center justify-center shrink-0">
            <Eye className="w-4 h-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-sm font-semibold text-[var(--text-primary)] truncate">{gt("Previewing as a new member")}</DialogTitle>
            <DialogDescription className="text-xs text-[var(--text-muted)] truncate">{gt("Nothing you do here is saved.")}</DialogDescription>
          </div>
        </div>
        <div role="tablist" aria-label={gt("Preview steps")} className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-1 p-1 rounded-xl bg-[var(--app-surface-alt)]">
          {tabs.map((tab, i) => {
            const selected = step === tab.id;
            return (
              <button
                key={tab.id}
                id={`${tabsId}-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tabsId}-panel`}
                tabIndex={selected ? 0 : -1}
                disabled={!data}
                onKeyDown={(e) => onTabKey(e, i)}
                onClick={() => (tab.id === "flow" ? openFlow() : setStep(tab.id))}
                className={cn(
                  "flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60",
                  selected
                    ? "bg-[var(--bg-card)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                )}
              >
                <span className="w-4 h-4 rounded-full bg-[var(--app-accent)]/15 text-[var(--app-accent)] text-[10px] font-bold flex items-center justify-center" aria-hidden>
                  {i + 1}
                </span>
                <span className="hidden min-[400px]:inline">{tab.label}</span>
                <span className="min-[400px]:hidden sr-only">{tab.label}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={gt("Close preview")}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Step */}
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${step}`} className="flex-1 min-h-0 flex flex-col bg-[var(--bg-app)]">
        {!data ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader size={32} />
          </div>
        ) : step === "invite" ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <InviteCardReplica data={data} onAccept={() => openFlow()} />
          </div>
        ) : step === "flow" ? (
          // The member's full-page join flow, framed by the preview (nothing is saved).
          <div className="flex-1 min-h-0 flex flex-col animate-in fade-in-0 duration-200 motion-reduce:animate-none">
            <ServerJoinFlow
              key={flowRun.seq}
              serverId={serverId}
              data={data}
              preview
              initialStep={flowRun.initialStep}
              onExit={() => setStep("guide")}
              onFinish={() => setStep("guide")}
            />
          </div>
        ) : data.guide ? (
          <div className="flex-1 min-h-0 overflow-y-auto animate-in fade-in-0 duration-200 motion-reduce:animate-none">
            <ServerGuideView serverId={serverId} data={data} preview onOpenQuestions={() => openFlow("questions")} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <Signpost className="w-10 h-10 text-[var(--text-muted)]" aria-hidden />
            <p className="text-sm font-semibold text-[var(--text-primary)]"><T>No Server Guide yet</T></p>
            <p className="text-sm text-[var(--text-secondary)] max-w-sm">
              <T>Add a welcome message, to-dos or resources in the Server Guide settings and they show up here.</T>
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/** Admin preview of the whole join experience (invite → onboarding → rules → Server Guide). Nothing is saved. */
export default function JoinPreviewDialog({ serverId, open, onOpenChange, overrides, startAt = "invite" }: JoinPreviewDialogProps) {
  const gt = useGT();
  const [loaded, setLoaded] = useState<{ serverId: string; data: ServerOnboarding | null } | null>(null);

  // Fresh preview data every time the dialog opens (saved settings may have changed).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void fetchOnboardingPreview(serverId).then((data) => {
      if (alive) setLoaded({ serverId, data });
    });
    return () => {
      alive = false;
    };
  }, [open, serverId]);

  const base = loaded && loaded.serverId === serverId ? loaded.data : null;
  const failed = Boolean(loaded && loaded.serverId === serverId && !loaded.data);
  const data = useMemo<ServerOnboarding | null>(() => {
    if (!base) return null;
    const merged: ServerOnboarding = { ...base, ...(overrides ?? {}), preview: true };
    return merged;
  }, [base, overrides]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        mobile="none"
        className="p-0 gap-0 overflow-hidden flex flex-col bg-[var(--bg-app)] w-[calc(100vw-1rem)] max-w-[1180px] sm:max-w-[1180px] h-[calc(100dvh-1rem)] sm:h-[min(880px,calc(100dvh-3rem))] rounded-2xl"
      >
        {failed ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <DialogTitle className="text-base font-semibold text-[var(--text-primary)]">{gt("Couldn't load the preview")}</DialogTitle>
            <DialogDescription className="text-sm text-[var(--text-secondary)]">{gt("Check your connection and try again.")}</DialogDescription>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 rounded-lg bg-[var(--app-surface-alt)] text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              <T>Close</T>
            </button>
          </div>
        ) : (
          <PreviewBody serverId={serverId} data={data} startAt={startAt} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
