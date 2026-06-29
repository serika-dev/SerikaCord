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
  Clock,
  Shield,
  ChevronLeft,
} from "lucide-react";

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
      router.push(`/login?redirect=/${inviteCode}`);
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      const res = await fetch(`/api/invites/${inviteCode}`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 400 && data.error?.includes("Already a member")) {
          if (invite?.server._id) {
            router.push(`/channels/${invite.server._id}`);
          } else {
            router.push("/channels/me");
          }
          return;
        }
        setError(data.error || "Failed to join server.");
        return;
      }

      if (data.server?.id) {
        router.push(`/channels/${data.server.id}`);
      } else {
        router.push("/channels/me");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsJoining(false);
    }
  };

  const expiry = invite?.expiresAt ? formatExpiry(invite.expiresAt) : null;
  const isExpired = expiry === "Expired";

  return (
    <div className="min-h-screen bg-[#05060a] flex flex-col items-center justify-center px-4 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full opacity-20"
          style={{
            background:
              "radial-gradient(circle, rgba(124,140,255,0.4) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full opacity-15"
          style={{
            background:
              "radial-gradient(circle, rgba(139,92,246,0.4) 0%, transparent 70%)",
          }}
        />
      </div>

      {/* Back to home */}
      <div className="absolute top-6 left-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-sm text-[#8d97ad] hover:text-[#d5d9e8] transition-colors"
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
            className="flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-[#0c0f17] border border-[#1e2637] flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-[#7c8cff] animate-spin" />
            </div>
            <p className="text-[#8d97ad] text-sm">Loading invite...</p>
          </motion.div>
        ) : error && !invite ? (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 text-center max-w-sm"
          >
            <div className="w-20 h-20 rounded-2xl bg-[#0c0f17] border border-[#1e2637] flex items-center justify-center">
              <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#d5d9e8] mb-2">
                Invite Invalid
              </h1>
              <p className="text-[#8d97ad] text-sm leading-relaxed">{error}</p>
            </div>
            <Link
              href="/channels/me"
              className="px-6 py-3 bg-[#7c8cff] hover:bg-[#6a7aef] text-white font-medium rounded-lg transition-colors text-sm"
            >
              Open SerikaCord
            </Link>
          </motion.div>
        ) : invite ? (
          <motion.div
            key="invite"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="w-full max-w-md"
          >
            {/* Card */}
            <div className="bg-[#0c0f17] border border-[#1e2637] rounded-2xl overflow-hidden shadow-2xl">
              {/* Server banner */}
              <div className="relative h-28 bg-gradient-to-br from-[#1e2637] to-[#0c0f17]">
                {invite.server.banner && (
                  <Image
                    src={invite.server.banner}
                    alt=""
                    fill
                    className="object-cover"
                    unoptimized
                  />
                )}
                {!invite.server.banner && (
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(124,140,255,0.3) 0%, rgba(139,92,246,0.2) 50%, rgba(30,38,55,0.8) 100%)",
                    }}
                  />
                )}
                {/* Server icon overlapping banner */}
                <div className="absolute -bottom-8 left-6">
                  <div className="w-16 h-16 rounded-2xl border-4 border-[#0c0f17] overflow-hidden bg-[#131a28] flex items-center justify-center shadow-lg">
                    {invite.server.icon ? (
                      <Image
                        src={invite.server.icon}
                        alt={invite.server.name}
                        width={64}
                        height={64}
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <span className="text-xl font-bold text-white">
                        {invite.server.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="pt-10 px-6 pb-6">
                {/* Header */}
                <div className="mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#7c8cff] mb-1">
                    You&apos;ve been invited to join
                  </p>
                  <h1 className="text-2xl font-bold text-[#d5d9e8] leading-tight">
                    {invite.server.name}
                  </h1>
                </div>

                {/* Description */}
                {invite.server.description && (
                  <p className="text-sm text-[#8d97ad] mt-2 leading-relaxed line-clamp-2">
                    {invite.server.description}
                  </p>
                )}

                {/* Stats */}
                <div className="flex items-center gap-4 mt-4">
                  {invite.server.onlineCount !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <Circle className="w-2.5 h-2.5 fill-[#23d160] text-[#23d160]" />
                      <span className="text-sm text-[#8d97ad]">
                        <span className="text-[#d5d9e8] font-medium">
                          {invite.server.onlineCount.toLocaleString()}
                        </span>{" "}
                        Online
                      </span>
                    </div>
                  )}
                  {invite.server.memberCount !== undefined && (
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-[#6b7387]" />
                      <span className="text-sm text-[#8d97ad]">
                        <span className="text-[#d5d9e8] font-medium">
                          {invite.server.memberCount.toLocaleString()}
                        </span>{" "}
                        Members
                      </span>
                    </div>
                  )}
                </div>

                {/* Expiry */}
                {expiry && (
                  <div
                    className={`flex items-center gap-1.5 mt-3 text-xs ${
                      isExpired ? "text-[#ef4444]" : "text-[#6b7387]"
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
                <div className="mt-5 flex flex-col gap-2">
                  <button
                    onClick={handleJoin}
                    disabled={isJoining || isExpired}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[#7c8cff] hover:bg-[#6a7aef] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all active:scale-[0.98] text-sm"
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
                  </button>

                  {!isAuthenticated && !isExpired && (
                    <p className="text-center text-xs text-[#6b7387]">
                      Don&apos;t have an account?{" "}
                      <Link
                        href={`/register?redirect=/${inviteCode}`}
                        className="text-[#7c8cff] hover:underline"
                      >
                        Create one free
                      </Link>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Brand footer */}
            <div className="flex items-center justify-center gap-2 mt-6 text-sm text-[#6b7387]">
              <div className="w-5 h-5 rounded-md bg-[#7c8cff] flex items-center justify-center">
                <MessageSquare className="w-3 h-3 text-white" />
              </div>
              <span>SerikaCord</span>
              <span className="text-[#1e2637]">·</span>
              <Shield className="w-3.5 h-3.5" />
              <span>Safe & Secure</span>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
