"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { T, useGT } from "gt-next";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleCheck,
  CircleX,
  Hash,
  Hourglass,
  Megaphone,
  MessageSquare,
  ScrollText,
  Signpost,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Loader } from "@/components/ui/Loader";
import { useServer } from "@/contexts/ServerContext";
import { useServerOnboarding, type OnboardingOptionView, type ServerOnboarding } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cdnImage, cn } from "@/lib/utils";
import {
  ApplicationQuestionFields,
  EmojiOrIcon,
  RulesList,
  ServerBannerArt,
  ServerIconTile,
  ServerStats,
  firstMissingAnswer,
  focusQuestion,
} from "./serverProfileBits";
import {
  flowStatusKind,
  planSteps,
  readOnboardingDraft,
  startStep,
  writeOnboardingDraft,
  type FlowStatusKind,
  type OnboardingFlowStep,
} from "./joinFlowPlan";

export type { OnboardingFlowStep } from "./joinFlowPlan";

export interface ServerJoinFlowProps {
  serverId: string;
  data: ServerOnboarding;
  /** Admin preview: everything stays local, nothing is sent. */
  preview?: boolean;
  /** Which step to open on; falls back to the first one the server has. */
  initialStep?: OnboardingFlowStep;
  /** 0-based question to open on when starting at the questions. */
  initialQuestion?: number;
  /** Leave the flow, to `target` (a channel, the Server Guide) or back to the server. */
  onExit: (target?: string) => void;
  /** Preview: the flow ended (the join preview moves on to the Server Guide). */
  onFinish?: () => void;
  /** The visible step changed (the page mirrors it in the URL so a refresh resumes there). */
  onStepChange?: (step: OnboardingFlowStep, questionIndex: number) => void;
}

function ChannelGlyph({ type, className }: { type?: string; className?: string }) {
  const cls = cn("w-4 h-4 shrink-0", className);
  if (type === "voice" || type === "stage") return <Volume2 className={cls} />;
  if (type === "announcement") return <Megaphone className={cls} />;
  if (type === "forum") return <MessageSquare className={cls} />;
  return <Hash className={cls} />;
}

/** Arrow keys / Home / End move between the option cards of a question. */
function onOptionKeyDown(e: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-option]"));
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || items.length === 0) return;
  e.preventDefault();
  let next = index;
  if (e.key === "Home") next = 0;
  else if (e.key === "End") next = items.length - 1;
  else if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (index + 1) % items.length;
  else next = (index - 1 + items.length) % items.length;
  items[next]?.focus();
}

/**
 * Discord's join flow for a server as a full page: welcome screen →
 * onboarding questions (roles / channels) → rules screening (with
 * application questions when the server reviews members by hand) → the
 * outcome. Rendered by /channels/:serverId/onboarding and, with `preview`,
 * inside the admin's join preview (nothing is saved there).
 */
