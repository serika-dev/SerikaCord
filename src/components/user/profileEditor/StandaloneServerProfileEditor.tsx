"use client";

import { useState } from "react";
import { useGT } from "gt-next";
import { toast } from "sonner";
import { useServerOptional } from "@/contexts/ServerContext";
import { UnsavedChangesBar, useUnsavedShake } from "@/components/ui/unsaved-changes-bar";
import { ServerProfileEditor } from "@/components/user/profileEditor/ServerProfileEditor";
import { ServerProfilePicker } from "@/components/user/profileEditor/ServerProfilePicker";
import { useProfileMediaUpload } from "@/components/user/profileEditor/useProfileMediaUpload";
import { useServerProfileDraft, useServerProfileIndex } from "@/components/user/profileEditor/useServerProfileDraft";
import { overriddenFields } from "@/lib/profiles/memberProfile";

/**
 * Per-server profiles as a self-contained section (the phone settings
 * "Profiles" page): server picker, the editor with its live preview, and
 * its own unsaved-changes bar.
 */
export default function StandaloneServerProfileEditor() {
  const gt = useGT();
  const serverCtx = useServerOptional();
  const servers = serverCtx?.servers ?? [];
  const currentId = serverCtx?.currentServer?.id ?? null;
  const [picked, setPicked] = useState<string | null>(null);
  const serverId = (picked && servers.some((s) => s.id === picked) ? picked : null)
    ?? (currentId && servers.some((s) => s.id === currentId) ? currentId : null)
    ?? servers[0]?.id
    ?? null;
  const index = useServerProfileIndex(true);
  const draft = useServerProfileDraft(serverId, { onSaved: (sid, stored) => index.setProfile(sid, overriddenFields(stored)) });
  const media = useProfileMediaUpload();
  const [shakeSignal, shake] = useUnsavedShake();
  const server = serverId ? servers.find((s) => s.id === serverId) : undefined;

  if (servers.length === 0) {
    return (
      <p className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-secondary)]">
        {gt("Join a server to give yourself a different profile there.")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ServerProfileEditor
        layout="page"
        draft={draft}
        serverName={server?.name ?? ""}
        media={media}
        picker={
          <ServerProfilePicker
            servers={servers}
            value={serverId}
            onChange={(id) => { if (id) setPicked(id); }}
            profiled={index.profiles}
            preferredId={currentId}
            canChange={() => {
              if (!draft.dirty) return true;
              shake();
              toast.error(gt("Save or reset your changes before switching servers."));
              return false;
            }}
          />
        }
      />
      <UnsavedChangesBar
        visible={draft.dirty}
        isSaving={draft.saving}
        onSave={() => void draft.save()}
        onDiscard={draft.discard}
        changeCount={draft.dirtyFields.length}
        shakeSignal={shakeSignal}
        className="bottom-2"
      />
      {media.element}
    </div>
  );
}
