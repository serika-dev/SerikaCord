"use client";

/**
 * A modal an app opened (interaction callback 9): text inputs, select menus,
 * radio / checkbox groups and text, in Discord's modal layout (label
 * components, or legacy action rows of text inputs). Submitting posts the
 * values to /api/interactions/modals/:id, where they are checked again
 * against the stored modal before the app gets MODAL_SUBMIT. Code-split;
 * mounted by InteractionModalHost on first use.
 */
import { useMemo, useState } from "react";
import { useGT } from "gt-next";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { postInteraction, type MessageComponent, type Modal } from "@/lib/chat/interactionEvents";
import { useServer, useServerMembersOptional } from "@/contexts/ServerContext";

const T = {
  ACTION_ROW: 1, STRING_SELECT: 3, TEXT_INPUT: 4, USER_SELECT: 5, ROLE_SELECT: 6, MENTIONABLE_SELECT: 7, CHANNEL_SELECT: 8,
  TEXT_DISPLAY: 10, LABEL: 18, RADIO_GROUP: 21, CHECKBOX_GROUP: 22, CHECKBOX: 23,
} as const;

export interface InteractionModalData {
  modalId: string;
  modal: Modal;
  application: { id: string; name: string; icon: string | null };
}

type Value = string | string[] | boolean;

function initialValue(c: MessageComponent): Value {
  if (c.type === T.TEXT_INPUT) return c.value ?? "";
  if (c.type === T.CHECKBOX) return Boolean(c.default);
  if (c.type === T.RADIO_GROUP) return c.options?.find((o) => o.default)?.value ?? "";
  if (c.options) return c.options.filter((o) => o.default).map((o) => o.value);
  return (c.default_values ?? []).map((d) => d.id);
}

/** The inputs of a modal with their labels (legacy rows use the input's own label). */
function fields(modal: Modal): Array<{ input: MessageComponent; label?: string; description?: string; key: string }> {
  const out: Array<{ input: MessageComponent; label?: string; description?: string; key: string }> = [];
  modal.components.forEach((c, i) => {
    if (c.type === T.ACTION_ROW && c.components?.[0]) out.push({ input: c.components[0], label: c.components[0].label, key: `r${i}` });
    else if (c.type === T.LABEL && c.component) out.push({ input: c.component, label: c.label, description: c.description, key: `l${i}` });
  });
  return out;
}

