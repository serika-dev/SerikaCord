"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PIN_LENGTH } from "@/lib/e2ee/pin";

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all six digits are in (auto-submit). */
  onComplete?: (value: string) => void;
  /** Accessible name of the group ("Enter your PIN", …). */
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  /** "new": creating a PIN (no autofill); "current": entering an existing one. */
  purpose?: "new" | "current";
}

const onlyDigits = (s: string) => s.replace(/[^0-9]/g, "");

/**
 * Six PIN boxes backed by ONE real input stretched over them. Typing,
 * backspace, paste, keyboard autofill and IME quirks are all handled by the
 * browser on a single field, so there is no focus juggling between boxes (which
 * raced React re-renders and kept bouncing the cursor back). The boxes only
 * draw dots and highlight where the next digit goes; the sixth digit submits.
 */
export function PinInput({ value, onChange, onComplete, label, disabled = false, invalid = false, autoFocus = false, purpose = "current" }: PinInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);
  const digits = onlyDigits(value).slice(0, PIN_LENGTH);
  const active = Math.min(digits.length, PIN_LENGTH - 1);

  const update = (raw: string) => {
    const clean = onlyDigits(raw).slice(0, PIN_LENGTH);
    if (clean === digits) return;
    onChange(clean);
    if (clean.length === PIN_LENGTH) {
      inputRef.current?.blur();
      onComplete?.(clean);
    }
  };

  // Keep the caret at the end: digits are always entered left to right.
  const pinCaret = () => {
    const el = inputRef.current;
    if (!el) return;
    const end = el.value.length;
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end);
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("relative mx-auto flex w-fit justify-center gap-2 sm:gap-3", disabled && "opacity-60")}
      onMouseDown={(e) => {
        // Clicking any box focuses the one real input.
        if (e.target !== inputRef.current) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={PIN_LENGTH}
        autoComplete={purpose === "current" ? "one-time-code" : "off"}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        aria-label={label}
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        disabled={disabled}
        value={digits}
        onChange={(e) => update(e.target.value)}
        onPaste={(e) => {
          const pasted = onlyDigits(e.clipboardData.getData("text"));
          if (!pasted) return;
          e.preventDefault();
          // A whole PIN replaces everything; a part is appended.
          update(pasted.length >= PIN_LENGTH ? pasted : digits + pasted);
        }}
        onFocus={() => {
          setFocused(true);
          requestAnimationFrame(pinCaret);
        }}
        onBlur={() => setFocused(false)}
        onSelect={pinCaret}
        onKeyDown={(e) => {
          // Arrow keys / Home would move the caret into the middle; keep it at the end.
          if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") e.preventDefault();
        }}
        // Covers all boxes so taps land on it; invisible (the boxes draw the state).
        className="absolute inset-0 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none [font-size:16px] disabled:cursor-not-allowed"
      />
      {Array.from({ length: PIN_LENGTH }, (_, i) => {
        const filled = i < digits.length;
        const isActive = focused && !disabled && i === active && digits.length < PIN_LENGTH;
        return (
          <div
            key={i}
            aria-hidden
            className={cn(
              "pointer-events-none flex h-12 w-10 items-center justify-center rounded-lg border bg-[var(--app-surface-alt)] transition-[border-color,box-shadow,transform] duration-150 motion-reduce:transition-none sm:h-14 sm:w-12",
              invalid
                ? "border-destructive"
                : isActive
                  ? "border-[var(--app-accent)] ring-2 ring-[var(--app-accent)]/30"
                  : filled
                    ? "border-[var(--app-accent)]/50"
                    : "border-[var(--app-border)]",
            )}
          >
            {filled ? (
              <span className="h-3 w-3 rounded-full bg-[var(--app-text)] animate-in zoom-in-50 fade-in-0 duration-150 motion-reduce:animate-none" />
            ) : isActive ? (
              <span className="h-6 w-0.5 rounded-full bg-[var(--app-accent)] animate-pulse motion-reduce:animate-none" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default PinInput;
