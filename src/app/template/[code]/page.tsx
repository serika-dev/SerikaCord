"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { T } from "gt-next";
import CreateFromTemplate from "@/components/server/community/CreateFromTemplate";

/** Shareable server template link (serika.chat/template/<code>). */
export default function TemplatePage() {
  const params = useParams<{ code: string }>();
  const code = typeof params?.code === "string" ? params.code : "";
  return (
    <main className="min-h-dvh flex items-center justify-center px-4 py-8 bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="w-full max-w-md rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] shadow-xl">
        <div className="p-4 pb-0 text-center">
          <h1 className="text-2xl font-bold"><T>Create a server from a template</T></h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            <T>You get the channels, roles and settings. No messages or members are copied.</T>
          </p>
        </div>
        <CreateFromTemplate initialCode={code} />
        <p className="px-4 pb-4 text-xs text-center text-[var(--text-muted)]">
          <Link href={`/login?redirect=${encodeURIComponent(`/template/${code}`)}`} className="hover:underline">
            <T>Not logged in? Log in first.</T>
          </Link>
        </p>
      </div>
    </main>
  );
}
