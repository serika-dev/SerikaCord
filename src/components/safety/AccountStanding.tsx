"use client";

import { useId, useState, type ReactNode } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Gavel,
  MessageSquareOff,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserCog,
  XCircle,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader } from "@/components/ui/Loader";
import { cdnImage, cn } from "@/lib/utils";
import { APPEAL_MESSAGE_MAX, APPEAL_MESSAGE_MIN, MAX_STRIKES } from "@/lib/safety/standing";
import { sendJson, useJsonQuery } from "./useJsonQuery";
import {
  LEVEL_STYLE,
  STANDING_LEVELS,
  appealFor,
  categoryLabel,
  formatDate,
  formatRemaining,
  levelLabel,
  plain,
  useClock,
  type AppealRef,
  type GT,
  type SafetyUserCard,
  type StandingData,
  type StandingLevel,
  type StandingRestriction,
  type StandingStrike,
} from "./standingShared";

// Account Standing (Discord-style): where the account sits on the
// All good → Suspended scale, its strikes and restrictions, and appeals.
// `AccountStanding` is the signed-in user's own screen (User Settings tab,
// mobile settings page, suspended screen). `StandingDisplay` is the
// presentational part, reused read-only by the staff Trust & Safety panel.

type Variant = "self" | "staff";

const cardClass = "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)]";

function heading(level: StandingLevel, variant: Variant, gt: GT): string {
  if (variant === "staff") {
    switch (level) {
      case "all_good": return gt("This account is all good");
      case "limited": return gt("This account is limited");
      case "very_limited": return gt("This account is very limited");
      case "at_risk": return gt("This account is at risk");
      case "suspended": return gt("This account is suspended");
    }
  }
  switch (level) {
    case "all_good": return gt("Your account is all good");
    case "limited": return gt("Your account is limited");
    case "very_limited": return gt("Your account is very limited");
    case "at_risk": return gt("Your account is at risk");
    case "suspended": return gt("Your account is suspended");
  }
  return levelLabel(level, gt);
}

function explanation(level: StandingLevel, variant: Variant, max: number, gt: GT): string {
  if (variant === "staff") {
    switch (level) {
      case "all_good": return gt("No active strikes or restrictions.");
      case "limited": return gt("One active strike, or an active restriction.");
      case "very_limited": return gt("Two active strikes.");
      case "at_risk": return gt("Three or more active strikes. Reaching {max} suspends the account automatically.", { max });
      case "suspended": return gt("The account is suspended. It can only see its standing and appeal.");
    }
  }
  switch (level) {
    case "all_good":
      return gt("Thanks for following the Community Guidelines. You have no active violations or restrictions.");
    case "limited":
      return gt("You broke a rule. Some features may be limited while a restriction is active. Strikes expire over time, but more violations move your account further along this scale.");
    case "very_limited":
      return gt("You have broken the rules more than once. Further violations can limit your account more or get it suspended.");
    case "at_risk":
      return gt("Your account is close to being suspended. Reaching {max} active strikes suspends it automatically.", { max });
    case "suspended":
      return gt("Your account was suspended for breaking the Community Guidelines. You can't use SerikaCord, but you can review what happened and appeal.");
  }
  return "";
}

function LevelIcon({ level, className }: { level: StandingLevel; className?: string }) {
  switch (level) {
    case "all_good": return <ShieldCheck className={className} aria-hidden />;
    case "limited": return <AlertTriangle className={className} aria-hidden />;
    case "very_limited": return <AlertTriangle className={className} aria-hidden />;
    case "at_risk": return <ShieldAlert className={className} aria-hidden />;
    case "suspended": return <Ban className={className} aria-hidden />;
  }
  return null;
}

// ─── Meter ────────────────────────────────────────────────────────────────────

