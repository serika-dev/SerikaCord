"use client";

/**
 * Small pieces shared by the join flow, the Server Guide, the join preview and
 * the invite page: server icon tile, banner (or accent gradient), online /
 * member counts, the "Est." date, the owner's linked connections, the rules
 * list and the Apply to Join / rules screening question fields.
 */

import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useGT, useLocale } from "gt-next";
import { BadgeCheck, Hash, Megaphone, MessageSquare, Mic, Volume2 } from "lucide-react";
import { ConnectionIcon, getConnectionHref } from "@/components/user/ConnectionIcon";
import type { ApplicationQuestionView, ServerConnectionView } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import { useAnimatedMedia } from "@/hooks/useAnimatedMedia";
import { parseCommunityEmoji, type CommunityEmojiView } from "@/lib/servers/communityEmoji";
import { cdnImage, cdnImageFallback, cn } from "@/lib/utils";

/** Mirrors APPLICATION_SHORT_MAX / APPLICATION_PARAGRAPH_MAX in src/lib/servers/community.ts. */
export const APPLICATION_SHORT_MAX = 150;
export const APPLICATION_PARAGRAPH_MAX = 1000;

/** Accent gradient used where a server has no banner. */
export const ACCENT_GRADIENT: CSSProperties = {
  background:
    "linear-gradient(135deg, var(--app-accent) 0%, color-mix(in srgb, var(--app-accent) 55%, var(--bg-app)) 60%, color-mix(in srgb, var(--app-accent) 25%, var(--bg-app)) 100%)",
};

export function serverInitials(name: string): string {
  const words = decodeHtmlEntities(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function ServerIconTile({
  name,
  icon,
  className,
  textClassName,
}: {
  name: string;
  icon: string | null | undefined;
  className?: string;
  textClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center font-semibold text-[var(--text-primary)] shrink-0 select-none",
        className,
      )}
    >
      {icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cdnImage(icon)} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : (
        <span className={textClassName} aria-hidden>{serverInitials(name)}</span>
      )}
    </div>
  );
}

/** The server banner, or an accent gradient when it has none. */
export function ServerBannerArt({ banner, className, children }: { banner: string | null | undefined; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={banner ? undefined : ACCENT_GRADIENT}>
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cdnImage(banner)} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
      )}
      {children}
    </div>
  );
}

/** "Est. Mar 2024" from the server's creation date (null when unknown). */
export function useEstablishedLabel(createdAt: string | null | undefined): string | null {
  const gt = useGT();
  const locale = useLocale();
  if (!createdAt) return null;
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return null;
  let date: string;
  try {
    date = new Intl.DateTimeFormat(locale || undefined, { month: "short", year: "numeric" }).format(new Date(time));
  } catch {
    date = new Date(time).getFullYear().toString();
  }
  return gt("Est. {date}", { date });
}

/** ● 12 Online  ● 340 Members */
export function ServerStats({ online, members, className }: { online?: number | null; members?: number | null; className?: string }) {
  const gt = useGT();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--text-secondary)]", className)}>
      {typeof online === "number" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" aria-hidden />
          {gt("{count} Online", { count: online.toLocaleString() })}
        </span>
      )}
      {typeof members === "number" && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--text-muted)]" aria-hidden />
          {members === 1 ? gt("1 Member") : gt("{count} Members", { count: members.toLocaleString() })}
        </span>
      )}
    </div>
  );
}

function connectionLabel(c: ServerConnectionView): string {
  return decodeHtmlEntities(c.displayName || c.username || c.accountId || c.provider);
}

/**
 * The accounts a server shows (its own domains / accounts and the owner's
 * linked ones), with verified checks. Websites show their real favicon.
 */
