"use client";

import { Textarea } from "@/components/ui/textarea";
import { useGT } from "gt-next";

interface MessageEditFormProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCancel: () => void;
  onSave: () => void;
}

/** Inline message edit box with escape/enter hints. */
export function MessageEditForm({ value, onChange, onKeyDown, onCancel, onSave }: MessageEditFormProps) {
  const gt = useGT();
  return (
    <div className="mt-1">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        className="bg-[var(--bg-sidebar-elevated)] border-[var(--border-subtle)] text-[var(--text-primary)] text-sm rounded-md resize-none focus-visible:ring-1 focus-visible:ring-[#8B5CF6] min-h-[40px]"
        rows={2}
      />
      <div className="text-xs text-[var(--text-muted)] mt-1">
        {gt("escape to")}{" "}
        <button onClick={onCancel} className="text-[#8B5CF6] hover:underline">
          {gt("cancel")}
        </button>
        {" • "}{gt("enter to")}{" "}
        <button onClick={onSave} className="text-[#8B5CF6] hover:underline">
          {gt("save")}
        </button>
      </div>
    </div>
  );
}