export function StandingMeter({ level }: { level: StandingLevel }) {
  const gt = useGT();
  const index = Math.max(0, STANDING_LEVELS.indexOf(level));
  const style = LEVEL_STYLE[level];
  return (
    <div className="relative pt-1" role="img" aria-label={gt("Account standing: {level}", { level: levelLabel(level, gt) })}>
      {/* Track from the first node's centre to the last one's (10% → 90%). */}
      <div aria-hidden className="absolute left-[10%] right-[10%] top-[17px] h-1 rounded-full bg-[var(--border-subtle)]" />
      <div
        aria-hidden
        className={cn("absolute left-[10%] top-[17px] h-1 rounded-full transition-[width] duration-500", style.dot)}
        style={{ width: `${index * 20}%` }}
      />
      <ol className="relative grid grid-cols-5">
        {STANDING_LEVELS.map((step, i) => {
          const current = i === index;
          return (
            <li key={step} className="flex flex-col items-center gap-2 text-center" aria-current={current ? "step" : undefined}>
              <span className="flex h-8 items-center justify-center">
                {current ? (
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-full ring-4 shadow-md", style.dot, style.ring)}>
                    <LevelIcon level={step} className="h-4 w-4 text-white" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      "h-3.5 w-3.5 rounded-full border-2 border-[var(--bg-card)]",
                      i < index ? cn(LEVEL_STYLE[step].dot, "opacity-70") : "bg-[var(--border-strong)]"
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  "px-0.5 text-[11px] leading-tight sm:text-xs",
                  current ? cn("font-semibold", style.text) : "text-[var(--text-muted)]"
                )}
              >
                {levelLabel(step, gt)}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function StrikePips({ active, max }: { active: number; max: number }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-5 rounded-full",
            i < active ? (active >= max ? "bg-red-500" : active >= 3 ? "bg-orange-500" : "bg-amber-500") : "bg-[var(--border-strong)]"
          )}
        />
      ))}
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function StandingHero({ user, standing, variant }: { user: SafetyUserCard | null; standing: StandingData; variant: Variant }) {
  const gt = useGT();
  const style = LEVEL_STYLE[standing.level];
  const name = plain(user?.displayName || user?.username || "");
  const max = standing.maxStrikes || MAX_STRIKES;
  const headingId = useId();
  return (
    <section className={cn(cardClass, "overflow-hidden")} aria-labelledby={headingId}>
      <div className={cn("flex items-center gap-3 px-4 py-4 sm:px-5", style.soft)}>
        {user && (
          <Avatar className="h-12 w-12 shrink-0 ring-2 ring-[var(--bg-card)]">
            <AvatarImage src={cdnImage(user.avatar)} alt="" />
            <AvatarFallback className="bg-[var(--app-accent)] text-lg font-bold text-[var(--text-on-accent)]">
              {(name || "?").charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <div className="min-w-0 flex-1">
          {user && (
            <p className="truncate text-xs text-[var(--text-secondary)]">
              {name}
              {user.username && user.displayName ? <span className="text-[var(--text-muted)]"> · @{plain(user.username)}</span> : null}
            </p>
          )}
          <h2 id={headingId} className={cn("text-lg font-bold leading-snug sm:text-xl", style.text)}>
            {heading(standing.level, variant, gt)}
          </h2>
        </div>
        <LevelIcon level={standing.level} className={cn("hidden h-9 w-9 shrink-0 sm:block", style.text)} />
      </div>
      <div className="space-y-5 px-4 py-5 sm:px-5">
        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{explanation(standing.level, variant, max, gt)}</p>
        <StandingMeter level={standing.level} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--bg-app)] px-3 py-2.5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Active strikes")}</p>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              {gt("{count} of {max}", { count: standing.activeStrikes, max })}
            </p>
          </div>
          <StrikePips active={Math.min(standing.activeStrikes, max)} max={max} />
        </div>
      </div>
    </section>
  );
}

// ─── Appeals ──────────────────────────────────────────────────────────────────

function AppealStatus({ appeal, variant }: { appeal: AppealRef; variant: Variant }) {
  const gt = useGT();
  const note = appeal.staffNote ? plain(appeal.staffNote) : "";
  if (appeal.status === "approved") {
    return (
      <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
        <p className="flex items-center gap-1.5 font-medium text-emerald-500">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {gt("Appeal approved")}
        </p>
        {note && <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{gt("Note from Trust & Safety:")} {note}</p>}
      </div>
    );
  }
  if (appeal.status === "denied") {
    return (
      <div className="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-sm">
        <p className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
          <XCircle className="h-4 w-4 text-red-500" aria-hidden />
          {gt("Appeal denied")}
        </p>
        {note && <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text-secondary)]">{gt("Note from Trust & Safety:")} {note}</p>}
        {variant === "self" && <p className="mt-1 text-xs text-[var(--text-muted)]">{gt("This decision is final.")}</p>}
      </div>
    );
  }
  return (
    <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-[var(--app-accent)]/30 bg-[var(--app-accent)]/10 px-3 py-2 text-sm font-medium text-[var(--text-primary)]">
      <Clock className="h-4 w-4 text-[var(--app-accent)]" aria-hidden />
      {variant === "self" ? gt("Appeal submitted — under review") : gt("Appeal open")}
    </div>
  );
}

function AppealForm({
  targetType,
  targetId,
  onCancel,
  onSubmitted,
}: {
  targetType: "strike" | "restriction" | "ban";
  targetId?: string;
  onCancel: () => void;
  onSubmitted: () => void;
}) {
  const gt = useGT();
  const fieldId = useId();
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const length = message.trim().length;
  const tooShort = length < APPEAL_MESSAGE_MIN;

  const submit = async () => {
    if (tooShort || sending) return;
    setSending(true);
    try {
      await sendJson("/api/users/@me/standing/appeals", {
        method: "POST",
        json: { targetType, ...(targetId ? { targetId } : {}), message: message.trim() },
      });
      toast.success(gt("Appeal submitted. We'll let you know once it's reviewed."));
      onSubmitted();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : gt("Could not submit your appeal"));
      setSending(false);
    }
  };

  return (
    <form
      className="mt-3 space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-app)] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={fieldId} className="block text-sm font-medium text-[var(--text-primary)]">
        {targetType === "ban" ? gt("Why should your account be restored?") : gt("Why should this be removed?")}
      </label>
      <textarea
        id={fieldId}
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, APPEAL_MESSAGE_MAX))}
        maxLength={APPEAL_MESSAGE_MAX}
        rows={4}
        autoFocus
        placeholder={gt("Explain what happened. Be honest and specific — a person on our team will read this.")}
        className="w-full resize-y rounded-md border border-[var(--border-subtle)] bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--app-accent)]"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-xs", tooShort && length > 0 ? "text-amber-500" : "text-[var(--text-muted)]")} aria-live="polite">
          {tooShort
            ? gt("At least {min} characters", { min: APPEAL_MESSAGE_MIN })
            : gt("{count} / {max}", { count: message.length, max: APPEAL_MESSAGE_MAX })}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-md px-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          >
            {gt("Cancel")}
          </button>
          <button
            type="submit"
            disabled={tooShort || sending}
            className="flex h-9 items-center gap-1.5 rounded-md bg-[var(--app-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending && <Loader size={14} />}
            {gt("Submit appeal")}
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">{gt("You can appeal each action once.")}</p>
    </form>
  );
}

