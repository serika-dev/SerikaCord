"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/ui/Logo";
import { useGT } from "gt-next";

interface LegalDocumentProps {
  /** Small purple eyebrow label, e.g. "Legal" */
  badge: string;
  /** Page heading, e.g. "Privacy Policy" */
  title: string;
  /** "Last updated ..." line */
  updated: string;
  /** Link shown in the nav to the sibling legal page */
  navLink: { href: string; label: string };
  /** Link shown in the footer to the sibling legal page */
  footerLink: { href: string; label: string };
  /** Copyright / left footer text */
  copyright: string;
  /** The concise, plain-language version */
  simple: ReactNode;
  /** The full, authoritative legal version */
  legal: ReactNode;
}

type Mode = "simple" | "legal";

export function LegalDocument({
  badge,
  title,
  updated,
  navLink,
  footerLink,
  copyright,
  simple,
  legal,
}: LegalDocumentProps) {
  const gt = useGT();
  // Legal is the authoritative version — default to it.
  const [mode, setMode] = useState<Mode>("legal");

  return (
    <div className="min-h-screen bg-[#000] text-white">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#000]/80 backdrop-blur-xl border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/">
            <Logo size="sm" />
          </Link>
          <Link
            href={navLink.href}
            className="text-sm text-[#888] hover:text-white transition-colors"
          >
            {navLink.label} →
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 pt-28 pb-20">
        <p className="text-sm text-[#8B5CF6] font-medium mb-3">{badge}</p>
        <h1 className="text-4xl font-bold mb-2">{title}</h1>
        <p className="text-[#555] text-sm mb-8">{updated}</p>

        {/* Simple / Legal toggle */}
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            role="tablist"
            aria-label={gt("Document version")}
            className="inline-flex items-center rounded-lg border border-white/[0.08] bg-white/[0.03] p-1"
          >
            <button
              role="tab"
              aria-selected={mode === "simple"}
              onClick={() => setMode("simple")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "simple"
                  ? "bg-white/[0.08] text-white"
                  : "text-[#888] hover:text-white"
              }`}
            >
              {gt("Simple")}
            </button>
            <button
              role="tab"
              aria-selected={mode === "legal"}
              onClick={() => setMode("legal")}
              className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                mode === "legal"
                  ? "bg-[#8B5CF6] text-white"
                  : "text-[#888] hover:text-white"
              }`}
            >
              {gt("Legal")}
            </button>
          </div>
          <p className="text-xs text-[#555]">
            {mode === "simple"
              ? gt("Plain-language summary for convenience only.")
              : gt("Full, authoritative version. This governs in case of any conflict.")}
          </p>
        </div>

        <div className="mb-10 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-xs text-[#777]">
          {mode === "simple"
            ? gt("This is a simplified explanation of the full document. It is provided for readability and is not a substitute for the Legal version, which is the binding text.")
            : gt("This is the complete legal document. If there is any discrepancy between the Simple summary and this Legal version, this version controls.")}
        </div>

        <div className="prose prose-invert prose-sm max-w-none space-y-8 text-[#aaa] leading-relaxed">
          {mode === "simple" ? simple : legal}
        </div>

        <div className="mt-16 pt-8 border-t border-white/[0.06] flex items-center justify-between text-sm text-[#444]">
          <span>{copyright}</span>
          <Link href={footerLink.href} className="text-[#8B5CF6] hover:underline">
            {footerLink.label}
          </Link>
        </div>
      </main>
    </div>
  );
}
