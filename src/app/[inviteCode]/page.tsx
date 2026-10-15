"use client";

import { useState, useEffect, useCallback, useId, useRef } from "react";
import { cdnImage } from "@/lib/utils";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Users,
  Circle, 
  AlertCircle,
  MessageSquare,
  ArrowRight,
  Shield,
  ChevronLeft,
  Clock,
  CalendarDays,
  ScrollText,
} from "lucide-react";

import { ServerBadge } from "@/components/ui/badges";
import { ShareInviteButton } from "@/components/invite/ShareInviteButton";
import { useGT } from "gt-next";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ApplicationQuestionView, ServerConnectionView } from "@/hooks/useServerOnboarding";
import { decodeHtmlEntities } from "@/lib/chat/messages";
import {
  ApplicationQuestionFields,
  RulesList,
  ServerConnectionsList,
  firstMissingAnswer,
  focusQuestion,
  useEstablishedLabel,
} from "@/components/server/community/serverProfileBits";

interface InviteInfo {
  code: string;
  isMember?: boolean;
  server: {
    id: string;
    name: string;
    icon?: string;
    banner?: string;
    memberCount?: number;
    onlineCount?: number;
    description?: string;
    isPartnered?: boolean;
    joinMode?: string;
    createdAt?: string | null;
    connections?: ServerConnectionView[];
  };
  expiresAt?: string;
}

/** GET /api/servers/:id/application-form */
interface ApplicationForm {
  rules: string[];
  description: string;
  questions: ApplicationQuestionView[];
}

const LEGACY_APPLY_QUESTION = "Why would you like to join?";

import { isReservedSlug } from "@/lib/constants/reserved";
import { Loader } from "@/components/ui/Loader";
import { notifyServersChanged } from "@/lib/notifyServersChanged";