export function ServerJoinFlow({
  serverId,
  data,
  preview = false,
  initialStep,
  initialQuestion = 0,
  onExit,
  onFinish,
  onStepChange,
}: ServerJoinFlowProps) {
  const gt = useGT();
  const { channels, currentServer, fetchChannels } = useServer();
  // Preview never touches the member's state (the hook skips a null server).
  const { submitRules, submitOnboarding } = useServerOnboarding(preview ? null : serverId);
  const formId = useId();

  const [steps] = useState(() => planSteps(data, preview, initialStep));
  const questions = useMemo(() => data.onboarding?.questions ?? [], [data.onboarding]);
  const [step, setStep] = useState<OnboardingFlowStep>(() => startStep(steps, data, preview, initialStep));
  const [qIndex, setQIndex] = useState(() =>
    step === "questions" ? Math.min(Math.max(0, initialQuestion), Math.max(0, questions.length - 1)) : 0,
  );
  const [direction, setDirection] = useState<1 | -1>(1);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Questions: resume unsent picks from this tab, else what the member saved.
  const [selected, setSelected] = useState<string[]>(() => {
    if (preview) return [];
    const valid = new Set(questions.flatMap((q) => q.options.map((o) => o.id)));
    const draft = typeof window === "undefined" ? null : readOnboardingDraft(serverId);
    return (draft ?? data.member.optionIds).filter((id) => valid.has(id));
  });
  const [qError, setQError] = useState<string | null>(null);

  // Rules
  const screening = data.screening;
  const appQuestions = useMemo(() => (screening?.manualApproval ? screening.questions : []), [screening]);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    // "Edit and resubmit" starts from what they sent last time.
    const prev = preview ? undefined : data.member.application?.answers;
    const out: Record<string, string> = {};
    for (const a of prev ?? []) out[a.questionId] = a.answer;
    return out;
  });
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [previewOutcome, setPreviewOutcome] = useState<FlowStatusKind | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Every page change: back to the top and focus on the new heading. On open
  // the page focuses it too (the preview leaves focus on its tabs).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (preview) return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step, qIndex, preview]);

  // Mirror the step in the URL (no-op in the preview).
  useEffect(() => {
    onStepChange?.(step, qIndex);
  }, [step, qIndex, onStepChange]);

  const server = data.server;
  const serverName = decodeHtmlEntities(server.name);
  const serverChannels = useMemo(
    () => (currentServer?.id === serverId ? channels : []),
    [channels, currentServer?.id, serverId],
  );
  const channelById = useMemo(() => new Map(serverChannels.map((c) => [c.id, c])), [serverChannels]);

  const moveTo = (next: OnboardingFlowStep, nextQ: number, dir: 1 | -1) => {
    setDirection(dir);
    setStep(next);
    setQIndex(nextQ);
  };
  const go = (next: OnboardingFlowStep, dir: 1 | -1) => moveTo(next, qIndex, dir);

  /** Leave for a page of the server (the preview just ends). */
  const leave = (target?: string) => {
    if (preview) onFinish?.();
    else onExit(target);
  };

  /** "Start chatting": the server's first text channel (the server itself while channels load). */
  const startChatting = () => {
    const first = serverChannels.find((c) => c.type === "text");
    leave(first ? `/channels/${serverId}/${first.id}` : undefined);
  };

  /** Next page after `from`; ends the flow when only an unneeded status page is left. */
  const advanceFrom = (from: OnboardingFlowStep, didSubmit = submitted) => {
    const next = steps[steps.indexOf(from) + 1];
    if (!next || (next === "status" && !didSubmit)) {
      startChatting();
      return;
    }
    go(next, 1);
  };

  const backFrom = (from: OnboardingFlowStep) => {
    const prev = steps[steps.indexOf(from) - 1];
    if (prev && prev !== "status") go(prev, -1);
  };

  const goToChannel = (channelId: string) => {
    if (preview) return;
    onExit(`/channels/${serverId}/${channelId}`);
  };

  // ── Questions ──────────────────────────────────────────────────────────────
  const question = questions[qIndex];
  const toggleOption = (option: OnboardingOptionView) => {
    if (!question) return;
    setQError(null);
    const prev = selected;
    let next: string[];
    if (question.multiple) {
      next = prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id];
    } else {
      const others = new Set(question.options.map((o) => o.id));
      next = prev.includes(option.id) && !question.required
        ? prev.filter((id) => id !== option.id)
        : [...prev.filter((id) => !others.has(id)), option.id];
    }
    setSelected(next);
    if (!preview) writeOnboardingDraft(serverId, next);
  };
  const answeredCurrent = question ? question.options.some((o) => selected.includes(o.id)) : false;

  const submitQuestions = async () => {
    if (preview) {
      setSubmitted(true);
      advanceFrom("questions", true);
      return;
    }
    setBusy(true);
    const res = await submitOnboarding(selected);
    setBusy(false);
    if (!res.ok) {
      const idx = res.questionId ? questions.findIndex((q) => q.id === res.questionId) : -1;
      if (idx >= 0) {
        moveTo("questions", idx, idx < qIndex ? -1 : 1);
        setQError(res.error || gt("Answer this question to continue."));
      } else {
        toast.error(res.error || gt("Could not save your answers. Try again."));
      }
      return;
    }
    writeOnboardingDraft(serverId, null);
    setSubmitted(true);
    // Roles from the answers can reveal channels.
    if (!data.member.screeningBlocked) void fetchChannels(serverId);
    advanceFrom("questions", true);
  };

  const questionNext = () => {
    if (!question) return;
    if (question.required && !answeredCurrent) {
      setQError(question.multiple ? gt("Pick at least one option to continue.") : gt("Pick an option to continue."));
      return;
    }
    setQError(null);
    if (qIndex < questions.length - 1) moveTo("questions", qIndex + 1, 1);
    else void submitQuestions();
  };

  const questionSkip = () => {
    if (!question || question.required) return;
    const ids = new Set(question.options.map((o) => o.id));
    const next = selected.filter((id) => !ids.has(id));
    setSelected(next);
    if (!preview) writeOnboardingDraft(serverId, next);
    setQError(null);
    if (qIndex < questions.length - 1) moveTo("questions", qIndex + 1, 1);
    else void submitQuestions();
  };

  const questionBack = () => {
    setQError(null);
    if (qIndex > 0) moveTo("questions", qIndex - 1, -1);
    else backFrom("questions");
  };

  // ── Rules ──────────────────────────────────────────────────────────────────
  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (answerErrors[questionId]) {
      setAnswerErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const submitRulesStep = async () => {
    if (!agreed || busy || !screening) return;
    const missing = firstMissingAnswer(appQuestions, answers);
    if (missing) {
      setAnswerErrors({ [missing]: gt("This question is required.") });
      focusQuestion(scrollRef.current, missing);
      return;
    }
    if (preview) {
      setSubmitted(true);
      setPreviewOutcome(screening.manualApproval ? "pending" : "approved");
      go("status", 1);
      return;
    }
    setBusy(true);
    const res = await submitRules(appQuestions.map((q) => ({ questionId: q.id, answer: (answers[q.id] ?? "").trim() })));
    setBusy(false);
    if (!res.ok) {
      if (res.questionId) {
        setAnswerErrors({ [res.questionId]: res.error || gt("This question is required.") });
        focusQuestion(scrollRef.current, res.questionId);
      } else {
        toast.error(res.error || gt("Could not accept the rules. Try again."));
      }
      return;
    }
    setSubmitted(true);
    if (!res.pending) {
      toast.success(gt("You can now talk in this server."));
      // Channels hidden while pending (restricted access) show up now.
      void fetchChannels(serverId);
    }
    go("status", 1);
  };

  // ── Status ─────────────────────────────────────────────────────────────────
  const app = data.member.application;
  const statusKind = flowStatusKind(data, preview, previewOutcome);

  const openGuide = () => {
    if (preview) {
      onFinish?.();
      return;
    }
    onExit(`/channels/${serverId}/guide`);
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  // The status page is only part of the journey when there is something to submit.
  const reachesStatus = steps.includes("questions") || steps.includes("rules");
  const progressSteps = reachesStatus ? steps : steps.filter((s) => s !== "status");
  const progressIndex = progressSteps.indexOf(step);
  const isLastQuestion = qIndex >= questions.length - 1;
  const nextAfterQuestions = steps[steps.indexOf("questions") + 1];
  const Heading = preview ? "h2" : "h1";

  const stepLabel = (s: OnboardingFlowStep): string => {
    if (s === "welcome") return gt("Welcome");
    if (s === "questions") return gt("Customize");
    if (s === "rules") return screening?.manualApproval ? gt("Apply") : gt("Rules");
    return gt("Done");
  };

  const announcement = progressIndex >= 0 && progressSteps.length > 1
    ? step === "questions" && questions.length > 1
      ? gt("Step {current} of {total}: {name}, question {question} of {questions}", {
          current: progressIndex + 1,
          total: progressSteps.length,
          name: stepLabel(step),
          question: qIndex + 1,
          questions: questions.length,
        })
      : gt("Step {current} of {total}: {name}", { current: progressIndex + 1, total: progressSteps.length, name: stepLabel(step) })
    : stepLabel(step);

  const animate = cn(
    "animate-in fade-in-0 duration-300 motion-reduce:animate-none",
    direction > 0 ? "slide-in-from-right-6" : "slide-in-from-left-6",
  );

  const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60";
  const primaryBtn = cn(
    "inline-flex items-center justify-center gap-2 h-12 px-6 rounded-xl bg-[var(--app-accent)] text-[var(--text-on-accent)] font-semibold text-[15px] transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 motion-reduce:transition-none",
    focusRing,
    "focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)]",
  );
  const ghostBtn = cn(
    "inline-flex items-center justify-center gap-1.5 h-12 px-4 rounded-xl text-[15px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors disabled:opacity-50 motion-reduce:transition-none",
    focusRing,
  );
  const grow = "flex-1 @xl:flex-none @xl:min-w-[168px]";
  const titleCls = "text-2xl @2xl:text-3xl font-extrabold tracking-tight text-[var(--text-primary)] outline-none break-words";
  const cardCls = "rounded-2xl bg-[var(--bg-card)]/90 border border-[var(--border-subtle)]";

  let body: ReactNode = null;
  let footer: ReactNode = null;

  if (step === "welcome") {
    const welcome = data.welcomeScreen;
    const description = decodeHtmlEntities(welcome?.description || server.description || "");
    body = (
      <div>
        <div className="relative">
          <ServerBannerArt banner={server.banner} className="h-36 @2xl:h-48 rounded-2xl border border-[var(--border-subtle)]">
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          </ServerBannerArt>
          <div className="absolute left-1/2 -bottom-11 -translate-x-1/2 rounded-[28px] p-1.5 bg-[var(--bg-app)]">
            <ServerIconTile name={server.name} icon={server.icon} className="w-[88px] h-[88px] rounded-[22px] text-3xl" />
          </div>
        </div>
        <div className="flex flex-col items-center text-center pt-14">
          <Heading ref={headingRef} tabIndex={-1} className={titleCls}>
            {gt("Welcome to {server}!", { server: serverName })}
          </Heading>
          <ServerStats online={server.onlineCount} members={server.memberCount} className="justify-center mt-3" />
          <p className={cn("text-[15px] leading-relaxed text-[var(--text-secondary)] mt-4 whitespace-pre-wrap break-words max-w-prose", !description && "sr-only")}>
            {description || gt("Get to know the server before you jump in.")}
          </p>
        </div>
        {welcome && welcome.welcomeChannels.length > 0 && (
          <section className="mt-8" aria-labelledby={`${formId}-channels`}>
            <h2 id={`${formId}-channels`} className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] px-1 mb-3">
              <T>Here are some popular channels to get you started</T>
            </h2>
            <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
              {welcome.welcomeChannels.map((wc) => {
                const ch = channelById.get(wc.channelId);
                return (
                  <button
                    key={wc.channelId}
                    type="button"
                    onClick={() => goToChannel(wc.channelId)}
                    aria-disabled={preview || undefined}
                    className={cn(
                      "group w-full flex items-center gap-3 p-4 min-h-[72px] text-left transition-colors motion-reduce:transition-none",
                      cardCls,
                      focusRing,
                      preview ? "cursor-default" : "hover:bg-[var(--bg-hover)] hover:border-[var(--app-accent)]/40",
                    )}
                  >
                    <span className="w-11 h-11 rounded-full bg-[var(--app-surface-alt)] flex items-center justify-center text-xl shrink-0" aria-hidden>
                      <EmojiOrIcon
                        emoji={wc.emojiId ? null : wc.emojiName}
                        fallback={<ChannelGlyph type={ch?.type} className="w-5 h-5 text-[var(--text-secondary)]" />}
                      />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[15px] font-semibold text-[var(--text-primary)] truncate">
                        {wc.description ? decodeHtmlEntities(wc.description) : `#${ch?.name ?? ""}`}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] min-w-0">
                        <ChannelGlyph type={ch?.type} className="w-3.5 h-3.5" />
                        <span className="truncate">{ch?.name ?? gt("channel")}</span>
                      </span>
                    </span>
                    {!preview && (
                      <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    );
    const next = steps[steps.indexOf("welcome") + 1];
    const ends = !next || (next === "status" && !submitted);
    footer = (
      <>
        <div className="hidden @xl:block flex-1" />
        <button type="button" onClick={() => advanceFrom("welcome")} className={cn(primaryBtn, grow)}>
          {ends ? gt("Got it") : gt("Continue")}
          {!ends && <ChevronRight className="w-4 h-4" aria-hidden />}
        </button>
      </>
    );
  } else if (step === "questions" && question) {
    const pct = ((qIndex + 1) / questions.length) * 100;
    const questionTitle = decodeHtmlEntities(question.title);
    body = (
      <div>
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)] mb-2">
          <span>{gt("Question {current} of {total}", { current: qIndex + 1, total: questions.length })}</span>
          {!question.required && <span>{gt("Optional")}</span>}
        </div>
        <div
          className="h-1.5 rounded-full bg-[var(--app-surface-alt)] overflow-hidden"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={questions.length}
          aria-valuenow={qIndex + 1}
          aria-label={gt("Onboarding progress")}
        >
          <div
            className="h-full rounded-full bg-[var(--app-accent)] transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${pct}%` }}
          />
        </div>
        <Heading ref={headingRef} tabIndex={-1} className={cn(titleCls, "mt-6")}>
          {questionTitle}
          {question.required && <span className="text-red-500 ml-1" aria-hidden>*</span>}
        </Heading>
        <p id={`${formId}-qdesc`} className="mt-2 text-[15px] text-[var(--text-secondary)] whitespace-pre-wrap break-words">
          {question.description
            ? decodeHtmlEntities(question.description)
            : question.multiple
              ? gt("Pick as many as you like.")
              : gt("Pick one.")}
        </p>
        <div
          role={question.multiple ? "group" : "radiogroup"}
          aria-label={questionTitle}
          aria-describedby={`${formId}-qdesc${qError ? ` ${formId}-qerr` : ""}`}
          aria-required={question.required || undefined}
          aria-invalid={Boolean(qError) || undefined}
          onKeyDown={onOptionKeyDown}
          className="grid grid-cols-1 @xl:grid-cols-2 gap-3 mt-6"
        >
          {question.options.map((option) => {
            const isOn = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                data-option
                role={question.multiple ? "checkbox" : "radio"}
                aria-checked={isOn}
                onClick={() => toggleOption(option)}
                disabled={busy}
                className={cn(
                  "relative flex items-center gap-3.5 p-4 min-h-[76px] rounded-2xl border text-left transition-all duration-150 motion-reduce:transition-none",
                  focusRing,
                  isOn
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)]/12 shadow-[0_0_0_1px_var(--app-accent)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-card)]/90 hover:bg-[var(--bg-hover)] hover:border-[var(--text-muted)]/40",
                )}
              >
                <span className="w-12 h-12 rounded-xl bg-[var(--app-surface-alt)] flex items-center justify-center text-2xl shrink-0" aria-hidden>
                  <EmojiOrIcon emoji={option.emoji} fallback={<Sparkles className="w-5 h-5 text-[var(--text-muted)]" />} />
                </span>
                <span className="flex-1 min-w-0 pr-7">
                  <span className="block text-[15px] font-semibold text-[var(--text-primary)] break-words">{decodeHtmlEntities(option.title)}</span>
                  {option.description && (
                    <span className="block mt-0.5 text-[13px] text-[var(--text-secondary)] break-words line-clamp-3">{decodeHtmlEntities(option.description)}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "absolute top-1/2 -translate-y-1/2 right-4 w-6 h-6 flex items-center justify-center border-2 transition-colors motion-reduce:transition-none",
                    question.multiple ? "rounded-md" : "rounded-full",
                    isOn ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-[var(--text-on-accent)]" : "border-[var(--text-muted)]/50",
                  )}
                  aria-hidden
                >
                  {isOn && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {qError && (
          <p id={`${formId}-qerr`} role="alert" className="mt-4 text-sm font-medium text-red-500">{qError}</p>
        )}
      </div>
    );
    const canGoBack = qIndex > 0 || steps.indexOf("questions") > 0;
    const lastLabel = nextAfterQuestions === "rules" ? gt("Next") : gt("Finish");
    footer = (
      <>
        {canGoBack && (
          <button type="button" onClick={questionBack} className={ghostBtn} disabled={busy}>
            <ArrowLeft className="w-4 h-4" aria-hidden />
            <T>Back</T>
          </button>
        )}
        <div className="hidden @xl:block flex-1" />
        {!question.required && (
          <button type="button" onClick={questionSkip} className={ghostBtn} disabled={busy}>
            <T>Skip</T>
          </button>
        )}
        <button type="button" onClick={questionNext} disabled={busy} aria-busy={busy || undefined} className={cn(primaryBtn, grow)}>
          {busy ? <Loader size={18} /> : isLastQuestion ? lastLabel : gt("Next")}
          {!busy && !isLastQuestion && <ChevronRight className="w-4 h-4" aria-hidden />}
        </button>
      </>
    );
  } else if (step === "rules" && screening) {
    body = (
      <div>
        <Heading ref={headingRef} tabIndex={-1} className={titleCls}>
          {screening.manualApproval
            ? gt("Apply to join {server}", { server: serverName })
            : gt("Before you can talk in {server}", { server: serverName })}
        </Heading>
        <p className="mt-2 text-[15px] text-[var(--text-secondary)] whitespace-pre-wrap break-words">
          {screening.description
            ? decodeHtmlEntities(screening.description)
            : screening.manualApproval
              ? gt("Read the rules and answer a few questions. A moderator will review your application.")
              : gt("Read and agree to the server rules to start chatting.")}
        </p>
        <div className="mt-6 space-y-4">
          {screening.rules.length > 0 && (
            <section className={cn(cardCls, "p-5")} aria-labelledby={`${formId}-rules`}>
              <h2 id={`${formId}-rules`} className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)] mb-4">
                <ScrollText className="w-5 h-5 text-[var(--app-accent)]" aria-hidden />
                <T>Server Rules</T>
              </h2>
              <RulesList rules={screening.rules} />
            </section>
          )}
          {appQuestions.length > 0 && (
            <section className={cn(cardCls, "p-5")} aria-labelledby={`${formId}-app`}>
              <h2 id={`${formId}-app`} className="text-base font-semibold text-[var(--text-primary)] mb-4">
                <T>Questions from the moderators</T>
              </h2>
              <ApplicationQuestionFields
                questions={appQuestions}
                answers={answers}
                onChange={setAnswer}
                errors={answerErrors}
                idPrefix={`${formId}-a`}
                disabled={busy}
              />
            </section>
          )}
          <label
            className={cn(
              cardCls,
              "flex items-center gap-3.5 p-4 min-h-[60px] text-[15px] font-medium text-[var(--text-primary)] cursor-pointer select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--app-accent)]/50",
              agreed && "border-[var(--app-accent)]/60",
            )}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={busy}
              className="w-5 h-5 shrink-0 accent-[var(--app-accent)]"
            />
            <span><T>I have read and agree to the rules</T></span>
          </label>
        </div>
      </div>
    );
    const canGoBack = steps.indexOf("rules") > 0;
    footer = (
      <>
        {canGoBack && (
          <button type="button" onClick={() => backFrom("rules")} className={ghostBtn} disabled={busy}>
            <ArrowLeft className="w-4 h-4" aria-hidden />
            <T>Back</T>
          </button>
        )}
        <div className="hidden @xl:block flex-1" />
        <button
          type="button"
          onClick={() => void submitRulesStep()}
          disabled={!agreed || busy}
          aria-busy={busy || undefined}
          className={cn(primaryBtn, grow)}
        >
          {busy ? <Loader size={18} /> : screening.manualApproval ? gt("Submit application") : gt("Submit")}
        </button>
      </>
    );
  } else {
    // status
    const restricted = Boolean(screening?.restrictChannels);
    if (statusKind === "pending") {
      body = (
        <StatusPanel
          icon={<Hourglass className="w-9 h-9" aria-hidden />}
          tone="pending"
          title={<Heading ref={headingRef} tabIndex={-1} className={titleCls}>{gt("Your application is being reviewed")}</Heading>}
        >
          <p className="text-[15px] text-[var(--text-secondary)]">
            {gt("A moderator of {server} will look at your answers soon. You'll be let in as soon as they approve it.", { server: serverName })}
          </p>
          {restricted && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              <T>Some channels stay hidden until you&apos;re approved.</T>
            </p>
          )}
        </StatusPanel>
      );
      footer = (
        <>
          {preview && (
            <button type="button" onClick={() => setPreviewOutcome("approved")} className={ghostBtn}>
              <T>Simulate approval</T>
            </button>
          )}
          <div className="hidden @xl:block flex-1" />
          <button type="button" onClick={() => leave()} className={cn(primaryBtn, grow)}>
            {preview ? gt("Continue") : gt("Close")}
          </button>
        </>
      );
    } else if (statusKind === "rejected") {
      const reason = app?.rejectionReason ? decodeHtmlEntities(app.rejectionReason) : "";
      body = (
        <StatusPanel
          icon={<CircleX className="w-9 h-9" aria-hidden />}
          tone="rejected"
          title={<Heading ref={headingRef} tabIndex={-1} className={titleCls}>{gt("Your application was not approved")}</Heading>}
        >
          <p className="text-[15px] text-[var(--text-secondary)]">
            {gt("You can edit your answers and send it again.")}
          </p>
          {reason && (
            <div className={cn(cardCls, "mt-5 w-full p-4 text-left")}>
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1"><T>Reason</T></div>
              <p className="text-[15px] text-[var(--text-primary)] whitespace-pre-wrap break-words">{reason}</p>
            </div>
          )}
        </StatusPanel>
      );
      footer = (
        <>
          <button type="button" onClick={() => leave()} className={ghostBtn}>
            <T>Close</T>
          </button>
          <div className="hidden @xl:block flex-1" />
          {steps.includes("rules") && (
            <button
              type="button"
              onClick={() => {
                setAgreed(false);
                go("rules", -1);
              }}
              className={cn(primaryBtn, grow)}
            >
              <T>Edit and resubmit</T>
            </button>
          )}
        </>
      );
    } else {
      body = (
        <StatusPanel
          icon={<CircleCheck className="w-9 h-9" aria-hidden />}
          tone="approved"
          title={<Heading ref={headingRef} tabIndex={-1} className={titleCls}>{gt("You're all set!")}</Heading>}
        >
          <p className="text-[15px] text-[var(--text-secondary)]">
            {gt("Welcome to {server}. Say hi and make yourself at home.", { server: serverName })}
          </p>
        </StatusPanel>
      );
      footer = data.guide ? (
        <>
          <button type="button" onClick={startChatting} className={ghostBtn}>
            {preview ? gt("Close") : gt("Start chatting")}
          </button>
          <div className="hidden @xl:block flex-1" />
          <button type="button" onClick={openGuide} className={cn(primaryBtn, grow)}>
            <Signpost className="w-4 h-4" aria-hidden />
            <T>Open Server Guide</T>
          </button>
        </>
      ) : (
        <>
          <div className="hidden @xl:block flex-1" />
          <button type="button" onClick={startChatting} className={cn(primaryBtn, grow)}>
            <T>Start chatting</T>
          </button>
        </>
      );
    }
  }

  return (
    <div className="@container relative isolate flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden bg-[var(--bg-app)]">
      <FlowBackdrop banner={server.banner} />

      {/* Header: server, step progress, exit */}
      <header className={cn("relative z-10 shrink-0 border-b border-[var(--border-subtle)]/60 bg-[var(--bg-app)]/55 backdrop-blur-xl", !preview && "pt-safe")}>
        <div className="mx-auto w-full max-w-[720px] px-4 @2xl:px-6">
          <div className="flex items-center gap-3 h-14">
            <ServerIconTile name={server.name} icon={server.icon} className="w-8 h-8 rounded-lg text-[11px]" />
            <span className="flex-1 min-w-0 text-sm font-semibold text-[var(--text-primary)] truncate">{serverName}</span>
            {preview ? (
              <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--bg-card)]/90 border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-secondary)] shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)]" aria-hidden />
                <T>Preview — nothing is saved</T>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onExit()}
                aria-label={gt("Close")}
                className={cn(
                  "w-10 h-10 -mr-2 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors shrink-0",
                  focusRing,
                )}
              >
                <X className="w-5 h-5" aria-hidden />
              </button>
            )}
          </div>
          {progressSteps.length > 1 && progressIndex >= 0 && (
            <nav aria-label={gt("Join steps")} className="pb-3">
              <ol className="flex items-start gap-2">
                {progressSteps.map((s, i) => {
                  const state = i < progressIndex ? "done" : i === progressIndex ? "current" : "upcoming";
                  return (
                    <li key={s} aria-current={state === "current" ? "step" : undefined} className="flex-1 min-w-0">
                      <span
                        className={cn(
                          "block h-1.5 rounded-full transition-colors duration-300 motion-reduce:transition-none",
                          state === "upcoming" ? "bg-[var(--app-surface-alt)]" : "bg-[var(--app-accent)]",
                        )}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "sr-only @md:not-sr-only @md:mt-1.5 @md:flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide truncate",
                          state === "current" ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]",
                        )}
                      >
                        {state === "done" && <Check className="w-3 h-3 shrink-0 text-[var(--app-accent)]" aria-hidden />}
                        {stepLabel(s)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
        </div>
      </header>

      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>

      <div ref={scrollRef} className="relative z-0 flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div key={`${step}:${qIndex}`} className={cn("mx-auto w-full max-w-[720px] px-4 @2xl:px-6 pt-6 @2xl:pt-10 pb-10", animate)}>
          {body}
        </div>
      </div>

      {/* Sticky action bar */}
      <footer className="relative z-10 shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-card)]/85 backdrop-blur-xl">
        <div
          className={cn(
            "mx-auto w-full max-w-[720px] px-4 @2xl:px-6 pt-3 flex items-center gap-2",
            preview ? "pb-3" : "pb-[max(0.75rem,var(--safe-area-bottom,0px))]",
          )}
        >
          {footer}
        </div>
      </footer>
    </div>
  );
}

/** The server banner blurred behind the page (an accent glow without one), like the invite page. */
function FlowBackdrop({ banner }: { banner: string | null }) {
  return (
    <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden" aria-hidden>
      {banner ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnImage(banner)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover scale-125"
            style={{ filter: "blur(40px) saturate(1.2)" }}
            draggable={false}
          />
          <div className="absolute inset-0 bg-[var(--bg-app)]/75" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[var(--bg-app)]/30 to-[var(--bg-app)]" />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 25% 10%, color-mix(in srgb, var(--app-accent) 20%, transparent) 0%, transparent 55%), radial-gradient(circle at 80% 85%, color-mix(in srgb, var(--app-accent) 14%, transparent) 0%, transparent 55%), var(--bg-app)",
          }}
        />
      )}
    </div>
  );
}

function StatusPanel({
  icon,
  tone,
  title,
  children,
}: {
  icon: ReactNode;
  tone: FlowStatusKind;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center pt-6 @2xl:pt-12">
      <div
        className={cn(
          "w-20 h-20 rounded-full flex items-center justify-center mb-5 animate-in zoom-in-75 fade-in-0 duration-300 motion-reduce:animate-none",
          tone === "approved" && "bg-emerald-500/15 text-emerald-500",
          tone === "pending" && "bg-amber-500/15 text-amber-500",
          tone === "rejected" && "bg-red-500/15 text-red-500",
        )}
      >
        {icon}
      </div>
      {title}
      <div className="mt-3 max-w-md flex flex-col items-center">{children}</div>
    </div>
  );
}

export default ServerJoinFlow;
