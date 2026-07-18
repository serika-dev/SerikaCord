"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getPrevNext } from "@/lib/constants/docs-nav";
import { ChevronLeft, ChevronRight, Info, AlertTriangle, AlertCircle, Copy, Check, Hash } from "lucide-react";
import { useState } from "react";
import { useGT } from "gt-next";

export function DocPage({
  title,
  description,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const gt = useGT();
  const pathname = usePathname();
  const slug = pathname?.replace("/developers/docs/", "") || "";
  const { prev, next } = getPrevNext(slug);

  return (
    <article>
      <header className="mb-8 pb-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-2 text-xs text-[#555] mb-3">
          <span>{gt("Docs")}</span>
          <ChevronRight className="size-3" />
          <span className="text-[#8B5CF6]">{title}</span>
        </div>
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 tracking-tight">{title}</h1>
        {description && <p className="text-[#949ba4] text-base leading-relaxed">{description}</p>}
      </header>
      <div className="text-[#dbdee1] text-[15px] leading-relaxed space-y-4 doc-content">
        {children}
      </div>

      {/* Prev/Next Nav */}
      <div className="mt-12 pt-6 border-t border-white/[0.06] flex items-center justify-between gap-4">
        {prev ? (
          <Link
            href={`/developers/docs/${prev.slug}`}
            className="flex items-center gap-3 text-sm text-[#949ba4] hover:text-white transition-colors group rounded-lg p-2 -ml-2 hover:bg-white/[0.03]"
          >
            <ChevronLeft className="size-5 group-hover:-translate-x-0.5 transition-transform shrink-0" />
            <div>
              <p className="text-xs text-[#555]">{gt("Previous")}</p>
              <p className="font-medium">{prev.label}</p>
            </div>
          </Link>
        ) : (
          <div />
        )}
        {next ? (
          <Link
            href={`/developers/docs/${next.slug}`}
            className="flex items-center gap-3 text-sm text-[#949ba4] hover:text-white transition-colors group text-right rounded-lg p-2 -mr-2 hover:bg-white/[0.03]"
          >
            <div>
              <p className="text-xs text-[#555]">{gt("Next")}</p>
              <p className="font-medium">{next.label}</p>
            </div>
            <ChevronRight className="size-5 group-hover:translate-x-0.5 transition-transform shrink-0" />
          </Link>
        ) : (
          <div />
        )}
      </div>
    </article>
  );
}

export function CodeBlock({ children, lang = "bash" }: { children: string; lang?: string }) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const langColors: Record<string, string> = {
    bash: "text-green-400",
    json: "text-amber-400",
    javascript: "text-yellow-400",
    typescript: "text-blue-400",
    python: "text-sky-400",
    sql: "text-pink-400",
  };
  return (
    <div className="my-4 rounded-xl border border-white/[0.08] overflow-hidden bg-[#0d0d0d]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono ${langColors[lang] || "text-[#666]"} uppercase tracking-wide`}>{lang}</span>
        </div>
        <button
          onClick={handleCopy}
          className="text-xs text-[#666] hover:text-white transition-colors flex items-center gap-1.5 px-2 py-1 rounded hover:bg-white/[0.06]"
        >
          {copied ? (
            <>
              <Check className="size-3 text-green-400" />
              <span className="text-green-400">{gt("Copied!")}</span>
            </>
          ) : (
            <>
              <Copy className="size-3" />
              <span>{gt("Copy")}</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px]">
        <code className={`language-${lang} font-mono text-[#dbdee1] leading-relaxed`}>{children}</code>
      </pre>
    </div>
  );
}

export function Endpoint({
  method,
  path,
  children,
}: {
  method: string;
  path: string;
  children: React.ReactNode;
}) {
  const methodColors: Record<string, string> = {
    GET: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    POST: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    PUT: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    PATCH: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    DELETE: "bg-red-500/15 text-red-400 border-red-500/30",
  };
  const methodBg: Record<string, string> = {
    GET: "from-emerald-500/[0.03]",
    POST: "from-sky-500/[0.03]",
    PUT: "from-amber-500/[0.03]",
    PATCH: "from-orange-500/[0.03]",
    DELETE: "from-red-500/[0.03]",
  };

  return (
    <div className={`my-4 rounded-xl border border-white/[0.08] overflow-hidden bg-gradient-to-r ${methodBg[method] || ""} to-[#111214]`}>
      <div className="flex items-center gap-3 bg-[#161719]/80 backdrop-blur-sm px-4 py-3 border-b border-white/[0.06]">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-md border ${methodColors[method] || "bg-white/10 text-white border-white/10"}`}>
          {method}
        </span>
        <code className="text-sm font-mono text-[#dbdee1] flex-1 min-w-0 break-all">{path}</code>
      </div>
      <div className="p-4 text-[13px] text-[#949ba4] leading-relaxed">{children}</div>
    </div>
  );
}

export function Callout({
  type = "info",
  title,
  children,
}: {
  type?: "info" | "warning" | "danger";
  title?: React.ReactNode;
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-[#5865F2]/25 bg-[#5865F2]/[0.07]",
    warning: "border-amber-500/25 bg-amber-500/[0.07]",
    danger: "border-red-500/25 bg-red-500/[0.07]",
  };
  const titleColors = {
    info: "text-[#7983f5]",
    warning: "text-amber-400",
    danger: "text-red-400",
  };
  const iconBg = {
    info: "bg-[#5865F2]/15 text-[#7983f5]",
    warning: "bg-amber-500/15 text-amber-400",
    danger: "bg-red-500/15 text-red-400",
  };
  const icons = {
    info: Info,
    warning: AlertTriangle,
    danger: AlertCircle,
  };
  const Icon = icons[type];

  return (
    <div className={`rounded-xl border p-4 my-4 ${styles[type]}`}>
      {title && (
        <p className={`text-sm font-semibold mb-1.5 flex items-center gap-2.5 ${titleColors[type]}`}>
          <span className={`size-6 rounded-lg ${iconBg[type]} flex items-center justify-center shrink-0`}>
            <Icon className="size-3.5" />
          </span>
          {title}
        </p>
      )}
      <div className={`text-[13px] text-[#949ba4] leading-relaxed ${title ? "pl-8.5" : ""}`}>{children}</div>
    </div>
  );
}

export function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto my-4 rounded-xl border border-white/[0.08]">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-white/[0.08] bg-white/[0.03]">
            {headers.map((h, i) => (
              <th key={i} className="text-left py-3 px-4 font-semibold text-[#949ba4] whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-b border-white/[0.04] last:border-0 hover:bg-white/[0.03] transition-colors ${i % 2 === 1 ? "bg-white/[0.01]" : ""}`}>
              {row.map((cell, j) => (
                <td key={j} className="py-2.5 px-4 text-[#dbdee1] align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} className="group text-xl font-bold text-white mt-10 mb-3 scroll-mt-20 tracking-tight flex items-center gap-2">
      {children}
      {id && (
        <a href={`#${id}`} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#555] hover:text-[#8B5CF6]">
          <Hash className="size-4" />
        </a>
      )}
    </h2>
  );
}

export function H3({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-base font-semibold text-white mt-6 mb-2 scroll-mt-20">
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] text-[#dbdee1] leading-relaxed my-3">{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
  return <ul className="text-[15px] text-[#dbdee1] list-disc list-inside space-y-1.5 my-3 pl-2">{children}</ul>;
}

export function InlineCode({ children }: { children: React.ReactNode }) {
  return <code className="bg-[#1e1f22] border border-white/[0.08] rounded-md px-1.5 py-0.5 text-[13px] font-mono text-[#a78bfa] inline-block">{children}</code>;
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="text-white font-semibold">{children}</strong>;
}

export function Link2({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[#8B5CF6] hover:underline decoration-[#8B5CF6]/30">
      {children}
    </Link>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-5">{children}</div>;
}

export function Card({
  href,
  title,
  children,
  icon,
  external,
}: {
  href: string;
  title: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
  external?: boolean;
}) {
  const inner = (
    <div className="group h-full rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04] hover:border-[#8B5CF6]/30 p-5 transition-all duration-200 hover:shadow-lg hover:shadow-[#8B5CF6]/[0.03]">
      <div className="flex items-center gap-2.5 mb-2">
        {icon && (
          <span className="size-9 rounded-lg bg-gradient-to-br from-[#8B5CF6]/20 to-[#6366f1]/20 flex items-center justify-center text-[#a78bfa] shrink-0 group-hover:scale-110 transition-transform">
            {icon}
          </span>
        )}
        <h3 className="text-sm font-semibold text-white group-hover:text-[#a78bfa] transition-colors">
          {title}
        </h3>
      </div>
      <p className="text-[13px] text-[#949ba4] leading-relaxed">{children}</p>
    </div>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="block h-full">
        {inner}
      </a>
    );
  }
  return (
    <Link href={href} className="block h-full">
      {inner}
    </Link>
  );
}

export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="my-5 space-y-4 counter-reset-step">{children}</ol>;
}

export function Step({ n, title, children }: { n: number; title: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="relative pl-12">
      <span className="absolute left-0 top-0 size-9 rounded-xl bg-gradient-to-br from-[#8B5CF6]/20 to-[#6366f1]/20 border border-[#8B5CF6]/30 text-[#a78bfa] text-sm font-bold flex items-center justify-center shadow-lg shadow-[#8B5CF6]/[0.05]">
        {n}
      </span>
      <h3 className="text-base font-semibold text-white mb-1 pt-1.5">{title}</h3>
      <div className="text-[14px] text-[#dbdee1] leading-relaxed space-y-2">{children}</div>
    </li>
  );
}
