"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { QrCode, ShieldCheck, ShieldX, CheckCircle2, AlertTriangle } from "lucide-react";
import { T, useGT, useLocale } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";

type ViewState = "checking" | "confirm" | "approving" | "approved" | "denied" | "error";

/** The device asking to sign in, as reported by POST /api/auth/qr/:token/scan. */
type RequestingDevice = { browser: string | null; os: string | null; country: string | null };

function countryName(code: string | null, locale: string): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export default function QRApprovePage() {
  const gt = useGT();
  const router = useRouter();
  const params = useParams();
  const token = String(params?.token || "");
  const locale = useLocale();
  const { user, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<ViewState>("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [device, setDevice] = useState<RequestingDevice | null>(null);

  // Redirect to login if not authenticated (come back here after).
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/qr/${token}`)}`);
      return;
    }
    // Ping the server that the code was scanned so the waiting device updates.
    // The answer also says which device is asking, shown before approving.
    fetch(`/api/auth/qr/${token}/scan`, { method: "POST" })
      .then(async (r) => {
        if (r.status === 404) {
          setView("error");
          setErrorMsg(gt("This QR code has expired. Generate a new one on the other device."));
          return;
        }
        const data = await r.json().catch(() => ({}));
        if (data && typeof data === "object" && data.device && typeof data.device === "object") {
          const d = data.device as Record<string, unknown>;
          setDevice({
            browser: typeof d.browser === "string" ? d.browser : null,
            os: typeof d.os === "string" ? d.os : null,
            country: typeof d.country === "string" ? d.country : null,
          });
        }
        setView("confirm");
      })
      .catch(() => setView("confirm"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, token]);

  const approve = async () => {
    setView("approving");
    try {
      const res = await fetch(`/api/auth/qr/${token}/approve`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setView("error");
        setErrorMsg(data.error || gt("Could not approve this login."));
        return;
      }
      setView("approved");
    } catch {
      setView("error");
      setErrorMsg(gt("Could not approve this login."));
    }
  };

  const deny = async () => {
    try {
      await fetch(`/api/auth/qr/${token}/deny`, { method: "POST" });
    } catch {
      /* best effort */
    }
    setView("denied");
  };

  const deviceLine = device?.browser && device?.os
    ? gt("Signing in on {browser} on {os}", { browser: device.browser, os: device.os })
    : device?.browser || device?.os
      ? gt("Signing in on {device}", { device: device.browser || device.os || "" })
      : gt("Signing in on an unknown device");
  const country = countryName(device?.country ?? null, locale);

  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-[#0d0d0d]/90 border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/60 text-center">
        {view === "checking" || authLoading ? (
          <div className="py-8 flex flex-col items-center gap-4">
            <Loader size={28} />
            <p className="text-[#888888] text-sm">
              <T>Checking this login request…</T>
            </p>
          </div>
        ) : view === "confirm" || view === "approving" ? (
          <>
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-[#8B5CF6]/15 flex items-center justify-center">
              <QrCode className="w-8 h-8 text-[#8B5CF6]" />
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">
              <T>Approve login?</T>
            </h1>
            <p className="text-[#888888] text-sm mb-4 leading-relaxed">
              <T>
                A device is trying to sign in to your SerikaCord account. Only
                approve this if it&apos;s you.
              </T>
            </p>
            <div className="mb-4 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-left">
              <p className="text-white text-sm font-medium">{deviceLine}</p>
              {country && (
                <p className="text-[#888888] text-xs mt-1">{gt("Location: {country}", { country })}</p>
              )}
            </div>
            <div className="mb-6 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-left">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" aria-hidden />
              <p className="text-amber-200 text-xs leading-relaxed">
                {gt("Only approve if you're signing in yourself right now. Never approve a link someone sent you.")}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={approve}
                disabled={view === "approving"}
                className="w-full h-11 inline-flex items-center justify-center gap-2 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-semibold rounded-xl transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50"
              >
                {view === "approving" ? (
                  <Loader size={16} />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    {gt("Yes, it's me")}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={deny}
                disabled={view === "approving"}
                className="w-full h-11 inline-flex items-center justify-center gap-2 bg-transparent border border-white/[0.1] hover:bg-white/[0.04] text-[#b5b5c0] font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                <ShieldX className="w-4 h-4" />
                {gt("This wasn't me")}
              </button>
            </div>
          </>
        ) : view === "approved" ? (
          <div className="py-6 flex flex-col items-center gap-4">
            <CheckCircle2 className="w-16 h-16 text-emerald-400" />
            <h1 className="text-xl font-semibold text-white">
              <T>Login approved</T>
            </h1>
            <p className="text-[#888888] text-sm">
              <T>You can head back to the other device now.</T>
            </p>
            <button
              type="button"
              onClick={() => router.replace("/channels/me")}
              className="mt-2 text-sm text-[#8B5CF6] hover:text-[#A78BFA] font-medium"
            >
              <T>Back to SerikaCord</T>
            </button>
          </div>
        ) : view === "denied" ? (
          <div className="py-6 flex flex-col items-center gap-4">
            <ShieldX className="w-16 h-16 text-[#888888]" />
            <h1 className="text-xl font-semibold text-white">
              <T>Login rejected</T>
            </h1>
            <p className="text-[#888888] text-sm">
              <T>The sign-in request was cancelled. Nothing was shared.</T>
            </p>
          </div>
        ) : (
          <div className="py-6 flex flex-col items-center gap-4">
            <AlertTriangle className="w-16 h-16 text-amber-400" />
            <h1 className="text-xl font-semibold text-white">
              <T>Something went wrong</T>
            </h1>
            <p className="text-[#888888] text-sm">{errorMsg}</p>
          </div>
        )}
      </div>
    </div>
  );
}