export default function InvitePage() {
  const router = useRouter();
  const params = useParams();
  const inviteCode = params.inviteCode as string;
  const gt = useGT();

  const formatExpiry = useCallback((expiresAt: string | undefined): string | null => {
    if (!expiresAt) return null;
    const exp = new Date(expiresAt);
    const now = new Date();
    const diff = exp.getTime() - now.getTime();
    if (diff <= 0) return gt("Expired");
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);
    if (days > 0) return gt("Expires in {days} days", { days });
    if (hours > 0) return gt("Expires in {hours} hours", { hours });
    const mins = Math.floor(diff / (1000 * 60));
    return gt("Expires in {mins} minutes", { mins });
  }, [gt]);

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [applyAnswer, setApplyAnswer] = useState("");
  const [isSubmittingApply, setIsSubmittingApply] = useState(false);
  // Apply to Join form: the server's rules + application questions.
  const [applyForm, setApplyForm] = useState<ApplicationForm | null>(null);
  const [applyFormLoading, setApplyFormLoading] = useState(false);
  const [applyAnswers, setApplyAnswers] = useState<Record<string, string>>({});
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});
  const [applyAgreed, setApplyAgreed] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const applyFormRef = useRef<HTMLDivElement>(null);
  const applyId = useId();
  const established = useEstablishedLabel(invite?.server.createdAt);

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch(`/api/invites/${inviteCode}`);
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || gt("Invite not found or has expired."));
        return;
      }
      const data = await res.json();
      setInvite(data);
    } catch {
      setError(gt("Failed to load invite. Please try again."));
    } finally {
      setIsLoading(false);
    }
  }, [inviteCode, gt]);

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

  useEffect(() => {
    handleJoinRef.current = handleJoin;
  });

  const navigateTo = useCallback((target: string) => {
    if (typeof window !== "undefined" && window.location.hostname !== "serika.chat") {
      window.location.href = `https://serika.chat${target}`;
    } else {
      router.push(target);
    }
  }, [router]);

  // Links like serika.cc/<code>?join=1 (homepage partner cards) join in one
  // step for signed-in visitors instead of waiting for a click.
  const autoJoinTried = useRef(false);
  useEffect(() => {
    if (autoJoinTried.current || !invite || isAuthenticated !== true || invite.isMember) return;
    if (typeof window === "undefined" || new URLSearchParams(window.location.search).get("join") !== "1") return;
    if (invite.server.joinMode === "apply_to_join") return;
    autoJoinTried.current = true;
    const timer = setTimeout(() => void handleJoinRef.current?.(), 0);
    return () => clearTimeout(timer);
  }, [invite, isAuthenticated]);
  const handleJoinRef = useRef<(() => Promise<void>) | null>(null);

  const handleJoin = async () => {
    // Already a member — just open the server instead of pretending to join.
    if (invite?.isMember) {
      navigateTo(invite.server.id ? `/channels/${invite.server.id}` : "/channels/me");
      return;
    }

    if (!isAuthenticated) {
      // Come back with ?join=1 so the join finishes right after signing in.
      const loginUrl = `/login?redirect=${encodeURIComponent(`/${inviteCode}?join=1`)}`;
      if (typeof window !== "undefined" && window.location.hostname !== "serika.chat") {
        window.location.href = `https://serika.chat${loginUrl}`;
      } else {
        router.push(loginUrl);
      }
      return;
    }

    if (invite?.server.joinMode === "apply_to_join") {
      void openApplyDialog(invite.server.id);
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      const res = await fetch(`/api/invites/${inviteCode}`, { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (res.status === 400 && data.error?.includes("Already a member")) {
          navigateTo(invite?.server.id ? `/channels/${invite.server.id}` : "/channels/me");
          return;
        }
        setError(data.error || gt("Failed to join server."));
        return;
      }

      // Tell any already-open app tab/route to refresh its server rail so the
      // newly joined server shows up instantly (esp. same-host client nav).
      notifyServersChanged();

      const target = data.server?.id ? `/channels/${data.server.id}` : "/channels/me";
      navigateTo(target);
    } catch {
      setError(gt("Something went wrong. Please try again."));
    } finally {
      setIsJoining(false);
    }
  };

  const openApplyDialog = async (serverId: string) => {
    setShowApplyDialog(true);
    setApplyAnswer("");
    setApplyAnswers({});
    setApplyErrors({});
    setApplyAgreed(false);
    setApplyError(null);
    setApplyForm(null);
    setApplyFormLoading(true);
    try {
      const res = await fetch(`/api/servers/${serverId}/application-form`, { credentials: "include" });
      const data = res.ok ? ((await res.json()) as Partial<ApplicationForm>) : null;
      setApplyForm({
        rules: Array.isArray(data?.rules) ? data.rules : [],
        description: typeof data?.description === "string" ? data.description : "",
        questions: Array.isArray(data?.questions) ? data.questions : [],
      });
    } catch {
      // Fall back to the free-form question.
      setApplyForm({ rules: [], description: "", questions: [] });
    } finally {
      setApplyFormLoading(false);
    }
  };

  const applyQuestions = applyForm?.questions ?? [];
  const applyRules = applyForm?.rules ?? [];
  const applyReady = Boolean(applyForm) && !applyFormLoading
    && (applyRules.length === 0 || applyAgreed)
    && (applyQuestions.length > 0 ? !firstMissingAnswer(applyQuestions, applyAnswers) : applyAnswer.trim().length > 0);

  const setApplyQuestionAnswer = (questionId: string, value: string) => {
    setApplyAnswers((prev) => ({ ...prev, [questionId]: value }));
    if (applyErrors[questionId]) {
      setApplyErrors((prev) => {
        const next = { ...prev };
        delete next[questionId];
        return next;
      });
    }
  };

  const handleSubmitApplication = async () => {
    if (!invite || !applyForm) return;
    const missing = firstMissingAnswer(applyQuestions, applyAnswers);
    if (missing) {
      setApplyErrors({ [missing]: gt("This question is required.") });
      focusQuestion(applyFormRef.current, missing);
      return;
    }
    setIsSubmittingApply(true);
    setApplyError(null);
    try {
      const answers = applyQuestions.length > 0
        ? applyQuestions.map((q) => ({ questionId: q.id, answer: (applyAnswers[q.id] ?? "").trim() }))
        : [{ question: LEGACY_APPLY_QUESTION, answer: applyAnswer.trim() }];
      const res = await fetch(`/api/servers/${invite.server.id}/applications`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, acceptRules: true }),
      });
      if (res.ok) {
        setShowApplyDialog(false);
        setApplyAnswer("");
        setApplyAnswers({});
        setError(gt("Application submitted! You will be notified when it is reviewed."));
      } else {
        const data = await res.json().catch(() => ({}));
        const message = typeof data.error === "string" && data.error ? data.error : gt("Failed to submit application.");
        if (typeof data.questionId === "string" && applyQuestions.some((q) => q.id === data.questionId)) {
          setApplyErrors({ [data.questionId]: message });
          focusQuestion(applyFormRef.current, data.questionId);
        } else {
          setApplyError(message);
        }
      }
    } catch {
      setApplyError(gt("Failed to submit application."));
    } finally {
      setIsSubmittingApply(false);
    }
  };

  const expiry = invite?.expiresAt ? formatExpiry(invite.expiresAt) : null;
  const isExpired = expiry === gt("Expired");
  const banner = invite?.server.banner;

  // Show 404 for reserved slugs (real routes / branding names)
  if (inviteCode && isReservedSlug(inviteCode)) {
    return (
      <div className="min-h-screen bg-[var(--app-bg)] flex flex-col items-center justify-center px-4 text-center">
        <p className="text-8xl font-extrabold text-white/5 select-none mb-6">404</p>
        <h1 className="text-2xl font-bold text-white mb-2">{gt("Page Not Found")}</h1>
        <p className="text-[var(--app-muted)] text-sm mb-8">{gt("This page doesn't exist or you don't have access to it.")}</p>
        <Link href="/" className="px-6 py-3 bg-[var(--accent-color)] hover:brightness-110 text-white font-medium rounded-lg transition-all text-sm">
          {gt("Go Home")}
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
          {gt("Back to SerikaCord")}
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
              <Loader size={32} />
            </div>
            <p className="text-[var(--app-muted)] text-sm">{gt("Loading invite...")}</p>
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
                {gt("Invite Invalid")}
              </h1>
              <p className="text-[var(--app-muted)] text-sm leading-relaxed">{error}</p>
            </div>
            <Link
              href="/channels/me"
              className="px-6 py-3 bg-[var(--accent-color)] hover:brightness-110 text-white font-medium rounded-lg transition-all text-sm"
            >
              {gt("Open SerikaCord")}
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
                      src={cdnImage(invite.server.icon)}
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
                    {invite.isMember ? gt("You're already a member of") : gt("You've been invited to join")}
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
                        {gt("Online")}
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
                        {gt("Members")}
                      </span>
                    </div>
                  )}
                </motion.div>

                {/* Established + the owner's linked accounts */}
                {established && (
                  <div className="flex items-center gap-1.5 mt-3 text-xs text-[var(--app-muted-2)]">
                    <CalendarDays className="w-3.5 h-3.5" />
                    {established}
                  </div>
                )}
                {invite.server.connections && invite.server.connections.length > 0 && (
                  <ServerConnectionsList connections={invite.server.connections} variant="chips" className="mt-3" />
                )}

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
                    disabled={isJoining || (isExpired && !invite.isMember)}
                    className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-[var(--accent-color)] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all text-sm"
                  >
                    {isJoining ? (
                      <>
                        <Loader size={16} />
                        {gt("Joining...")}
                      </>
                    ) : invite.isMember ? (
                      <>
                        {gt("Open Server")}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : isExpired ? (
                      gt("Invite Expired")
                    ) : isAuthenticated === false ? (
                      <>
                        {gt("Sign in to Join")}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : invite.server.joinMode === "apply_to_join" ? (
                      <>
                        {gt("Apply to Join")}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    ) : (
                      <>
                        {gt("Accept Invite")}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </motion.button>

                  {!isExpired && (
                    <ShareInviteButton
                      inviteCode={inviteCode}
                      serverId={invite.server.id}
                      serverName={invite.server.name}
                    />
                  )}

                  {!isAuthenticated && !isExpired && (
                    <p className="text-center text-xs text-[var(--app-muted-2)]">
                      {gt("Don't have an account?")}{" "}
                      <Link
                        href={`/register?redirect=/${inviteCode}`}
                        className="text-[var(--accent-color)] hover:underline"
                      >
                        {gt("Create one free")}
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
              <span>{gt("SerikaCord")}</span>
              <span className="text-[var(--app-border)]">·</span>
              <Shield className="w-3.5 h-3.5" />
              <span>{gt("Safe & Secure")}</span>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {invite && (
        <Dialog open={showApplyDialog} onOpenChange={(next) => { if (!isSubmittingApply) setShowApplyDialog(next); }}>
          <DialogContent className="p-0 gap-0 overflow-hidden sm:max-w-lg max-h-[90dvh] flex flex-col bg-[var(--app-surface)] border-[var(--app-border)] max-sm:overflow-hidden">
            <div className="px-6 pt-6 pb-3 shrink-0">
              <DialogTitle className="text-xl font-bold text-[var(--app-text)] pr-8">
                {gt("Apply to join {name}", { name: invite.server.name })}
              </DialogTitle>
              <DialogDescription className="text-sm text-[var(--app-muted)] mt-1 whitespace-pre-wrap">
                {applyForm?.description
                  ? decodeHtmlEntities(applyForm.description)
                  : gt("This server requires an application. Tell them a bit about yourself.")}
              </DialogDescription>
            </div>

            <div ref={applyFormRef} className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-4">
              {applyFormLoading || !applyForm ? (
                <div className="flex justify-center py-10">
                  <Loader size={28} />
                </div>
              ) : (
                <>
                  {applyRules.length > 0 && (
                    <section className="rounded-xl bg-[var(--app-surface-alt)] border border-[var(--app-border)] p-4" aria-labelledby={`${applyId}-rules`}>
                      <h4 id={`${applyId}-rules`} className="flex items-center gap-2 text-sm font-semibold text-[var(--app-text)] mb-3">
                        <ScrollText className="w-4 h-4 text-[var(--app-accent)]" />
                        {gt("Server Rules")}
                      </h4>
                      <RulesList rules={applyRules} />
                    </section>
                  )}
                  {applyQuestions.length > 0 ? (
                    <ApplicationQuestionFields
                      questions={applyQuestions}
                      answers={applyAnswers}
                      onChange={setApplyQuestionAnswer}
                      errors={applyErrors}
                      idPrefix={applyId}
                      disabled={isSubmittingApply}
                    />
                  ) : (
                    <div>
                      <label htmlFor={`${applyId}-why`} className="mb-2 block text-sm font-semibold text-[var(--app-text)]">
                        {gt("Why would you like to join?")}
                      </label>
                      <textarea
                        id={`${applyId}-why`}
                        value={applyAnswer}
                        onChange={(e) => setApplyAnswer(e.target.value)}
                        placeholder={gt("Tell the moderators a bit about yourself.")}
                        rows={4}
                        maxLength={2000}
                        disabled={isSubmittingApply}
                        className="w-full p-3 rounded-lg bg-[var(--app-surface-alt)] border border-[var(--app-border)] text-sm text-[var(--app-text)] placeholder:text-[var(--app-muted)] outline-none focus:border-[var(--app-accent)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/40 resize-none"
                      />
                    </div>
                  )}
                  {applyRules.length > 0 && (
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-surface-alt)] text-sm text-[var(--app-text)] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={applyAgreed}
                        onChange={(e) => setApplyAgreed(e.target.checked)}
                        className="mt-0.5 w-5 h-5 shrink-0 accent-[var(--app-accent)]"
                      />
                      <span>{gt("I have read and agree to the rules")}</span>
                    </label>
                  )}
                  {applyError && (
                    <div role="alert" className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-500">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{applyError}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="shrink-0 flex justify-end gap-3 px-6 py-4 pb-[max(1rem,var(--safe-area-bottom,0px))] border-t border-[var(--app-border)] bg-[var(--app-surface-alt)]">
              <button
                type="button"
                onClick={() => setShowApplyDialog(false)}
                disabled={isSubmittingApply}
                className="h-10 px-4 text-sm text-[var(--app-text)] hover:bg-[var(--app-surface)] rounded-lg transition-colors"
              >
                {gt("Cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmitApplication()}
                disabled={!applyReady || isSubmittingApply}
                className="h-10 px-4 bg-[var(--app-accent)] hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-all"
              >
                {isSubmittingApply ? gt("Submitting...") : gt("Submit Application")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
