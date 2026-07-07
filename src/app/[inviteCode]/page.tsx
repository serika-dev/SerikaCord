"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Circle,
  Loader2,
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Shield,
  ChevronLeft,
  Clock,
} from "lucide-react";

import { ServerBadge } from "@/components/ui/badges";
import { ShareInviteButton } from "@/components/invite/ShareInviteButton";

interface InviteInfo {
  code: string;
  server: {
    _id: string;
    name: string;
    icon?: string;
    banner?: string;
    memberCount?: number;
    onlineCount?: number;
    description?: string;
    isPartnered?: boolean;
  };
  expiresAt?: string;
}

function formatExpiry(expiresAt: string | undefined): string | null {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  if (diff <= 0) return "Expired";
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  if (days > 0) return `Expires in ${days} day${days > 1 ? "s" : ""}`;
  if (hours > 0) return `Expires in ${hours} hour${hours > 1 ? "s" : ""}`;
  const mins = Math.floor(diff / (1000 * 60));
  return `Expires in ${mins} minute${mins > 1 ? "s" : ""}`;
}

import { isReservedSlug } from "@/lib/constants/reserved";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.inviteCode as string;

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch(`/api/invites/${inviteCode}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Invite not found or has expired.");
        return;
      }
      const data = await res.json();
      setInvite(data);
    } catch {
      setError("Failed to load invite. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [inviteCode]);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/users/me");
      setIsAuthenticated(res.ok);
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    fetchInvite();
    checkAuth();
  }, [fetchInvite, checkAuth]);

  const handleJoin = async () => {
    if (!isAuthenticated) {
      const loginUrl = `/login?redirect=/${inviteCode}`;
      if (typeof window !== "undefined" && window.location.hostname !== "serika.chat") {
        window.location.href = `https://serika.chat${loginUrl}`;
      } else {
        router.push(loginUrl);
      }
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      const res = await fetch(`/api/invites/${inviteCode}`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 400 && data.error?.includes("Already a member")) {
          const target = invite?.server._id ? `/channels/${invite.server._id}` : "/channels/me";
          if (typeof window !== "undefined" && window.location.hostname !== "serika.chat") {
            window.location.href = `https://serika.chat${target}`;
          } else {
            router.push(target);
          }
          return;
        }
        setError(data.error || "Failed to join server.");
        return;
      }

      const target = data.server?.id ? `/channels/${data.server.id}` : "/channels/me";
      if (typeof window !== "undefined" && window.location.hostname !== "serika.chat") {
        window.location.href = `https://serika.chat${target}`;
      } else {
        router.push(target);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  const expiry = invite?.expiresAt ? formatExpiry(invite.expiresAt) : null;
  const isExpired = expiry === "Expired";
  const banner = invite?.server.banner;

  // Show 404 for reserved slugs (real routes / branding names)
  if (inviteCode && isReservedSlug(inviteCode)) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center px-4 text-center">
        <p className="text-8xl font-extrabold text-white/5 select-none mb-6">404</p>
        <h1 className="text-2xl font-bold text-white mb-2">Page Not Found</h1>
        <p className="text-[var(--app-muted)] text-sm mb-8">This page doesn&apos;t exist or you don&apos;t have access to it.</p>
        <Link href="/" className="px-6 py-3 bg-[var(--accent-color)] hover:brightness-110 text-white font-medium rounded-lg transition-all text-sm">
          Go Home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Full-bleed background: server banner, blurred + darkened */}
      <div className="fixed inset-0 pointer-events-none">
        {banner ? (
          <>
            <div
              className="absolute inset-0 bg-cover bg-center scale-110"
              style={{
                backgroundImage: `url(${banner})`,
                filter: "blur(36px) saturate(1.2)",
                transform: "scale(1.15)",
              }}
            />
            <div className="absolute inset-0 bg-[var(--app-bg)]/70" />
            <div className="absolute inset-0 bg-gradient-to-b from-[var(--app-bg)]/40 via-transparent to-[var(--app-bg)]" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 30% 20%, color-mix(in srgb, var(--accent-color) 22%, transparent) 0%, transparent 55%), radial-gradient(circle at 75% 75%, color-mix(in srgb, var(--app-accent) 20%, transparent) 0%, transparent 55%), var(--app-bg)",
            }}
          />
        )}
        {/* Floating glow orbs for depth, layered above the banner */}
        <motion.div
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-25"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--accent-color) 45%, transparent) 0%, transparent 70%)" }}
          animate={{ x: [0, 30, 0], y: [0, 20, 0] }}
          transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -bottom-40 -right-24 w-[440px] h-[440px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.5) 0%, transparent 70%)" }}
          animate={{ x: [0, -20, 0], y: [0, -25, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      {/* Back to home */}
      <div className="absolute top-6 left-6 z-10">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-[var(--app-muted)] hover:text-[var(--app-text)] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to SerikaCord
        </Link>
      </div>

      <AnimatePresence mode="wait">
        {isLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-[var(--app-surface)]/80 backdrop-blur-xl border border-[var(--app-border)] flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[var(--accent-color)] animate-spin" />
            </div>
            <p className="text-[var(--app-muted)] text-sm">Loading invite...</p>
          </motion.div>
        ) : error && !invite ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="relative z-10 flex flex-col items-center gap-6 text-center max-w-sm"
          >
            <div className="w-20 h-20 rounded-2xl bg-[var(--app-surface)]/80 backdrop-blur-xl border border-[var(--app-border)] flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[var(--app-text)] mb-2">
                Invite Invalid
              </h1>
              <p className="text-[var(--app-muted)] text-sm leading-relaxed">{error}</p>
            </div>
            <Link
              href="/channels/me"
              className="px-6 py-3 bg-[var(--accent-color)] hover:brightness-110 text-white font-medium rounded-lg transition-all text-sm"
            >
              Open SerikaCord
            </Link>
          </motion.div>
        ) : invite ? (
          <motion.div
            key="invite"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-md"
          >
            {/* Card */}
            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
              className="bg-[var(--app-surface)]/70 backdrop-blur-2xl border border-[var(--app-border)]/80 rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="pt-8 px-6 pb-6">
                {/* Icon */}
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.4, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
                  className="w-20 h-20 rounded-3xl overflow-hidden bg-[var(--app-surface-alt)] flex items-center justify-center shrink-0"
                  style={{
                    boxShadow:
                      "0 0 0 4px color-mix(in srgb, var(--accent-color) 25%, transparent), 0 12px 30px -8px color-mix(in srgb, var(--accent-color) 45%, transparent)",
                  }}
                >
                  {invite.server.icon ? (
                    <Image
                      src={invite.server.icon}
                      alt={invite.server.name}
                      width={80}
                      height={80}
                      className="object-cover w-full h-full"
                      unoptimized
                    />
                  ) : (
                    <span className="text-3xl font-bold text-white">
                      {invite.server.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </motion.div>

                {/* Header */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.18 }}
                  className="mt-4"
                >
                  <p className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-color)] mb-1">
                    You&apos;ve been invited to join
                  </p>
                  <div className="flex items-center gap-2">
                    {invite.server.isPartnered && <ServerBadge type="partnered" size="md" iconOnly />}
                    <h1 className="text-2xl font-bold text-[var(--app-text)] leading-tight">
                      {invite.server.name}
                    </h1>
                  </div>
                </motion.div>

                {/* Description */}
                {invite.server.description && (
                  <p className="text-sm text-[var(--app-muted)] mt-2 leading-relaxed line-clamp-2">
                    {invite.server.description}
                  </p>
                )}

                {/* Stats */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.35, delay: 0.24 }}
                  className="flex items-center gap-4 mt-4"
                >
                  {invite.server.onlineCount !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <span className="relative flex w-2.5 h-2.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#23d160] opacity-60" />
                        <Circle className="relative w-2.5 h-2.5 fill-[#23d160] text-[#23d160]" />
                      </span>
                      <span className="text-sm text-[var(--app-muted)]">
                        <span className="text-[var(--app-text)] font-medium">
                          {invite.server.onlineCount.toLocaleString()}
                        </span>{" "}
                        Online
                      </span>
                    </div>
                  )}
                  {invite.server.memberCount !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[var(--app-muted-2)]" />
                      <span className="text-sm text-[var(--app-muted)]">
                        <span className="text-[var(--app-text)] font-medium">
                          {invite.server.memberCount.toLocaleString()}
                        </span>{" "}
                        Members
                      </span>
                    </div>
                  )}
                </motion.div>

                {/* Expiry */}
                {expiry && (
                  <div
                    className={`flex items-center gap-1.5 mt-3 text-xs ${
                      isExpired ? "text-[#ef4444]" : "text-[var(--app-muted-2)]"
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5" />
                    {expiry}
                  </div>
                )}

                {/* Error */}
                {error && (
                  <div className="mt-4 flex items-center gap-2 p-3 bg-[#ef4444]/10 border border-[#ef4444]/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-[#ef4444] shrink-0" />
                    <p className="text-sm text-[#ef4444]">{error}</p>
                  </div>
                )}

                {/* CTA */}
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.3 }}
                  className="mt-5 flex flex-col gap-2"
                >
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleJoin}
                    disabled={isJoining || isExpired}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[var(--accent-color)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm"
                  >
                    {isJoining ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Joining...
                      </>
                    ) : isExpired ? (
                      "Invite Expired"
                    ) : isAuthenticated === false ? (
                      <>
                        Sign in to Join
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        Accept Invite
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </motion.button>

                  {!isExpired && (
                    <ShareInviteButton
                      inviteCode={inviteCode}
                      serverId={invite.server._id}
                      serverName={invite.server.name}
                    />
                  )}

                  {!isAuthenticated && !isExpired && (
                    <p className="text-center text-xs text-[var(--app-muted-2)]">
                      Don&apos;t have an account?{" "}
                      <Link
                        href={`/register?redirect=/${inviteCode}`}
                        className="text-[var(--accent-color)] hover:underline"
                      >
                        Create one free
                      </Link>
                    </p>
                  )}
                </motion.div>
              </div>
            </motion.div>

            {/* Brand footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.4 }}
              className="flex items-center justify-center gap-2 mt-6 text-sm text-[var(--app-muted-2)]"
            >
              <div className="w-5 h-5 rounded-md bg-[var(--app-accent)] flex items-center justify-center">
                <MessageSquare className="w-3 h-3 text-white" />
              </div>
              <span>SerikaCord</span>
              <span className="text-[var(--app-border)]">·</span>
              <Shield className="w-3.5 h-3.5" />
              <span>Safe & Secure</span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