function AppealArea({
  variant,
  appeal,
  canAppeal,
  targetType,
  targetId,
  onChanged,
  buttonLabel,
}: {
  variant: Variant;
  appeal: AppealRef | null;
  canAppeal: boolean;
  targetType: "strike" | "restriction" | "ban";
  targetId?: string;
  onChanged?: () => void;
  buttonLabel?: string;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  // Shown until the refetched standing carries the new appeal.
  const [submitted, setSubmitted] = useState(false);
  if (appeal) return <AppealStatus appeal={appeal} variant={variant} />;
  if (submitted) return <AppealStatus appeal={{ id: "", status: "open", staffNote: null }} variant={variant} />;
  if (variant !== "self" || !canAppeal) return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 h-8 rounded-md border border-[var(--border-subtle)] px-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
      >
        {buttonLabel || gt("Appeal")}
      </button>
    );
  }
  return (
    <AppealForm
      targetType={targetType}
      targetId={targetId}
      onCancel={() => setOpen(false)}
      onSubmitted={() => {
        setOpen(false);
        setSubmitted(true);
        onChanged?.();
      }}
    />
  );
}

// ─── Strikes / restrictions / suspension ─────────────────────────────────────

function SourcePill({ source }: { source: string }) {
  const gt = useGT();
  const automatic = source === "automatic";
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">
      {automatic ? <Bot className="h-3 w-3" aria-hidden /> : <UserCog className="h-3 w-3" aria-hidden />}
      {automatic ? gt("Automatic") : gt("Staff")}
    </span>
  );
}

