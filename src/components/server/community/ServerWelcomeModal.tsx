"use client";

import { useEffect, useId, useMemo, useRef, useState, type ElementType } from "react";
import { useRouter } from "next/navigation";
import { T, useGT } from "gt-next";
import {
  ArrowLeft,
  Check,
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
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Loader } from "@/components/ui/Loader";
import { useServer } from "@/contexts/ServerContext";
import {
  useServerOnboarding,
  type OnboardingOptionView,
  type ServerOnboarding,
} from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { cn } from "@/lib/utils";
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

export type OnboardingFlowStep = "welcome" | "questions" | "rules" | "status";

interface ServerWelcomeModalProps {
  serverId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which step to open on; falls back to the first one the server has. */
  initialStep?: OnboardingFlowStep;
  /** Admin preview: render this data instead of the member's, and save nothing. */
  previewData?: ServerOnboarding;
}

function ChannelGlyph({ type, className }: { type?: string; className?: string }) {
  const cls = cn("w-4 h-4 shrink-0", className);
  if (type === "voice" || type === "stage") return <Volume2 className={cls} />;
  if (type === "announcement") return <Megaphone className={cls} />;
  if (type === "forum") return <MessageSquare className={cls} />;
  return <Hash className={cls} />;
}

/** The steps this member goes through, fixed when the flow opens. */
function planSteps(data: ServerOnboarding, preview: boolean, initialStep?: OnboardingFlowStep): OnboardingFlowStep[] {
  const steps: OnboardingFlowStep[] = [];
  const questions = data.onboarding?.questions ?? [];
  const hasQuestions = questions.length > 0 && (preview || !data.member.onboardingCompleted || initialStep === "questions");
  const hasRules = Boolean(data.screening) && (preview || data.member.screeningBlocked);
  if (data.welcomeScreen || initialStep === "welcome" || (!hasQuestions && !hasRules)) steps.push("welcome");
  if (hasQuestions) steps.push("questions");
  if (hasRules) steps.push("rules");
  steps.push("status");
  return steps;
}

function startStep(steps: OnboardingFlowStep[], data: ServerOnboarding, preview: boolean, initialStep?: OnboardingFlowStep): OnboardingFlowStep {
  let start = initialStep && steps.includes(initialStep) ? initialStep : steps[0];
  const app = data.member.application;
  // Someone with an application in review (or turned down) lands on its status.
  if (!preview && data.member.screeningBlocked && app && app.status !== "approved" && (start === "rules" || initialStep === "status")) {
    start = "status";
  }
  return start;
}

type StatusKind = "approved" | "pending" | "rejected";

interface ServerOnboardingFlowProps {
  serverId: string;
  data: ServerOnboarding;
  /** Admin preview: everything stays local, nothing is sent. */
  preview?: boolean;
  initialStep?: OnboardingFlowStep;
  onClose: () => void;
  /** Preview: the flow ended (the join preview moves on to the Server Guide). */
  onFinish?: () => void;
  /** Rendered inside a Radix Dialog (uses DialogTitle for the heading). */
  inDialog?: boolean;
  /** Hide the top-right close button (the join preview has its own). */
  hideClose?: boolean;
}

/**
 * Discord's join flow for a server: welcome screen → onboarding questions
 * (roles / channels) → rules screening (with application questions when the
 * server reviews members by hand) → the outcome. Used in a dialog by the
 * composer gate and inline by the admin join preview.
 */
