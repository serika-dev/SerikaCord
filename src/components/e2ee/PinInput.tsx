"use client";

import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
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
 * Six one-digit boxes: numeric keypad on phones, auto-advance, backspace goes
 * back, arrow keys move, paste / autofill of the whole PIN fills every box,
 * and the sixth digit submits. Digits are drawn as dots (never echoed), and
 * the fields are plain text inputs so password managers leave them alone.
 */
export function PinInput({ value, onChange, onComplete, label, disabled = false, invalid = false, autoFocus = false, purpose = "current" }: PinInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.slice(0, PIN_LENGTH);

  const focusBox = (i: number) => {
    const el = refs.current[Math.max(0, Math.min(PIN_LENGTH - 1, i))];
    if (el) {
      el.focus();
      el.select();
    }
  };

  const commit = (next: string, focusAt: number) => {
    const clean = onlyDigits(next).slice(0, PIN_LENGTH);
    onChange(clean);
    if (clean.length === PIN_LENGTH) {
      refs.current[PIN_LENGTH - 1]?.blur();
      onComplete?.(clean);
    } else {
      focusBox(focusAt);
    }
  };

  /** Typing (or the keyboard's autofill) into box `i`: the box is selected on focus, so the value is just the new input. */
  const handleInput = (i: number, raw: string) => {
    const typed = onlyDigits(raw);
    if (!typed) {
      // A deletion the keyboard didn't report as a Backspace key (Android IMEs).
      if (raw === "" && digits[i]) onChange(digits.slice(0, i) + digits.slice(i + 1));
      return;
    }
    // Several digits at once (autofill / paste into one box): fill from here on.
    const before = digits.slice(0, i);
    if (before.length < i) {
      // Boxes before this one are empty: start at the first empty box instead.
      commit(digits + typed, digits.length + typed.length);
      return;
    }
    const next = (before + typed + digits.slice(i + typed.length)).slice(0, PIN_LENGTH);
    commit(next, i + typed.length);
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      if (digits[i]) {
        onChange(digits.slice(0, i) + digits.slice(i + 1));
        focusBox(i);
      } else if (i > 0) {
        onChange(digits.slice(0, i - 1) + digits.slice(i));
        focusBox(i - 1);
      }
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusBox(i - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusBox(Math.min(i + 1, digits.length));
    }
  };

  const handlePaste = (i: number, e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = onlyDigits(e.clipboardData.getData("text"));
    if (!pasted) return;
    e.preventDefault();
    // A whole PIN replaces everything; a part continues from this box.
    if (pasted.length >= PIN_LENGTH) commit(pasted, PIN_LENGTH - 1);
    else handleInput(i, pasted);
  };

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2 sm:gap-3">
      {Array.from({ length: PIN_LENGTH }, (_, i) => {
        const filled = Boolean(digits[i]);
        return (
          <div key={i} className="relative">
            <input
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={purpose === "current" && i === 0 ? "one-time-code" : "off"}
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              aria-label={`${label} ${i + 1}/${PIN_LENGTH}`}
              aria-invalid={invalid || undefined}
                  autoFocus={autoFocus && i === 0}
              disabled={disabled}
              value={digits[i] ?? ""}
              onChange={(e) => handleInput(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={(e) => handlePaste(i, e)}
              onFocus={(e) => {
                // Never type past the first empty box.
                if (i > digits.length) {
                  focusBox(digits.length);
                  return;
                }
                e.target.select();
              }}
              className={cn(
                "h-12 w-10 sm:h-14 sm:w-12 rounded-lg border bg-[var(--app-surface-alt)] text-center text-xl font-semibold text-transparent caret-[var(--app-accent)] outline-none transition-colors",
                "focus:border-[var(--app-accent)] focus:ring-2 focus:ring-[var(--app-accent)]/30 disabled:opacity-60",
                invalid ? "border-red-500" : "border-[var(--app-border)]",
              )}
            />
            {filled && (
              <span aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-[var(--app-text)]" />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default PinInput;