function StrikeCard({
  strike,
  variant,
  onChanged,
  actions,
}: {
  strike: StandingStrike;
  variant: Variant;
  onChanged?: () => void;
  actions?: ReactNode;
}) {
  const gt = useGT();
  const expired = !strike.active && !strike.revoked;
  const dimmed = !strike.active;
  return (
    <li className={cn(cardClass, "p-4", dimmed && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            dimmed ? "bg-[var(--bg-app)] text-[var(--text-muted)]" : "bg-red-500/10 text-red-500"
          )}
        >
          <Gavel className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className={cn("text-sm font-semibold", strike.revoked ? "text-[var(--text-muted)] line-through" : "text-[var(--text-primary)]")}>
              {categoryLabel(strike.category, gt)}
            </h4>
            <SourcePill source={strike.source} />
            {strike.revoked && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-500">{gt("Removed")}</span>
            )}
            {expired && (
              <span className="rounded-full bg-[var(--bg-app)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)]">{gt("Expired")}</span>
            )}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{plain(strike.reason)}</p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {formatDate(strike.createdAt)}
            {" · "}
            {strike.revoked
              ? gt("No longer counts")
              : strike.expiresAt
                ? (strike.active
                  ? gt("Expires {date}", { date: formatDate(strike.expiresAt) })
                  : gt("Expired {date}", { date: formatDate(strike.expiresAt) }))
                : gt("Doesn't expire")}
          </p>
          <AppealArea
            variant={variant}
            appeal={strike.appeal}
            canAppeal={strike.active && !strike.revoked}
            targetType="strike"
            targetId={strike.id}
            onChanged={onChanged}
          />
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </li>
  );
}

function RestrictionCard({
  restriction,
  appeal,
  variant,
  onChanged,
  actions,
}: {
  restriction: StandingRestriction;
  appeal: AppealRef | null;
  variant: Variant;
  onChanged?: () => void;
  actions?: ReactNode;
}) {
  const gt = useGT();
  const now = useClock();
  const remaining = new Date(restriction.until).getTime() - now;
  const live = restriction.active && remaining > 0;
  const title = restriction.type === "chat" ? gt("Can't send messages") : gt("Restriction");
  return (
    <li className={cn(cardClass, "p-4", live ? "border-amber-500/40" : "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            live ? "bg-amber-500/10 text-amber-500" : "bg-[var(--bg-app)] text-[var(--text-muted)]"
          )}
        >
          <MessageSquareOff className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
          {live ? (
            <p className="mt-0.5 text-sm font-medium text-amber-500" aria-live="polite">
              {variant === "self"
                ? gt("You can chat again in {time}", { time: formatRemaining(remaining) })
                : gt("Ends in {time}", { time: formatRemaining(remaining) })}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {restriction.active ? gt("This restriction has ended") : gt("Ended or lifted")}
            </p>
          )}
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--text-secondary)]">{plain(restriction.reason)}</p>
          <p className="mt-1.5 text-xs text-[var(--text-muted)]">
            {gt("Started {date}", { date: formatDate(restriction.createdAt) })}
            {live ? ` · ${gt("Until {date}", { date: new Date(restriction.until).toLocaleString() })}` : ""}
          </p>
          <AppealArea
            variant={variant}
            appeal={appeal}
            canAppeal={live}
            targetType="restriction"
            targetId={restriction.id}
            onChanged={onChanged}
          />
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </li>
  );
}