export function ServerOnboardingFlow({
  serverId,
  data,
  preview = false,
  initialStep,
  onClose,
  onFinish,
  inDialog = false,
  hideClose = false,
}: ServerOnboardingFlowProps) {
  const gt = useGT();
  const router = useRouter();
  const { channels, fetchChannels } = useServer();
  // Preview never touches the member's state (the hook skips a null server).
  const { submitRules, submitOnboarding } = useServerOnboarding(preview ? null : serverId);
  const formId = useId();

  const [steps] = useState(() => planSteps(data, preview, initialStep));
  const [step, setStep] = useState<OnboardingFlowStep>(() => startStep(steps, data, preview, initialStep));
  const [direction, setDirection] = useState<1 | -1>(1);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Questions
  const questions = useMemo(() => data.onboarding?.questions ?? [], [data.onboarding]);
  const [qIndex, setQIndex] = useState(0);
  const [selected, setSelected] = useState<string[]>(() => {
    if (preview) return [];
    const valid = new Set(questions.flatMap((q) => q.options.map((o) => o.id)));
    return data.member.optionIds.filter((id) => valid.has(id));
  });
  const [qError, setQError] = useState<string | null>(null);

  // Rules
  const screening = data.screening;
  const appQuestions = useMemo(
    () => (screening?.manualApproval ? screening.questions : []),
    [screening],
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [agreed, setAgreed] = useState(false);
  const [previewOutcome, setPreviewOutcome] = useState<StatusKind | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // Move focus + scroll to the top on every page change (not on open: the
  // dialog focuses its first control itself).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    scrollRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [step, qIndex]);

  const server = data.server;
  const serverName = decodeHtmlEntities(server.name);
  const channelById = useMemo(() => new Map(channels.map((c) => [c.id, c])), [channels]);

  const go = (next: OnboardingFlowStep, dir: 1 | -1) => {
    setDirection(dir);
    setStep(next);
  };

  const finish = () => {
    if (preview) onFinish?.();
    else onClose();
  };

  /** Next page after `from`; ends the flow when only an unneeded status page is left. */
  const advanceFrom = (from: OnboardingFlowStep, didSubmit = submitted) => {
    const next = steps[steps.indexOf(from) + 1];
    if (!next || (next === "status" && !didSubmit)) {
      finish();
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
    onClose();
    router.push(`/channels/${serverId}/${channelId}`);
  };

  // ── Questions ──────────────────────────────────────────────────────────────
  const question = questions[qIndex];
  const toggleOption = (option: OnboardingOptionView) => {
    if (!question) return;
    setQError(null);
    setSelected((prev) => {
      if (question.multiple) {
        return prev.includes(option.id) ? prev.filter((id) => id !== option.id) : [...prev, option.id];
      }
      const others = new Set(question.options.map((o) => o.id));
      if (prev.includes(option.id) && !question.required) return prev.filter((id) => id !== option.id);
      return [...prev.filter((id) => !others.has(id)), option.id];
    });
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
        setDirection(idx < qIndex ? -1 : 1);
        setQIndex(idx);
        setQError(res.error || gt("Answer this question to continue."));
      } else {
        toast.error(res.error || gt("Could not save your answers. Try again."));
      }
      return;
    }
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
    if (qIndex < questions.length - 1) {
      setDirection(1);
      setQIndex(qIndex + 1);
    } else {
      void submitQuestions();
    }
  };

  const questionSkip = () => {
    if (!question || question.required) return;
    const ids = new Set(question.options.map((o) => o.id));
    setSelected((prev) => prev.filter((id) => !ids.has(id)));
    setQError(null);
    if (qIndex < questions.length - 1) {
      setDirection(1);
      setQIndex(qIndex + 1);
    } else {
      void submitQuestions();
    }
  };

  const questionBack = () => {
    setQError(null);
    if (qIndex > 0) {
      setDirection(-1);
      setQIndex(qIndex - 1);
    } else {
      backFrom("questions");
    }
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
  const statusKind: StatusKind = preview
    ? previewOutcome ?? "approved"
    : data.member.screeningBlocked && app?.status === "rejected"
      ? "rejected"
      : data.member.screeningBlocked && (app?.status === "pending" || app?.status === "interviewed" || screening?.manualApproval)
        ? "pending"
        : "approved";

  const openGuide = () => {
    if (preview) {
      onFinish?.();
      return;
    }
    onClose();
    router.push(`/channels/${serverId}/guide`);
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  const Title: ElementType = inDialog ? DialogTitle : "h2";
  const Description: ElementType = inDialog ? DialogDescription : "p";
  const progressSteps: OnboardingFlowStep[] = steps.filter((s) => s !== "status");
  const progressIndex = progressSteps.indexOf(step);
  const isLastQuestion = qIndex >= questions.length - 1;
  const nextAfterQuestions = steps[steps.indexOf("questions") + 1];

  const animate = cn(
    "animate-in fade-in-0 duration-300 motion-reduce:animate-none",
    direction > 0 ? "slide-in-from-right-4" : "slide-in-from-left-4",
  );

  const primaryBtn =
    "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-lg bg-[var(--app-accent)] text-[var(--text-on-accent)] font-semibold text-sm transition-[filter,opacity] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-card)]";
  const ghostBtn =
    "inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-lg text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60";

  const compactHeader = (
    <div className="flex items-center gap-2.5 px-5 sm:px-6 pt-5 pb-1">
      <ServerIconTile name={server.name} icon={server.icon} className="w-7 h-7 rounded-lg text-[10px]" />
      <span className="text-xs font-semibold text-[var(--text-secondary)] truncate">{serverName}</span>
    </div>
  );

  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (step === "welcome") {
    const welcome = data.welcomeScreen;
    const description = decodeHtmlEntities(welcome?.description || server.description || "");
    body = (
      <div>
        <div className="relative">
          <ServerBannerArt banner={server.banner} className="h-28 sm:h-32">
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--bg-app)]/60" />
          </ServerBannerArt>
          <div className="absolute left-1/2 -bottom-9 -translate-x-1/2 rounded-[22px] p-1 bg-[var(--bg-app)]">
            <ServerIconTile name={server.name} icon={server.icon} className="w-[72px] h-[72px] rounded-[18px] text-2xl" />
          </div>
        </div>
        <div className="flex flex-col items-center text-center px-5 sm:px-6 pt-12 pb-2">
          <Title ref={headingRef} tabIndex={-1} className="text-xl sm:text-2xl font-bold text-[var(--text-primary)] outline-none">
            {gt("Welcome to {server}!", { server: serverName })}
          </Title>
          <ServerStats online={server.onlineCount} members={server.memberCount} className="justify-center mt-2" />
          {description ? (
            <Description className="text-sm text-[var(--text-secondary)] mt-3 whitespace-pre-wrap break-words max-w-prose">
              {description}
            </Description>
          ) : (
            <Description className="sr-only">{gt("Get to know the server before you jump in.")}</Description>
          )}
        </div>
        {welcome && welcome.welcomeChannels.length > 0 && (
          <div className="px-4 sm:px-5 pt-3 pb-5 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] px-1">
              <T>Here are some popular channels to get you started</T>
            </div>
            {welcome.welcomeChannels.map((wc) => {
              const ch = channelById.get(wc.channelId);
              return (
                <button
                  key={wc.channelId}
                  type="button"
                  onClick={() => goToChannel(wc.channelId)}
                  aria-disabled={preview || undefined}
                  className={cn(
                    "group w-full flex items-center gap-3 p-3 min-h-[60px] rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60",
                    preview ? "cursor-default" : "hover:bg-[var(--bg-hover)] hover:border-[var(--app-accent)]/40",
                  )}
                >
                  <span className="w-10 h-10 rounded-full bg-[var(--app-surface-alt)] flex items-center justify-center text-lg shrink-0" aria-hidden>
                    <EmojiOrIcon
                      emoji={wc.emojiId ? null : wc.emojiName}
                      fallback={<ChannelGlyph type={ch?.type} className="w-5 h-5 text-[var(--text-secondary)]" />}
                    />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-[var(--text-primary)] truncate">
                      {wc.description ? decodeHtmlEntities(wc.description) : `#${ch?.name ?? ""}`}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] min-w-0">
                      <ChannelGlyph type={ch?.type} className="w-3.5 h-3.5" />
                      <span className="truncate">{ch?.name ?? gt("channel")}</span>
                    </span>
                  </span>
                  {!preview && <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
    const next = steps[steps.indexOf("welcome") + 1];
    const ends = !next || (next === "status" && !submitted);
    footer = (
      <button type="button" onClick={() => advanceFrom("welcome")} className={cn(primaryBtn, "flex-1 sm:flex-none sm:min-w-[140px] ml-auto")}>
        {ends ? gt("Got it") : gt("Continue")}
        {!ends && <ChevronRight className="w-4 h-4" aria-hidden />}
      </button>
    );
  } else if (step === "questions" && question) {
    const pct = ((qIndex + 1) / questions.length) * 100;
    body = (
      <div>
        {compactHeader}
        <div className="px-5 sm:px-6 pt-3">
          <div className="flex items-center justify-between text-xs font-medium text-[var(--text-muted)] mb-2">
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
            <div className="h-full rounded-full bg-[var(--app-accent)] transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
          <Title ref={headingRef} tabIndex={-1} className="mt-5 text-lg sm:text-xl font-bold text-[var(--text-primary)] outline-none break-words">
            {decodeHtmlEntities(question.title)}
            {question.required && <span className="text-red-500 ml-1" aria-hidden>*</span>}
          </Title>
          <Description className="mt-1 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {question.description
              ? decodeHtmlEntities(question.description)
              : question.multiple
                ? gt("Pick as many as you like.")
                : gt("Pick one.")}
          </Description>
        </div>
        <div
          role={question.multiple ? "group" : "radiogroup"}
          aria-label={decodeHtmlEntities(question.title)}
          aria-required={question.required || undefined}
          aria-invalid={Boolean(qError) || undefined}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-4 sm:px-5 pt-4 pb-5"
        >
          {question.options.map((option) => {
            const isOn = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={question.multiple ? "checkbox" : "radio"}
                aria-checked={isOn}
                onClick={() => toggleOption(option)}
                className={cn(
                  "relative flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60",
                  isOn
                    ? "border-[var(--app-accent)] bg-[var(--app-accent)]/12 shadow-[0_0_0_1px_var(--app-accent)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] hover:border-[var(--text-muted)]/40",
                )}
              >
                <span className="w-10 h-10 rounded-lg bg-[var(--app-surface-alt)] flex items-center justify-center text-xl shrink-0" aria-hidden>
                  <EmojiOrIcon emoji={option.emoji} fallback={<Sparkles className="w-5 h-5 text-[var(--text-muted)]" />} />
                </span>
                <span className="flex-1 min-w-0 pr-6">
                  <span className="block text-sm font-semibold text-[var(--text-primary)] break-words">{decodeHtmlEntities(option.title)}</span>
                  {option.description && (
                    <span className="block mt-0.5 text-xs text-[var(--text-secondary)] break-words line-clamp-3">{decodeHtmlEntities(option.description)}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "absolute top-3 right-3 w-5 h-5 flex items-center justify-center border-2 transition-colors",
                    question.multiple ? "rounded-md" : "rounded-full",
                    isOn ? "bg-[var(--app-accent)] border-[var(--app-accent)] text-[var(--text-on-accent)]" : "border-[var(--text-muted)]/50",
                  )}
                  aria-hidden
                >
                  {isOn && <Check className="w-3 h-3" strokeWidth={3} />}
                </span>
              </button>
            );
          })}
        </div>
        {qError && (
          <p role="alert" className="px-5 sm:px-6 -mt-2 pb-4 text-sm text-red-500">{qError}</p>
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
        <div className="flex-1" />
        {!question.required && (
          <button type="button" onClick={questionSkip} className={ghostBtn} disabled={busy}>
            <T>Skip</T>
          </button>
        )}
        <button type="button" onClick={questionNext} disabled={busy} className={cn(primaryBtn, "min-w-[110px]")}>
          {busy ? <Loader size={16} /> : isLastQuestion ? lastLabel : gt("Next")}
          {!busy && !isLastQuestion && <ChevronRight className="w-4 h-4" aria-hidden />}
        </button>
      </>
    );
  } else if (step === "rules" && screening) {
    body = (
      <div>
        {compactHeader}
        <div className="px-5 sm:px-6 pt-3 pb-2">
          <Title ref={headingRef} tabIndex={-1} className="text-lg sm:text-xl font-bold text-[var(--text-primary)] outline-none">
            {screening.manualApproval
              ? gt("Apply to join {server}", { server: serverName })
              : gt("Before you can talk in {server}", { server: serverName })}
          </Title>
          <Description className="mt-1 text-sm text-[var(--text-secondary)] whitespace-pre-wrap break-words">
            {screening.description
              ? decodeHtmlEntities(screening.description)
              : screening.manualApproval
                ? gt("Read the rules and answer a few questions. A moderator will review your application.")
                : gt("Read and agree to the server rules to start chatting.")}
          </Description>
        </div>
        <div className="px-4 sm:px-5 pt-2 pb-5 space-y-4">
          {screening.rules.length > 0 && (
            <section className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4" aria-labelledby={`${formId}-rules`}>
              <h3 id={`${formId}-rules`} className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-3">
                <ScrollText className="w-4 h-4 text-[var(--app-accent)]" aria-hidden />
                <T>Server Rules</T>
              </h3>
              <RulesList rules={screening.rules} />
            </section>
          )}
          {appQuestions.length > 0 && (
            <section className="rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-4" aria-labelledby={`${formId}-app`}>
              <h3 id={`${formId}-app`} className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                <T>Questions from the moderators</T>
              </h3>
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
          <label className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] text-sm text-[var(--text-primary)] cursor-pointer select-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--app-accent)]/50">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--app-accent)]"
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
        <div className="flex-1" />
        <button type="button" onClick={() => void submitRulesStep()} disabled={!agreed || busy} className={cn(primaryBtn, "min-w-[120px]")}>
          {busy ? <Loader size={16} /> : screening.manualApproval ? gt("Submit application") : gt("Submit")}
        </button>
      </>
    );
  } else {
    // status
    const restricted = Boolean(screening?.restrictChannels);
    if (statusKind === "pending") {
      body = (
        <StatusPanel
          icon={<Hourglass className="w-8 h-8" aria-hidden />}
          tone="pending"
          title={<Title ref={headingRef} tabIndex={-1} className="text-xl font-bold text-[var(--text-primary)] outline-none">{gt("Your application is being reviewed")}</Title>}
        >
          <Description className="text-sm text-[var(--text-secondary)]">
            {gt("A moderator of {server} will look at your answers soon. You'll be let in as soon as they approve it.", { server: serverName })}
          </Description>
          {restricted && (
            <p className="mt-2 text-xs text-[var(--text-muted)]">
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
          <div className="flex-1" />
          <button type="button" onClick={finish} className={cn(primaryBtn, "min-w-[120px]")}>
            {preview ? gt("Continue") : gt("Close")}
          </button>
        </>
      );
    } else if (statusKind === "rejected") {
      const reason = app?.rejectionReason ? decodeHtmlEntities(app.rejectionReason) : "";
      body = (
        <StatusPanel
          icon={<CircleX className="w-8 h-8" aria-hidden />}
          tone="rejected"
          title={<Title ref={headingRef} tabIndex={-1} className="text-xl font-bold text-[var(--text-primary)] outline-none">{gt("Your application was not approved")}</Title>}
        >
          <Description className="text-sm text-[var(--text-secondary)]">
            {gt("You can edit your answers and send it again.")}
          </Description>
          {reason && (
            <div className="mt-4 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3 text-left">
              <div className="text-[11px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-1"><T>Reason</T></div>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{reason}</p>
            </div>
          )}
        </StatusPanel>
      );
      footer = (
        <>
          <button type="button" onClick={onClose} className={ghostBtn}>
            <T>Close</T>
          </button>
          <div className="flex-1" />
          {steps.includes("rules") && (
            <button
              type="button"
              onClick={() => {
                setAgreed(false);
                go("rules", -1);
              }}
              className={cn(primaryBtn, "min-w-[140px]")}
            >
              <T>Edit and resubmit</T>
            </button>
          )}
        </>
      );
    } else {
      body = (
        <StatusPanel
          icon={<CircleCheck className="w-8 h-8" aria-hidden />}
          tone="approved"
          title={<Title ref={headingRef} tabIndex={-1} className="text-xl font-bold text-[var(--text-primary)] outline-none">{gt("You're all set!")}</Title>}
        >
          <Description className="text-sm text-[var(--text-secondary)]">
            {gt("Welcome to {server}. Say hi and make yourself at home.", { server: serverName })}
          </Description>
        </StatusPanel>
      );
      footer = (
        <>
          {data.guide ? (
            <button type="button" onClick={finish} className={ghostBtn}>
              {preview ? gt("Close") : gt("Start chatting")}
            </button>
          ) : null}
          <div className="flex-1" />
          {data.guide ? (
            <button type="button" onClick={openGuide} className={cn(primaryBtn, "min-w-[160px]")}>
              <Signpost className="w-4 h-4" aria-hidden />
              <T>Open Server Guide</T>
            </button>
          ) : (
            <button type="button" onClick={finish} className={cn(primaryBtn, "min-w-[140px]")}>
              <T>Start chatting</T>
            </button>
          )}
        </>
      );
    }
  }

  return (
    <div className="relative flex flex-col flex-1 min-h-0 bg-[var(--bg-app)]">
      {/* Top strip: step progress, preview pill, close */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-start justify-between gap-2 p-3 pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          {preview && (
            <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-[var(--bg-card)]/90 backdrop-blur border border-[var(--border-subtle)] text-[11px] font-semibold text-[var(--text-secondary)] shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--app-accent)]" aria-hidden />
              <T>Preview — nothing is saved</T>
            </span>
          )}
        </div>
        {!hideClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={gt("Close")}
            className="pointer-events-auto w-9 h-9 rounded-full flex items-center justify-center bg-[var(--bg-card)]/85 backdrop-blur border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/60"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div key={`${step}:${qIndex}`} className={animate}>
          {/* Leave room for the floating close / preview controls on steps without a banner. */}
          {step !== "welcome" && <div className="h-8" aria-hidden />}
          {body}
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] px-4 sm:px-5 pt-3 pb-[max(0.75rem,var(--safe-area-bottom,0px))]">
        {progressSteps.length > 1 && progressIndex >= 0 && (
          <div className="flex items-center gap-1.5 mb-3" aria-hidden>
            {progressSteps.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors duration-300",
                  i <= progressIndex ? "bg-[var(--app-accent)]" : "bg-[var(--app-surface-alt)]",
                )}
              />
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">{footer}</div>
      </div>
    </div>
  );
}

function StatusPanel({
  icon,
  tone,
  title,
  children,
}: {
  icon: React.ReactNode;
  tone: StatusKind;
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center px-6 pt-8 pb-8">
      <div
        className={cn(
          "w-16 h-16 rounded-full flex items-center justify-center mb-4 animate-in zoom-in-75 fade-in-0 duration-300 motion-reduce:animate-none",
          tone === "approved" && "bg-emerald-500/15 text-emerald-500",
          tone === "pending" && "bg-amber-500/15 text-amber-500",
          tone === "rejected" && "bg-red-500/15 text-red-500",
        )}
      >
        {icon}
      </div>
      {title}
      <div className="mt-2 max-w-sm flex flex-col items-center">{children}</div>
    </div>
  );
}

/**
 * Discord's join flow in a dialog: Welcome Screen, onboarding questions,
 * Rules Screening (and the application when moderators review members), then
 * the outcome. With `previewData` it is the admin's preview and saves nothing.
 */
export default function ServerWelcomeModal({ serverId, open, onOpenChange, initialStep, previewData }: ServerWelcomeModalProps) {
  const gt = useGT();
  const { data: live } = useServerOnboarding(previewData ? null : serverId);
  const data = previewData ?? live;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 overflow-hidden sm:max-w-[540px] max-h-[90dvh] flex flex-col bg-[var(--bg-app)] max-sm:h-[calc(100dvh-var(--safe-area-top,0px)-0.75rem)] max-sm:overflow-hidden max-sm:pb-0"
      >
        {data ? (
          <ServerOnboardingFlow
            serverId={serverId}
            data={data}
            preview={Boolean(previewData)}
            initialStep={initialStep}
            onClose={() => onOpenChange(false)}
            onFinish={() => onOpenChange(false)}
            inDialog
          />
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <DialogTitle className="sr-only">{gt("Loading")}</DialogTitle>
            <DialogDescription className="sr-only">{gt("Loading the server's welcome steps.")}</DialogDescription>
            <Loader size={28} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