export function ServerConnectionsList({
  connections,
  variant = "list",
  className,
}: {
  connections: ServerConnectionView[];
  /** "list": one row each (profile card); "chips": compact wrapping pills (invite card). */
  variant?: "list" | "chips";
  className?: string;
}) {
  const gt = useGT();
  if (connections.length === 0) return null;
  return (
    <ul className={cn(variant === "chips" ? "flex flex-wrap gap-1.5" : "space-y-1", className)}>
      {connections.map((c) => {
        const href = getConnectionHref(c.provider, c.accountId);
        const label = connectionLabel(c);
        const body = (
          <>
            <ConnectionIcon provider={c.provider} accountId={c.accountId} size={variant === "chips" ? 14 : 16} className="shrink-0" />
            <span className="min-w-0 truncate">{label}</span>
            {c.verified && (
              <BadgeCheck className="w-3.5 h-3.5 shrink-0 text-[var(--app-accent)]" aria-label={gt("Verified")} />
            )}
          </>
        );
        const cls = cn(
          "flex items-center gap-2 min-w-0 text-[var(--text-primary)] transition-colors",
          variant === "chips"
            ? "h-7 px-2.5 rounded-full bg-[var(--app-surface-alt)] border border-[var(--border-subtle)] text-xs max-w-[220px]"
            : "h-9 px-2 rounded-md text-sm",
          href !== "#" && (variant === "chips" ? "hover:bg-[var(--bg-hover)]" : "hover:bg-[var(--bg-hover)]"),
        );
        return (
          <li key={`${c.source ?? "owner"}:${c.id}`} className="min-w-0">
            {href !== "#" ? (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cls} title={label}>
                {body}
              </a>
            ) : (
              <span className={cls} title={label}>{body}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A community emoji (CORD-71): a unicode emoji as text, or one of the server's
 * custom emojis (`<:name:id>` / `<a:name:id>`) as its image, sized to the
 * surrounding font so it fills the tile like a unicode one. `emojis` is the
 * resolved image list (`customEmojis` from GET /onboarding, or the server's
 * emoji list in the editors). Empty, unknown or broken values show `fallback`.
 */
export function EmojiOrIcon({
  emoji,
  fallback,
  className,
  emojis,
}: {
  emoji: string | null | undefined;
  fallback: ReactNode;
  className?: string;
  emojis?: readonly CommunityEmojiView[] | null;
}) {
  const parsed = parseCommunityEmoji(emoji);
  if (!parsed) return <>{fallback}</>;
  if (parsed.kind === "unicode") {
    return <span className={cn("leading-none", className)} aria-hidden>{parsed.value}</span>;
  }
  const view = emojis?.find((e) => e.id === parsed.id);
  if (!view) return <>{fallback}</>;
  return <CommunityEmojiImage key={view.url} view={view} fallback={fallback} className={className} />;
}

function CommunityEmojiImage({ view, fallback, className }: { view: CommunityEmojiView; fallback: ReactNode; className?: string }) {
  const animate = useAnimatedMedia();
  // 0: converted image, 1: original (format conversion failed), 2: give up and show the icon.
  const [attempt, setAttempt] = useState(0);
  const primary = cdnImage(view.url, { still: view.animated && !animate });
  const retry = cdnImageFallback(primary);
  if (attempt >= 2) return <>{fallback}</>;
  const label = `:${decodeHtmlEntities(view.name)}:`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={attempt === 1 && retry ? retry : primary}
      alt={label}
      title={label}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setAttempt((a) => (a === 0 && retry ? 1 : 2))}
      className={cn("h-[1.25em] w-[1.25em] object-contain shrink-0", className)}
    />
  );
}

/** Arrow keys / Home / End move between the option cards of a question
 * (each card carries `data-option`). */
export function onOptionKeyDown(e: KeyboardEvent<HTMLDivElement>) {
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

/** The sidebar icon of a channel type (text, voice, stage, announcement, forum). */
export function ChannelGlyph({ type, className }: { type?: string; className?: string }) {
  const cls = cn("w-4 h-4 shrink-0", className);
  if (type === "voice") return <Volume2 className={cls} />;
  if (type === "stage") return <Mic className={cls} />;
  if (type === "announcement") return <Megaphone className={cls} />;
  if (type === "forum") return <MessageSquare className={cls} />;
  return <Hash className={cls} />;
}

/** Numbered server rules. */
export function RulesList({ rules, className }: { rules: string[]; className?: string }) {
  return (
    <ol className={cn("space-y-3", className)}>
      {rules.map((rule, i) => (
        <li key={i} className="flex gap-3 text-sm text-[var(--text-primary)]">
          <span
            className="w-6 h-6 shrink-0 rounded-full bg-[var(--app-surface-alt)] text-[var(--text-secondary)] text-xs font-semibold tabular-nums flex items-center justify-center"
            aria-hidden
          >
            {i + 1}
          </span>
          <span className="pt-0.5 whitespace-pre-wrap break-words min-w-0">{decodeHtmlEntities(rule)}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The application questions a server asks (Apply to Join and rules
 * screening with manual approval): short input, paragraph, or choice pills.
 */
export function ApplicationQuestionFields({
  questions,
  answers,
  onChange,
  errors,
  idPrefix,
  disabled,
}: {
  questions: ApplicationQuestionView[];
  answers: Record<string, string>;
  onChange: (questionId: string, value: string) => void;
  /** questionId → message. */
  errors?: Record<string, string>;
  idPrefix: string;
  disabled?: boolean;
}) {
  const gt = useGT();
  return (
    <div className="space-y-4">
      {questions.map((q) => {
        const id = `${idPrefix}-${q.id}`;
        const value = answers[q.id] ?? "";
        const error = errors?.[q.id];
        const label = decodeHtmlEntities(q.label);
        const fieldCls = cn(
          "w-full rounded-lg bg-[var(--bg-input)] border px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40",
          error ? "border-red-500" : "border-[var(--border-subtle)] focus:border-[var(--app-accent)]",
        );
        return (
          <div key={q.id} data-question-id={q.id}>
            {q.type === "choice" ? (
              <fieldset aria-describedby={error ? `${id}-error` : undefined}>
                <legend className="mb-2 text-sm font-semibold text-[var(--text-primary)]">
                  {label}
                  {q.required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
                </legend>
                <div role="radiogroup" aria-label={label} aria-required={q.required} className="flex flex-wrap gap-2">
                  {q.choices.map((choice, i) => {
                    const checked = value === choice;
                    return (
                      <label
                        key={`${choice}-${i}`}
                        className={cn(
                          "relative inline-flex items-center min-h-9 px-3.5 py-1.5 rounded-full border text-sm cursor-pointer select-none transition-colors",
                          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--app-accent)]/50",
                          checked
                            ? "border-[var(--app-accent)] bg-[var(--app-accent)]/15 text-[var(--text-primary)] font-medium"
                            : "border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]",
                          disabled && "opacity-60 cursor-not-allowed",
                        )}
                      >
                        <input
                          type="radio"
                          name={id}
                          value={choice}
                          checked={checked}
                          disabled={disabled}
                          onChange={() => onChange(q.id, choice)}
                          className="sr-only"
                        />
                        {decodeHtmlEntities(choice)}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : (
              <>
                <label htmlFor={id} className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
                  {label}
                  {q.required && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
                </label>
                {q.type === "paragraph" ? (
                  <textarea
                    id={id}
                    value={value}
                    rows={4}
                    maxLength={APPLICATION_PARAGRAPH_MAX}
                    disabled={disabled}
                    required={q.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => onChange(q.id, e.target.value)}
                    placeholder={gt("Your answer")}
                    className={cn(fieldCls, "py-2.5 resize-y min-h-[96px]")}
                  />
                ) : (
                  <input
                    id={id}
                    type="text"
                    value={value}
                    maxLength={APPLICATION_SHORT_MAX}
                    disabled={disabled}
                    required={q.required}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : undefined}
                    onChange={(e) => onChange(q.id, e.target.value)}
                    placeholder={gt("Your answer")}
                    className={cn(fieldCls, "h-10")}
                  />
                )}
              </>
            )}
            {error && (
              <p id={`${id}-error`} role="alert" className="mt-1.5 text-xs text-red-500">{error}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** First required question left empty, or null. */
export function firstMissingAnswer(questions: ApplicationQuestionView[], answers: Record<string, string>): string | null {
  for (const q of questions) {
    if (q.required && !(answers[q.id] ?? "").trim()) return q.id;
  }
  return null;
}

/** Focuses (and scrolls to) a question's field inside `root`. */
export function focusQuestion(root: HTMLElement | null, questionId: string) {
  if (!root) return;
  const wrap = root.querySelector<HTMLElement>(`[data-question-id="${CSS.escape(questionId)}"]`);
  if (!wrap) return;
  wrap.scrollIntoView({ block: "center", behavior: "smooth" });
  wrap.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
}