function SuspensionCard({ standing, variant, onChanged, actions }: { standing: StandingData; variant: Variant; onChanged?: () => void; actions?: ReactNode }) {
  const gt = useGT();
  const headingId = useId();
  return (
    <section className="rounded-xl border-2 border-red-500/50 bg-red-500/10 p-4 sm:p-5" aria-labelledby={headingId}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
          <Ban className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-base font-bold text-[var(--text-primary)]">
            {variant === "self" ? gt("Your account is suspended") : gt("Account suspended")}
          </h3>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{gt("Reason")}</p>
          <p className="whitespace-pre-wrap break-words text-sm text-[var(--text-primary)]">
            {standing.banReason ? plain(standing.banReason) : gt("No reason was given.")}
          </p>
          {variant === "self" && !standing.banAppeal && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {gt("If you think this was a mistake, tell us. A member of the Trust & Safety team will review your appeal.")}
            </p>
          )}
          <AppealArea
            variant={variant}
            appeal={standing.banAppeal}
            canAppeal={standing.banned}
            targetType="ban"
            onChanged={onChanged}
            buttonLabel={gt("Appeal suspension")}
          />
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </section>
  );
}

function GoodStandingEmpty({ variant }: { variant: Variant }) {
  const gt = useGT();
  return (
    <div className={cn(cardClass, "flex flex-col items-center px-6 py-8 text-center")}>
      <div className="relative mb-4">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10">
          <ShieldCheck className="h-10 w-10 text-emerald-500" aria-hidden />
        </span>
        <Sparkles className="absolute -right-2 -top-1 h-6 w-6 text-[var(--app-accent)]" aria-hidden />
        <Check className="absolute -bottom-1 -left-1 h-6 w-6 rounded-full bg-emerald-500 p-1 text-white" aria-hidden />
      </div>
      <h3 className="text-base font-semibold text-[var(--text-primary)]">
        {variant === "self" ? gt("Your account is in good standing") : gt("No violations on record")}
      </h3>
      {variant === "self" && (
        <p className="mt-1 max-w-sm text-sm text-[var(--text-secondary)]">
          {gt("No strikes, no restrictions. Keep being awesome — and thanks for helping keep SerikaCord a good place to hang out.")}
        </p>
      )}
    </div>
  );
}

// ─── Composed view ────────────────────────────────────────────────────────────

export interface StandingDisplayProps {
  user: SafetyUserCard | null;
  standing: StandingData;
  variant: Variant;
  /** Refetch after an appeal (self) or a staff action. */
  onChanged?: () => void;
  /** Staff: per-row action buttons (revoke strike, lift restriction). */
  strikeActions?: (strike: StandingStrike) => ReactNode;
  restrictionActions?: (restriction: StandingRestriction) => ReactNode;
}

