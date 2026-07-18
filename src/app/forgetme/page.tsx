"use client";

import { useState } from "react";

type Result = { deletedMessages: number; hadLinkedDiscord: boolean } | null;

export default function ForgetMePage() {
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error" | "unauth">("idle");
  const [result, setResult] = useState<Result>(null);

  const handleForget = async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/discord/forget-me", { method: "POST", credentials: "include" });
      if (res.status === 401) {
        setStatus("unauth");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = await res.json();
      setResult({ deletedMessages: data.deletedMessages ?? 0, hadLinkedDiscord: Boolean(data.hadLinkedDiscord) });
      setStatus("done");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-[var(--bg-app,#0a0a0a)] text-[var(--text-primary,#e8e8e8)] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--border-subtle,#222)] bg-[var(--bg-elevated,#111)] p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Forget me</h1>
        <p className="text-sm text-[var(--text-secondary,#999)] mb-6">
          Erase the data SerikaCord has stored about you from bridged Discord servers, and stop any future
          syncing. This deletes your bridged messages and profile, and turns off outbound sync of your
          SerikaCord messages to Discord.
        </p>

        <div className="rounded-lg border border-[var(--border-subtle,#222)] bg-[var(--bg-app,#0a0a0a)] p-4 mb-6">
          <p className="text-xs font-semibold text-white mb-1">On Discord</p>
          <p className="text-xs text-[var(--text-secondary,#999)]">
            You can also run <code className="text-[#8B5CF6]">/forgetme</code> directly in Discord (in a DM to the
            bot or in any bridged server) to erase your data instantly.
          </p>
        </div>

        {status === "done" ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm">
            <p className="text-green-400 font-semibold mb-1">Done — your data has been erased.</p>
            <p className="text-[var(--text-secondary,#999)]">
              {result?.hadLinkedDiscord
                ? `Deleted ${result?.deletedMessages} bridged message${result?.deletedMessages === 1 ? "" : "s"} and your bridged profile.`
                : "No linked Discord account was found, so there were no bridged messages to delete."}{" "}
              Outbound sync to Discord has been turned off.
            </p>
          </div>
        ) : status === "unauth" ? (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 text-sm">
            <p className="text-yellow-400 font-semibold mb-1">Please sign in first.</p>
            <p className="text-[var(--text-secondary,#999)]">
              Log in to your SerikaCord account, then return here. If you only use Discord, run{" "}
              <code className="text-[#8B5CF6]">/forgetme</code> in Discord instead.
            </p>
          </div>
        ) : (
          <button
            onClick={handleForget}
            disabled={status === "loading"}
            className="w-full rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold h-11 transition-colors"
          >
            {status === "loading" ? "Erasing…" : "Erase my bridged data"}
          </button>
        )}

        {status === "error" && (
          <p className="mt-3 text-xs text-red-400">Something went wrong. Please try again.</p>
        )}
      </div>
    </div>
  );
}