export default function InteractionModal({ data, open, onOpenChange }: { data: InteractionModalData | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const gt = useGT();
  const { channels } = useServer();
  const membersCtx = useServerMembersOptional();
  const modal = data?.modal ?? null;
  const inputs = useMemo(() => (modal ? fields(modal) : []), [modal]);
  const [values, setValues] = useState<Record<string, Value>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [forModal, setForModal] = useState<string | null>(null);

  // A new modal resets the form (render-time reset, no effect).
  if (data && forModal !== data.modalId) {
    setForModal(data.modalId);
    const init: Record<string, Value> = {};
    for (const f of fields(data.modal)) if (f.input.custom_id) init[f.input.custom_id] = initialValue(f.input);
    setValues(init);
    setErrors({});
    setFormError(null);
    setSubmitting(false);
  }

  const entityOptions = (c: MessageComponent): Array<{ value: string; label: string }> => {
    const members = (membersCtx?.members ?? []) as Array<{ id: string; username?: string; displayName?: string; roles?: Array<{ id: string; name: string }> }>;
    const users = members.map((m) => ({ value: m.id, label: m.displayName || m.username || m.id }));
    const roleMap = new Map<string, string>();
    for (const m of members) for (const r of m.roles ?? []) if (r?.id) roleMap.set(r.id, r.name);
    const roles = [...roleMap].map(([value, name]) => ({ value, label: `@${name}` }));
    if (c.type === T.USER_SELECT) return users;
    if (c.type === T.ROLE_SELECT) return roles;
    if (c.type === T.MENTIONABLE_SELECT) return [...users, ...roles];
    if (c.type === T.CHANNEL_SELECT) return channels.map((ch) => ({ value: ch.id, label: `#${ch.name}` }));
    return [];
  };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    for (const { input } of inputs) {
      const id = input.custom_id ?? "";
      const v = values[id];
      const required = input.required !== false && input.type !== T.CHECKBOX ? true : Boolean(input.required);
      if (input.type === T.TEXT_INPUT) {
        const s = typeof v === "string" ? v : "";
        if (required && !s.trim()) next[id] = gt("This field is required.");
        else if (s && input.min_length && s.length < input.min_length) next[id] = gt("Must be at least {count} characters.", { count: input.min_length });
        else if (input.max_length && s.length > input.max_length) next[id] = gt("Must be {count} characters or fewer.", { count: input.max_length });
      } else if (input.type === T.CHECKBOX) {
        if (input.required && v !== true) next[id] = gt("This field is required.");
      } else {
        const list = Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [];
        const min = input.type === T.RADIO_GROUP ? (required ? 1 : 0) : (input.min_values ?? (required ? 1 : 0));
        if (list.length < min) next[id] = gt("This field is required.");
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!data || submitting || !validate()) return;
    setSubmitting(true);
    setFormError(null);
    const components = inputs.map(({ input }) => {
      const id = input.custom_id ?? "";
      const v = values[id];
      if (input.type === T.TEXT_INPUT || input.type === T.CHECKBOX) return { custom_id: id, value: v };
      if (input.type === T.RADIO_GROUP) return { custom_id: id, values: typeof v === "string" && v ? [v] : [] };
      return { custom_id: id, values: Array.isArray(v) ? v : [] };
    });
    const r = await postInteraction(`modals/${encodeURIComponent(data.modalId)}`, { components });
    setSubmitting(false);
    if (r.ok) {
      onOpenChange(false);
      return;
    }
    const field = (r.data as { field?: string } | null)?.field;
    if (field) setErrors((e) => ({ ...e, [field]: gt("This value isn't valid.") }));
    setFormError(
      r.code === "unknown_modal" || r.code === "modal_used"
        ? gt("This form has expired. Run the command again.")
        : r.code === "rate_limited"
          ? gt("You are doing that too fast.")
          : gt("Something went wrong. Try again."),
    );
  };

  const set = (id: string, v: Value) => setValues((prev) => ({ ...prev, [id]: v }));

  const renderInput = (input: MessageComponent, labelId: string) => {
    const id = input.custom_id ?? "";
    const v = values[id];
    const invalid = Boolean(errors[id]);
    switch (input.type) {
      case T.TEXT_INPUT: {
        const common = {
          id: labelId,
          value: typeof v === "string" ? v : "",
          placeholder: input.placeholder,
          maxLength: input.max_length ?? 4000,
          "aria-invalid": invalid,
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(id, e.target.value),
          className: cn("bg-[var(--app-surface-alt)] border-[var(--app-border)] text-[var(--app-text)]", invalid && "border-[var(--destructive)]"),
        };
        return input.style === 2 ? <Textarea rows={4} {...common} /> : <Input {...common} />;
      }
      case T.CHECKBOX:
        return (
          <label className="flex items-center gap-2 text-sm">
            <input id={labelId} type="checkbox" checked={v === true} onChange={(e) => set(id, e.target.checked)} className="accent-[var(--app-accent)]" />
          </label>
        );
      case T.RADIO_GROUP:
        return (
          <div role="radiogroup" aria-labelledby={labelId} className="flex flex-col gap-1.5">
            {(input.options ?? []).map((o) => (
              <label key={o.value} className="flex items-start gap-2 text-sm cursor-pointer">
                <input type="radio" name={id} checked={v === o.value} onChange={() => set(id, o.value)} className="mt-0.5 accent-[var(--app-accent)]" />
                <span>
                  {o.label}
                  {o.description && <span className="block text-xs text-[var(--app-muted)]">{o.description}</span>}
                </span>
              </label>
            ))}
          </div>
        );
      default: {
        // Selects and checkbox groups: a checklist (single choice when max is 1).
        const opts: Array<{ value: string; label: string; description?: string }> = input.options
          ? input.options.map((o) => ({ value: o.value, label: o.label, description: o.description }))
          : entityOptions(input);
        const max = input.max_values ?? (input.type === T.CHECKBOX_GROUP ? opts.length : 1);
        const chosen = Array.isArray(v) ? v : [];
        return (
          <div role="listbox" aria-labelledby={labelId} aria-multiselectable={max > 1} className={cn("max-h-48 overflow-y-auto rounded-md border bg-[var(--app-surface-alt)] p-1", invalid ? "border-[var(--destructive)]" : "border-[var(--app-border)]")}>
            {opts.length === 0 && <div className="px-2 py-2 text-sm text-[var(--app-muted)]">{gt("Nothing to choose from here.")}</div>}
            {opts.map((o) => {
              const selected = chosen.includes(o.value);
              return (
                <label key={o.value} className="flex items-start gap-2 px-2 py-1.5 rounded text-sm cursor-pointer hover:bg-[var(--app-surface)]">
                  <input
                    type={max > 1 ? "checkbox" : "radio"}
                    name={id}
                    checked={selected}
                    onChange={() => set(id, max > 1
                      ? (selected ? chosen.filter((x) => x !== o.value) : chosen.length >= max ? chosen : [...chosen, o.value])
                      : [o.value])}
                    className="mt-0.5 accent-[var(--app-accent)]"
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{o.label}</span>
                    {o.description && <span className="block text-xs text-[var(--app-muted)]">{o.description}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        );
      }
    }
  };

  return (
    <Dialog open={open && Boolean(data)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col gap-3 bg-[var(--bg-card)] border-[var(--border-subtle)] text-[var(--text-primary)]">
        <DialogHeader>
          <DialogTitle className="break-words">{modal?.title}</DialogTitle>
          <DialogDescription className="text-[var(--text-secondary)]">
            {gt("Sent to {app}", { app: data?.application.name || gt("the app") })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4 overflow-y-auto pr-1"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          {modal?.components.map((c, i) => {
            if (c.type === T.TEXT_DISPLAY) {
              return <p key={`t${i}`} className="text-sm text-[var(--app-text)] whitespace-pre-wrap break-words">{c.content}</p>;
            }
            const f = inputs.find((x) => x.key === (c.type === T.ACTION_ROW ? `r${i}` : `l${i}`));
            if (!f || !f.input.custom_id) return null;
            const labelId = `ixm-${f.input.custom_id}`;
            const required = f.input.type === T.CHECKBOX ? Boolean(f.input.required) : f.input.required !== false;
            return (
              <div key={f.key} className="flex flex-col gap-1.5">
                {f.label && (
                  <label htmlFor={labelId} id={labelId} className="text-xs font-semibold uppercase tracking-wide text-[var(--app-muted)]">
                    {f.label}
                    {required && <span className="ml-0.5 text-[var(--destructive)]">*</span>}
                  </label>
                )}
                {f.description && <span className="text-xs text-[var(--app-muted)] -mt-1">{f.description}</span>}
                {renderInput(f.input, labelId)}
                {errors[f.input.custom_id] && <span role="alert" className="text-xs text-[var(--destructive)]">{errors[f.input.custom_id]}</span>}
              </div>
            );
          })}
          {formError && <div role="alert" className="text-sm text-[var(--destructive)]">{formError}</div>}
          <DialogFooter className="gap-2">
            <button type="button" className="chat-cbtn chat-cbtn-secondary" onClick={() => onOpenChange(false)}>{gt("Cancel")}</button>
            <button type="submit" className="chat-cbtn chat-cbtn-primary" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {gt("Submit")}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
