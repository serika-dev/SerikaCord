"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useGT } from "gt-next";
import { Hash, Music, Paperclip, Plus, Shield, Volume2, X } from "lucide-react";
import { cdnImage, cn } from "@/lib/utils";
import { Loader } from "@/components/ui/Loader";
import { useTouchOnlyInput } from "@/hooks/useVisualViewport";
import { fetchAutocompleteValues } from "@/lib/chat/appCommandInvoke";
import {
  addOptionToDraft,
  commandReadiness,
  decideCommandEnter,
  hiddenOptionalOptions,
  labelForValue,
  optionValueError,
  pickerEntries,
  removeOptionFromDraft,
  resolvedValues,
  setDraftValue,
  shownOptions,
  type CommandDraft,
  type CommandDropdown,
  type CommandOptionSpec,
  type CommandPickerData,
  type CommandSpec,
} from "@/lib/chat/commandComposer";
import { CommandIcon } from "@/components/chat/commands/CommandPalette";
import { optionErrorText, optionKindLabel, optionPlaceholder } from "@/components/chat/commands/commandLabels";

const TRAILING = "__trailing__";
const CHIP = "__chip__";

interface Item {
  key: string;
  value: string;
  label: string;
  sub?: string;
  emoji?: string;
  avatar?: string | null;
  color?: string;
  type: "choice" | "user" | "role" | "channel" | "option";
  option?: CommandOptionSpec;
}

export type CommandExitReason = "backspace" | "clear";

export interface CommandComposerProps {
  spec: CommandSpec;
  draft: CommandDraft;
  files: Record<string, File>;
  pickers: CommandPickerData;
  channelId?: string;
  sending: boolean;
  /** Mark missing / invalid options (after a send attempt). */
  showErrors: boolean;
  /** Restored with ↑: ↑/↓ keep walking the history until the user edits. */
  browsingHistory: boolean;
  /** Focus an option (`null` = the end of the command) when `nonce` changes. */
  focusRequest: { name: string | null; nonce: number } | null;
  /** Where the value lists render (above the composer, outside its clipping box). */
  overlayHost: HTMLElement | null;
  onChange: (draft: CommandDraft) => void;
  onFilesChange: (files: Record<string, File>) => void;
  /** Send (MessageBar checks readiness again and points at what's missing). */
  onSubmitRequest: (draft?: CommandDraft) => void;
  onExit: (reason: CommandExitReason) => void;
  onHistoryStep: (dir: "up" | "down") => void;
}

const isPickerKind = (o: CommandOptionSpec) => o.kind === "user" || o.kind === "role" || o.kind === "channel" || o.kind === "mentionable";

/**
 * Discord-style command entry: the command as a token, then one chip per
 * option with a type-aware field (member / role / channel pickers, choices,
 * app autocomplete, numbers, a true/false toggle, a file drop zone).
 * Required options are always there; optional ones are added on demand
 * ("+N optional", Tab, or typing their name at the end) and never block Enter.
 * All state is local to the composer, so typing here never re-renders the
 * message list.
 */