export function StandingDisplay({ user, standing, variant, onChanged, strikeActions, restrictionActions }: StandingDisplayProps) {
  const gt = useGT();
  const now = useClock();
  const liveRestrictions = standing.restrictions.filter((r) => r.active && new Date(r.until).getTime() > now);
  const pastRestrictions = standing.restrictions.filter((r) => !liveRestrictions.includes(r));
  const activeStrikes = standing.strikes.filter((s) => s.active);
  const pastStrikes = standing.strikes.filter((s) => !s.active);
  const clean = !standing.banned && standing.strikes.length === 0 && standing.restrictions.length === 0;
  const ids = useId();

  return (
    <div className="space-y-5">
      {standing.banned && <SuspensionCard standing={standing} variant={variant} onChanged={onChanged} />}
      <StandingHero user={user} standing={standing} variant={variant} />

      {clean && <GoodStandingEmpty variant={variant} />}

      {liveRestrictions.length > 0 && (
        <section aria-labelledby={`${ids}-standing-restrictions`}>
          <h3 id={`${ids}-standing-restrictions`} className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {gt("Active restrictions")}
          </h3>
          <ul className="space-y-2">
            {liveRestrictions.map((r) => (
              <RestrictionCard
                key={r.id}
                restriction={r}
                appeal={appealFor(standing, "restriction", r.id)}
                variant={variant}
                onChanged={onChanged}
                actions={restrictionActions?.(r)}
              />
            ))}
          </ul>
        </section>
      )}

      {standing.strikes.length > 0 && (
        <section aria-labelledby={`${ids}-standing-strikes`}>
          <h3 id={`${ids}-standing-strikes`} className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {gt("Violations")}
          </h3>
          {variant === "self" && (
            <p className="mb-2 text-xs text-[var(--text-muted)]">
              {gt("Strikes stop counting once they expire or are removed. If you think one is a mistake, you can appeal it.")}
            </p>
          )}
          <ul className="space-y-2">
            {[...activeStrikes, ...pastStrikes].map((s) => (
              <StrikeCard key={s.id} strike={s} variant={variant} onChanged={onChanged} actions={strikeActions?.(s)} />
            ))}
          </ul>
        </section>
      )}

      {pastRestrictions.length > 0 && (
        <section aria-labelledby={`${ids}-standing-past-restrictions`}>
          <h3 id={`${ids}-standing-past-restrictions`} className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
            {gt("Past restrictions")}
          </h3>
          <ul className="space-y-2">
            {pastRestrictions.map((r) => (
              <RestrictionCard
                key={r.id}
                restriction={r}
                appeal={appealFor(standing, "restriction", r.id)}
                variant={variant}
                onChanged={onChanged}
                actions={restrictionActions?.(r)}
              />
            ))}
          </ul>
        </section>
      )}

      {variant === "self" && (
        <p className="text-xs leading-relaxed text-[var(--text-muted)]">
          {gt("Account standing reflects actions taken by SerikaCord's Trust & Safety team and automated systems. Server moderators' bans and timeouts are separate and don't appear here.")}
        </p>
      )}
    </div>
  );
}

// ─── The signed-in user's screen ─────────────────────────────────────────────

interface MyStandingResponse extends StandingData {
  user: SafetyUserCard;
}

export function AccountStanding({
  className,
  showTitle = false,
  banner,
}: {
  className?: string;
  showTitle?: boolean;
  /** Extra content above the standing, from the loaded data (e.g. "account restored"). */
  banner?: (standing: StandingData) => ReactNode;
}) {
  const gt = useGT();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, error } = useJsonQuery<MyStandingResponse>("/api/users/@me/standing", reloadKey);

  return (
    <div className={cn("text-[var(--text-primary)]", className)}>
      {showTitle && <h2 className="mb-5 text-xl font-bold text-[var(--text-primary)]">{gt("Account Standing")}</h2>}
      {data ? (
        <>
          {banner?.(data)}
          <StandingDisplay user={data.user} standing={data} variant="self" onChanged={() => setReloadKey((k) => k + 1)} />
        </>
      ) : error ? (
        <div className={cn(cardClass, "flex flex-col items-center gap-3 px-6 py-8 text-center")}>
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
          <p className="text-sm text-[var(--text-secondary)]">{gt("We couldn't load your account standing.")}</p>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="h-9 rounded-md bg-[var(--app-accent)] px-4 text-sm font-semibold text-[var(--text-on-accent)] hover:bg-[var(--accent-hover)]"
          >
            {gt("Try again")}
          </button>
        </div>
      ) : (
        <div className="flex justify-center py-12" aria-busy="true">
          <Loader size={32} />
        </div>
      )}
    </div>
  );
}

export default AccountStanding;