export function CommandComposer({
  spec,
  draft,
  files,
  pickers,
  channelId,
  sending,
  showErrors,
  browsingHistory,
  focusRequest,
  overlayHost,
  onChange,
  onFilesChange,
  onSubmitRequest,
  onExit,
  onHistoryStep,
}: CommandComposerProps) {
  const gt = useGT();
  const touchOnly = useTouchOnlyInput();
  const shown = shownOptions(spec, draft);
  const hidden = hiddenOptionalOptions(spec, draft);
  const readiness = commandReadiness(spec, draft, files);

  const [focused, setFocused] = useState<string | null>(null);
  const [dd, setDd] = useState<{ open: boolean; highlight: number; interacted: boolean; query: string }>({
    open: false,
    highlight: 0,
    interacted: false,
    query: "",
  });
  const [trailing, setTrailing] = useState("");
  const [ac, setAc] = useState<{ name: string; items: Array<{ name: string; value: string | number }>; loading: boolean } | null>(null);
  const [localFocus, setLocalFocus] = useState<{ name: string; nonce: number } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLElement>());
  const rootRef = useRef<HTMLDivElement>(null);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acReq = useRef(0);
  const fileInputs = useRef(new Map<string, HTMLInputElement>());

  const setRef = (name: string) => (el: HTMLElement | null) => {
    if (el) refs.current.set(name, el);
    else refs.current.delete(name);
  };

  // Focus requests from MessageBar (enter command mode, point at a missing option).
  useEffect(() => {
    if (!focusRequest) return;
    const el = refs.current.get(focusRequest.name ?? TRAILING) ?? refs.current.get(TRAILING);
    el?.focus();
  }, [focusRequest]);
  // Local moves (Tab, after picking a value, after adding an option).
  useEffect(() => {
    if (!localFocus) return;
    (refs.current.get(localFocus.name) ?? refs.current.get(TRAILING))?.focus();
  }, [localFocus]);
  useEffect(() => () => {
    if (acTimer.current) clearTimeout(acTimer.current);
  }, []);

  const focusField = (name: string) => setLocalFocus((prev) => ({ name, nonce: (prev?.nonce ?? 0) + 1 }));
  const fieldOrder = [...shown.map((o) => o.name), TRAILING];
  const prevField = (name: string) => {
    const i = fieldOrder.indexOf(name);
    return i > 0 ? fieldOrder[i - 1] : null;
  };
  const nextField = (name: string) => {
    const i = fieldOrder.indexOf(name);
    return i >= 0 && i < fieldOrder.length - 1 ? fieldOrder[i + 1] : TRAILING;
  };

  const optionByName = (name: string | null) => (name ? spec.options.find((o) => o.name === name) ?? null : null);
  const displayValue = (opt: CommandOptionSpec): string => {
    const v = draft.values[opt.name] ?? "";
    const label = draft.labels[opt.name];
    if (label) return label;
    if (isPickerKind(opt)) return labelForValue(opt.kind, v, pickers) ?? v;
    const choice = opt.choices?.find((c) => c.value === v);
    return choice ? choice.name : v;
  };
  const hasLabel = (opt: CommandOptionSpec) => {
    const v = draft.values[opt.name] ?? "";
    return !!v && displayValue(opt) !== v;
  };

  const itemsFor = (name: string | null, query: string): Item[] => {
    if (name === TRAILING) {
      const q = query.trim().toLowerCase();
      return hidden
        .filter((o) => !q || o.name.toLowerCase().includes(q))
        .map((o) => ({ key: o.name, value: o.name, label: o.name, sub: o.description, type: "option" as const, option: o }));
    }
    const opt = optionByName(name);
    if (!opt) return [];
    const q = query.trim().toLowerCase();
    if (opt.choices?.length) {
      return opt.choices
        .filter((c) => !q || c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q))
        .map((c) => ({ key: c.value, value: c.value, label: c.name, sub: c.description, emoji: c.emoji, type: "choice" as const }));
    }
    if (isPickerKind(opt)) {
      return pickerEntries(opt.kind, pickers, query).map((e) => ({ key: e.value, value: e.value, label: e.label, sub: e.sub, avatar: e.avatar, color: e.color, type: e.type }));
    }
    if (opt.autocomplete && ac?.name === opt.name) {
      return ac.items.map((c) => ({ key: String(c.value), value: String(c.value), label: c.name, type: "choice" as const }));
    }
    return [];
  };

  const focusedOpt = focused && focused !== TRAILING && focused !== CHIP ? optionByName(focused) : null;
  const items = focused ? itemsFor(focused, dd.query) : [];
  const ddKind: CommandDropdown = !dd.open || items.length === 0 ? "none" : focused === TRAILING ? "optional" : "values";
  const hl = Math.max(0, Math.min(dd.highlight, items.length - 1));
  const currentValue = focusedOpt ? (draft.values[focusedOpt.name] ?? "").toLowerCase() : "";
  const highlightIsCurrent = !!focusedOpt && !!items[hl] && items[hl].value.toLowerCase() === currentValue && !!currentValue;

  const requestAutocomplete = (opt: CommandOptionSpec, partial: string, d: CommandDraft) => {
    if (!opt.autocomplete || !spec.leaf || !channelId) return;
    const leaf = spec.leaf;
    if (acTimer.current) clearTimeout(acTimer.current);
    const req = ++acReq.current;
    setAc((prev) => ({ name: opt.name, items: prev?.name === opt.name ? prev.items : [], loading: true }));
    acTimer.current = setTimeout(() => {
      void fetchAutocompleteValues(channelId, leaf, resolvedValues(spec, d), opt.name, partial).then((choices) => {
        if (req !== acReq.current) return;
        setAc({ name: opt.name, items: choices.slice(0, 25), loading: false });
      });
    }, 250);
  };

  const onFieldFocus = (name: string) => {
    setFocused(name);
    const opt = optionByName(name);
    const list = itemsFor(name, "");
    const current = opt ? (draft.values[opt.name] ?? "").toLowerCase() : "";
    const idx = current ? list.findIndex((i) => i.value.toLowerCase() === current) : -1;
    const autoOpen = !!opt && (!!opt.choices?.length || isPickerKind(opt) || !!opt.autocomplete);
    setDd({ open: autoOpen, highlight: Math.max(0, idx), interacted: false, query: "" });
    if (opt?.autocomplete) requestAutocomplete(opt, hasLabel(opt) ? "" : draft.values[opt.name] ?? "", draft);
  };

  const closeDropdown = () => setDd((d) => (d.open ? { ...d, open: false } : d));

  const firstEmptyRequiredAfter = (d: CommandDraft, except: string) =>
    shownOptions(spec, d).find((o) => o.required && o.name !== except && o.kind !== "attachment" && !(d.values[o.name] ?? "").trim())?.name ?? null;

  const selectItem = (item: Item) => {
    if (item.type === "option" && item.option) {
      onChange(addOptionToDraft(draft, item.option.name));
      setTrailing("");
      closeDropdown();
      focusField(item.option.name);
      return;
    }
    if (!focusedOpt) return;
    const next = setDraftValue(draft, focusedOpt.name, item.value, item.label);
    onChange(next);
    closeDropdown();
    focusField(firstEmptyRequiredAfter(next, focusedOpt.name) ?? TRAILING);
  };

  const enter = (e: React.KeyboardEvent) => {
    e.preventDefault();
    const action = decideCommandEnter({
      readiness,
      dropdown: ddKind,
      hasHighlight: items.length > 0,
      interacted: dd.interacted,
      highlightIsCurrent,
    });
    if (action === "select" && items[hl]) {
      selectItem(items[hl]);
      return;
    }
    // Text typed at the end that names no option fills the first optional
    // one that accepts it (`/roll` + `20`, `/shrug` + `hi`), then sends.
    if (focused === TRAILING && trailing.trim() && items.length === 0) {
      const target = hidden.find((o) => o.kind !== "attachment" && o.kind !== "boolean" && !isPickerKind(o) && !optionValueError(o, trailing));
      if (target) {
        const filled = setDraftValue(addOptionToDraft(draft, target.name), target.name, trailing.trim());
        onChange(filled);
        setTrailing("");
        onSubmitRequest(filled);
        return;
      }
    }
    onSubmitRequest();
  };

  const moveHighlight = (delta: number) =>
    setDd((d) => ({ ...d, open: true, interacted: true, highlight: items.length ? (Math.max(0, Math.min(d.highlight, items.length - 1)) + delta + items.length) % items.length : 0 }));

  /** Keys shared by every field: list navigation, history, Tab order, Escape. Returns true when handled. */
  const commonKeys = (e: React.KeyboardEvent, name: string): boolean => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return true;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    switch (e.key) {
      case "ArrowDown":
        if (ddKind !== "none") moveHighlight(1);
        else if (browsingHistory) onHistoryStep("down");
        else if (itemsFor(name, dd.query).length > 0) setDd((d) => ({ ...d, open: true, interacted: true, highlight: 0 }));
        else return false;
        e.preventDefault();
        return true;
      case "ArrowUp":
        if (ddKind !== "none") moveHighlight(-1);
        else if (browsingHistory) onHistoryStep("up");
        else return false;
        e.preventDefault();
        return true;
      case "Tab": {
        if (e.shiftKey) {
          e.preventDefault();
          focusField(prevField(name) ?? CHIP);
          return true;
        }
        if (ddKind !== "none" && items[hl] && !(ddKind === "values" && highlightIsCurrent)) {
          e.preventDefault();
          selectItem(items[hl]);
          return true;
        }
        if (name === TRAILING) {
          if (hidden.length === 0) return false;
          e.preventDefault();
          setDd({ open: true, highlight: 0, interacted: false, query: trailing });
          return true;
        }
        e.preventDefault();
        closeDropdown();
        focusField(nextField(name));
        return true;
      }
      case "Escape":
        e.preventDefault();
        if (ddKind !== "none") closeDropdown();
        else if (browsingHistory || Object.values(draft.values).every((v) => !v.trim())) onExit("clear");
        return true;
      case "Enter":
        enter(e);
        return true;
      default:
        return false;
    }
  };

  /** Backspace in an empty field: drop an optional option, step back, or leave command mode at the start. */
  const backspaceEmpty = (e: React.KeyboardEvent, opt: CommandOptionSpec) => {
    e.preventDefault();
    const prev = prevField(opt.name);
    if (!opt.required) {
      onChange(removeOptionFromDraft(spec, draft, opt.name));
      closeDropdown();
      focusField(prev ?? TRAILING);
      return;
    }
    if (prev) focusField(prev);
    else onExit("backspace");
  };

  const onTextKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, opt: CommandOptionSpec) => {
    if (commonKeys(e, opt.name)) return;
    if (e.key === "Backspace") {
      const el = e.currentTarget;
      if (hasLabel(opt) && el.selectionStart === el.value.length) {
        // A picked member / choice is one token: clear it whole.
        e.preventDefault();
        onChange(setDraftValue(draft, opt.name, ""));
        setDd({ open: true, highlight: 0, interacted: false, query: "" });
        return;
      }
      if (el.value === "") backspaceEmpty(e, opt);
    }
  };

  const onTextChange = (opt: CommandOptionSpec, text: string) => {
    const next = setDraftValue(draft, opt.name, text);
    onChange(next);
    setDd({ open: true, highlight: 0, interacted: true, query: text });
    if (opt.autocomplete) requestAutocomplete(opt, text, next);
  };

  const setBoolean = (opt: CommandOptionSpec, value: boolean | null) => {
    onChange(value === null ? setDraftValue(draft, opt.name, "") : setDraftValue(draft, opt.name, value ? "true" : "false", value ? gt("True") : gt("False")));
  };

  const onBooleanKeyDown = (e: React.KeyboardEvent, opt: CommandOptionSpec) => {
    if (commonKeys(e, opt.name)) return;
    const cur = draft.values[opt.name];
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      setBoolean(opt, cur !== "true");
    } else if (e.key.toLowerCase() === "t" || e.key.toLowerCase() === "y") {
      e.preventDefault();
      setBoolean(opt, true);
    } else if (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "n") {
      e.preventDefault();
      setBoolean(opt, false);
    } else if (e.key === "Backspace") {
      if (cur) {
        e.preventDefault();
        setBoolean(opt, null);
      } else backspaceEmpty(e, opt);
    }
  };

  const setFile = (opt: CommandOptionSpec, file: File | null) => {
    const next = { ...files };
    if (file) next[opt.name] = file;
    else delete next[opt.name];
    onFilesChange(next);
  };

  const onFileKeyDown = (e: React.KeyboardEvent, opt: CommandOptionSpec) => {
    if (e.key === "Enter" && !files[opt.name] && !e.nativeEvent.isComposing) {
      e.preventDefault();
      fileInputs.current.get(opt.name)?.click();
      return;
    }
    if (commonKeys(e, opt.name)) return;
    if (e.key === " ") {
      e.preventDefault();
      fileInputs.current.get(opt.name)?.click();
    } else if (e.key === "Backspace") {
      if (files[opt.name]) {
        e.preventDefault();
        setFile(opt, null);
      } else backspaceEmpty(e, opt);
    }
  };

  const onTrailingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (commonKeys(e, TRAILING)) return;
    if (e.key === "Backspace" && e.currentTarget.value === "") {
      e.preventDefault();
      const last = shown[shown.length - 1];
      if (last) focusField(last.name);
      else onExit("backspace");
    }
  };

  const onChipKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      onExit("backspace");
    } else if (e.key === "Enter") {
      e.preventDefault();
      onSubmitRequest();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      focusField(fieldOrder[0]);
    } else if (e.key === "ArrowUp" && browsingHistory) {
      e.preventDefault();
      onHistoryStep("up");
    } else if (e.key === "ArrowDown" && browsingHistory) {
      e.preventDefault();
      onHistoryStep("down");
    }
  };

  // Close the lists when focus leaves the command entirely.
  const onRootBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as Node | null;
    if (to && rootRef.current?.contains(to)) return;
    setFocused(null);
    closeDropdown();
  };

  const fieldError = (opt: CommandOptionSpec) => {
    const raw = draft.values[opt.name] ?? "";
    if (opt.kind === "attachment" || opt.kind === "boolean") return null;
    // A half-typed search in a list (members, choices, suggestions) isn't an
    // error until the user moves on or tries to send.
    const hasList = isPickerKind(opt) || !!opt.choices?.length || !!opt.autocomplete;
    if (hasList && focused === opt.name && !showErrors) return null;
    return optionValueError(opt, raw);
  };

  const missingName = showErrors ? readiness.missing : null;
  const invalidOpt = shown.find((o) => fieldError(o));
  const invalidErr = invalidOpt ? fieldError(invalidOpt) : null;

  // ---- Overlay (value lists, option info) ----------------------------------
  const overlay = (() => {
    if (!focused || focused === CHIP || sending) return null;
    if (ddKind === "optional") {
      return (
        <div className="theme-solid absolute left-1 right-1 sm:left-2 sm:right-2 bottom-[calc(100%+8px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--app-border)]/50" onMouseDown={(e) => e.preventDefault()}>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--app-muted)]">{gt("Optional options")}</span>
            <span className="ml-auto text-[11px] text-[var(--app-muted)] truncate">/{spec.name}</span>
          </div>
          <div role="listbox" aria-label={gt("Optional options")} className="max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain">
            {items.map((item, i) => (
              <div
                key={item.key}
                role="option"
                aria-selected={i === hl}
                onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                onMouseMove={() => { if (i !== hl) setDd((d) => ({ ...d, highlight: i })); }}
                className={cn("flex items-center gap-3 px-3 py-2 min-h-[44px] cursor-pointer", i === hl ? "bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)]" : "hover:bg-[var(--app-surface)]/60")}
              >
                <Plus className="w-4 h-4 shrink-0 text-[var(--app-muted)]" />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">{item.label}</span>
                  {item.sub && <span className="text-xs text-[var(--app-muted)] truncate">{item.sub}</span>}
                </span>
                {item.option && <span className="ml-auto text-[11px] text-[var(--app-muted)] shrink-0">{optionKindLabel(gt, item.option.kind)}</span>}
              </div>
            ))}
          </div>
        </div>
      );
    }
    if (!focusedOpt) return null;
    const header = (withDescription: boolean) => (
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--app-border)]/50 min-w-0" onMouseDown={(e) => e.preventDefault()}>
        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{focusedOpt.name}</span>
        {focusedOpt.required && <span className="text-[9px] font-bold uppercase text-[var(--app-accent)] shrink-0">{gt("required")}</span>}
        <span className="text-[11px] text-[var(--app-muted)] shrink-0">{optionKindLabel(gt, focusedOpt.kind)}</span>
        {withDescription && focusedOpt.description && <span className="hidden sm:block text-[11px] text-[var(--app-muted)] truncate">— {focusedOpt.description}</span>}
        {ac?.name === focusedOpt.name && ac.loading && <Loader size={14} className="ml-auto shrink-0" />}
      </div>
    );
    if (ddKind === "values") {
      return (
        <div className="theme-solid absolute left-1 right-1 sm:left-2 sm:right-2 bottom-[calc(100%+8px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden">
          {header(true)}
          <div role="listbox" aria-label={focusedOpt.name} className="max-h-[min(40dvh,18rem)] overflow-y-auto overscroll-contain">
            {items.map((item, i) => {
              const selected = item.value.toLowerCase() === currentValue && !!currentValue;
              return (
                <div
                  key={item.key}
                  role="option"
                  aria-selected={i === hl}
                  onMouseDown={(e) => { e.preventDefault(); selectItem(item); }}
                  onMouseMove={() => { if (i !== hl) setDd((d) => ({ ...d, highlight: i })); }}
                  className={cn("flex items-center gap-3 px-3 py-2 min-h-[44px] cursor-pointer", i === hl ? "bg-[color-mix(in_srgb,var(--app-accent)_14%,transparent)]" : "hover:bg-[var(--app-surface)]/60")}
                >
                  {item.type === "user" ? (
                    item.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cdnImage(item.avatar)} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" loading="lazy" />
                    ) : (
                      <span className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 text-xs font-bold bg-[color-mix(in_srgb,var(--app-accent)_20%,transparent)] text-[var(--app-accent)]">
                        {(item.label || "?").charAt(0).toUpperCase()}
                      </span>
                    )
                  ) : item.type === "role" ? (
                    <Shield className="w-4 h-4 shrink-0" style={item.color ? { color: item.color } : undefined} />
                  ) : item.type === "channel" ? (
                    <Hash className="w-4 h-4 shrink-0 text-[var(--app-muted)]" />
                  ) : item.emoji ? (
                    <span className="text-base shrink-0">{item.emoji}</span>
                  ) : null}
                  <span className="flex flex-col min-w-0">
                    <span className="text-sm text-[var(--text-primary)] truncate" style={item.type !== "choice" && item.color ? { color: item.color } : undefined}>{item.label}</span>
                    {item.sub && <span className="text-xs text-[var(--app-muted)] truncate">{item.sub}</span>}
                  </span>
                  {selected && <span className="ml-auto text-[10px] font-semibold uppercase text-[var(--app-accent)] shrink-0">{gt("Selected")}</span>}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    // No list: describe the option being filled in.
    const isTts = spec.key === "builtin:tts";
    const acWaiting = !!focusedOpt.autocomplete && ac?.name === focusedOpt.name && ac.loading;
    if (!focusedOpt.description && !isTts && !acWaiting) return null;
    return (
      <div className="theme-solid absolute left-1 right-1 sm:left-2 sm:right-2 bottom-[calc(100%+8px)] z-20 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-alt)] shadow-[var(--app-elev-2)] overflow-hidden pointer-events-none">
        {header(false)}
        <div className="px-3 py-2 space-y-1.5">
          {focusedOpt.description && <p className="text-xs text-[var(--app-muted)] leading-relaxed">{focusedOpt.description}</p>}
          {acWaiting && <p className="text-xs text-[var(--app-muted)]">{gt("Loading suggestions…")}</p>}
          {isTts && (
            <div className="grid gap-1 text-[11px] text-[var(--app-muted)] sm:grid-cols-2">
              <span><code className="text-[var(--app-accent)]">[f]</code> {gt("Female voice")}</span>
              <span><code className="text-[var(--app-accent)]">[m]</code> {gt("Male voice")}</span>
              <span><code className="text-[var(--app-accent)]">[2x]</code> {gt("Speed (also: [1.5x], [slow], [fast], [turbo])")}</span>
              <span><code className="text-[var(--app-accent)]">[vol:50]</code> {gt("Volume 0–500% (also: [vol:BASS] bass boost, [vol:EAR] max loudness)")}</span>
              <span><code className="text-[var(--app-accent)]">[steven]</code> {gt("Stephen Hawking robotic voice")}</span>
              <span><code className="text-[var(--app-accent)]">[fish:miku]</code> {gt("FishAudio AI voice (also: [fish:model-id])")}</span>
              <span><code className="text-[var(--app-accent)]">[f-japanese]</code> {gt("Gender + accent (also: [m-dutch], [scottish]…)")}</span>
              <span className="flex items-center gap-1"><Volume2 className="w-3 h-3 shrink-0" />{gt("Switch speakers mid-message: [m] hi [f] hello")}</span>
              <span className="flex items-center gap-1"><Music className="w-3 h-3 shrink-0" />{gt("Trigger words auto-play sound effects mid-speech")}</span>
            </div>
          )}
        </div>
      </div>
    );
  })();

  // ---- Fields ---------------------------------------------------------------
  const chipClass = (opt: CommandOptionSpec) =>
    cn(
      "group/opt inline-flex items-stretch max-w-full min-h-8 rounded-md border bg-[var(--app-surface-alt)] overflow-hidden transition-colors",
      focused === opt.name ? "border-[var(--app-accent)] ring-1 ring-[var(--app-accent)]/40" : "border-[var(--app-border)]",
      (missingName === opt.name || fieldError(opt)) && "border-red-500/70 ring-1 ring-red-500/30",
      dragOver === opt.name && "border-dashed border-[var(--app-accent)]",
    );
  const nameTag = (opt: CommandOptionSpec) => (
    <span
      className={cn(
        "flex items-center px-2 text-xs font-medium shrink-0 border-r border-[var(--app-border)]/60",
        opt.required ? "text-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]" : "text-[var(--app-muted)]",
      )}
      title={opt.description || undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        focusField(opt.name);
      }}
    >
      {opt.name}
    </span>
  );

  const renderField = (opt: CommandOptionSpec) => {
    if (opt.kind === "boolean") {
      const v = draft.values[opt.name];
      return (
        <span key={opt.name} className={chipClass(opt)}>
          {nameTag(opt)}
          <span
            ref={setRef(opt.name)}
            role="radiogroup"
            aria-label={opt.name}
            tabIndex={0}
            onFocus={() => onFieldFocus(opt.name)}
            onKeyDown={(e) => onBooleanKeyDown(e, opt)}
            className="flex items-center gap-0.5 p-0.5 outline-none"
          >
            {([true, false] as const).map((b) => {
              const on = v === (b ? "true" : "false");
              return (
                <button
                  key={String(b)}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={-1}
                  disabled={sending}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setBoolean(opt, on ? null : b);
                    refs.current.get(opt.name)?.focus();
                  }}
                  className={cn(
                    "px-2.5 min-h-7 rounded text-xs font-medium transition-colors",
                    on ? "bg-[var(--app-accent)] text-white" : "text-[var(--app-muted)] hover:bg-[var(--app-surface)]",
                  )}
                >
                  {b ? gt("True") : gt("False")}
                </button>
              );
            })}
          </span>
        </span>
      );
    }
    if (opt.kind === "attachment") {
      const file = files[opt.name];
      return (
        <span
          key={opt.name}
          className={chipClass(opt)}
          onDragOver={(e) => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(opt.name);
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => {
            const f = e.dataTransfer?.files?.[0];
            if (!f) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(null);
            setFile(opt, f);
          }}
        >
          {nameTag(opt)}
          <input
            ref={(el) => {
              if (el) fileInputs.current.set(opt.name, el);
              else fileInputs.current.delete(opt.name);
            }}
            type="file"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setFile(opt, f);
              refs.current.get(opt.name)?.focus();
            }}
          />
          <span
            ref={setRef(opt.name)}
            role="button"
            tabIndex={0}
            aria-label={file ? file.name : gt("Choose a file")}
            onFocus={() => onFieldFocus(opt.name)}
            onKeyDown={(e) => onFileKeyDown(e, opt)}
            onClick={() => { if (!file && !sending) fileInputs.current.get(opt.name)?.click(); }}
            className="flex items-center gap-1.5 px-2 text-sm outline-none cursor-pointer min-w-0"
          >
            <Paperclip className="w-3.5 h-3.5 shrink-0 text-[var(--app-muted)]" />
            {file ? (
              <>
                <span className="truncate max-w-[10rem] text-[var(--text-primary)]">{file.name}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(opt, null);
                  }}
                  className="flex items-center justify-center w-6 h-6 -mr-1 rounded text-[var(--app-muted)] hover:text-[var(--text-primary)]"
                  aria-label={gt("Remove file")}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <span className="text-[var(--app-muted)] whitespace-nowrap">{touchOnly ? gt("Choose a file") : gt("Drop or choose a file")}</span>
            )}
          </span>
        </span>
      );
    }
    const text = displayValue(opt);
    const userValue = opt.kind === "user" || opt.kind === "mentionable" ? pickers.users.find((u) => `<@${u.id}>` === draft.values[opt.name]) : undefined;
    const numeric = opt.kind === "integer" || opt.kind === "number";
    return (
      <span key={opt.name} className={chipClass(opt)}>
        {nameTag(opt)}
        <span className="flex items-center min-w-0">
          {userValue?.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cdnImage(userValue.avatar)} alt="" className="w-5 h-5 ml-1.5 rounded-full object-cover shrink-0" />
          )}
          <input
            ref={setRef(opt.name)}
            value={text}
            readOnly={sending}
            placeholder={optionPlaceholder(gt, opt)}
            aria-label={opt.name}
            aria-invalid={missingName === opt.name || !!fieldError(opt)}
            inputMode={opt.kind === "integer" ? "numeric" : opt.kind === "number" ? "decimal" : undefined}
            enterKeyHint={readiness.ready ? "send" : "next"}
            autoComplete="off"
            spellCheck={!numeric && !isPickerKind(opt)}
            onFocus={() => onFieldFocus(opt.name)}
            onChange={(e) => onTextChange(opt, e.target.value)}
            onKeyDown={(e) => onTextKeyDown(e, opt)}
            // Grows with the value (padding is inside the width: border-box).
            style={{ width: `calc(${Math.min(36, Math.max(optionPlaceholder(gt, opt).length + 1, text.length + 1))}ch + 1rem)` }}
            className={cn(
              "max-w-full min-w-0 bg-transparent px-2 py-1 text-base sm:text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--app-muted-2)]",
              hasLabel(opt) && "font-medium text-[var(--app-accent)]",
            )}
          />
        </span>
      </span>
    );
  };

  const hintLine = sending ? (
    <span className="flex items-center gap-1.5"><Loader size={14} />{gt("Sending command…")}</span>
  ) : missingName ? (
    <span className="text-red-400">{gt("Fill in {option} to send.", { option: missingName })}</span>
  ) : invalidOpt && invalidErr ? (
    <span className="text-red-400"><span className="font-semibold">{invalidOpt.name}</span>: {optionErrorText(gt, invalidErr)}</span>
  ) : browsingHistory ? (
    <span>{gt("↑ older · ↓ newer · Enter runs it again")}</span>
  ) : null;

  return (
    <div ref={rootRef} className="flex-1 min-w-0 py-1.5 pl-2 sm:pl-3 pr-12 sm:pr-16" onBlur={onRootBlur}>
      <div className="flex flex-wrap items-center gap-1.5 min-h-[32px]">
        <button
          ref={setRef(CHIP)}
          type="button"
          onFocus={() => { setFocused(CHIP); closeDropdown(); }}
          onKeyDown={onChipKeyDown}
          onClick={() => focusField(fieldOrder[0])}
          title={spec.description}
          className="inline-flex items-center gap-1.5 min-h-8 max-w-full rounded-md pl-1 pr-2 bg-[color-mix(in_srgb,var(--app-accent)_16%,transparent)] text-[var(--app-accent)] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/50"
        >
          <CommandIcon spec={spec} className="w-6 h-6" />
          <span className="truncate">/{spec.name}</span>
        </button>
        {shown.map(renderField)}
        {hidden.length > 0 && !sending && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              focusField(TRAILING);
              setDd({ open: true, highlight: 0, interacted: false, query: trailing });
            }}
            className="inline-flex items-center gap-1 min-h-8 rounded-md border border-dashed border-[var(--app-border)] px-2 text-xs text-[var(--app-muted)] hover:text-[var(--text-primary)] hover:border-[var(--app-accent)]/60"
          >
            <Plus className="w-3.5 h-3.5" />
            {gt("{count} optional", { count: hidden.length })}
          </button>
        )}
        <input
          ref={setRef(TRAILING)}
          value={trailing}
          readOnly={sending}
          aria-label={gt("Add an option")}
          enterKeyHint={readiness.ready ? "send" : "next"}
          autoComplete="off"
          placeholder={touchOnly || !readiness.ready ? "" : hidden.length > 0 ? gt("Enter to send · Tab for options") : gt("Enter to send")}
          onFocus={() => {
            setFocused(TRAILING);
            setDd({ open: false, highlight: 0, interacted: false, query: trailing });
          }}
          onChange={(e) => {
            setTrailing(e.target.value);
            setDd({ open: hidden.length > 0, highlight: 0, interacted: true, query: e.target.value });
          }}
          onKeyDown={onTrailingKeyDown}
          className="flex-1 min-w-[5rem] bg-transparent py-1 text-base sm:text-sm outline-none text-[var(--text-primary)] placeholder:text-[var(--app-muted-2)]"
        />
      </div>
      {hintLine && <div className="mt-1 text-[11px] text-[var(--app-muted)] truncate" aria-live="polite">{hintLine}</div>}
      {overlayHost && overlay ? createPortal(overlay, overlayHost) : null}
    </div>
  );
}

export default CommandComposer;
