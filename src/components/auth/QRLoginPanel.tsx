"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { RefreshCw, Smartphone, CheckCircle2 } from "lucide-react";
import { T, useGT } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";

type QrStatus = "loading" | "pending" | "scanned" | "approved" | "expired" | "error";

interface QRLoginPanelProps {
  /** Where to send the user once the QR login is approved. */
  redirectTo: string;
  /** Called with the router replace target once approved. */
  onApproved: (redirectTo: string) => void;
}

/**
 * Shows a QR code that an already-authenticated device (phone) can open to log
 * this device in. Polls the QR status endpoint; on approval the server sets the
 * auth cookies and we refresh the session + navigate.
 */
export function QRLoginPanel({ redirectTo, onApproved }: QRLoginPanelProps) {
  const gt = useGT();
  const { refresh } = useAuth();
  const [status, setStatus] = useState<QrStatus>("loading");
  const [qrImage, setQrImage] = useState<string>("");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);

  const clearPoll = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(
    async (token: string, intervalMs: number) => {
      if (stoppedRef.current || tokenRef.current !== token) return;
      try {
        const res = await fetch(`/api/auth/qr/${token}/status`);
        const data = await res.json().catch(() => ({}));
        if (stoppedRef.current || tokenRef.current !== token) return;

        if (res.status === 404 || data.status === "expired") {
          setStatus("expired");
          clearPoll();
          return;
        }
        if (data.status === "approved") {
          setStatus("approved");
          clearPoll();
          // Cookies were set by the status response; sync the session then go.
          await refresh();
          onApproved(redirectTo);
          return;
        }
        if (data.status === "scanned") {
          setStatus("scanned");
        } else {
          setStatus("pending");
        }
      } catch {
        // Transient network error — keep polling.
      }
      pollTimer.current = setTimeout(() => poll(token, intervalMs), intervalMs);
    },
    [clearPoll, onApproved, redirectTo, refresh]
  );

  const start = useCallback(async () => {
    clearPoll();
    setStatus("loading");
    setQrImage("");
    try {
      const res = await fetch("/api/auth/qr/create", { method: "POST" });
      if (!res.ok) throw new Error("create failed");
      const data = await res.json();
      tokenRef.current = data.token;
      const dataUrl = await QRCode.toDataURL(data.url, {
        width: 320,
        margin: 1,
        color: { dark: "#0a0a0a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      if (stoppedRef.current) return;
      setQrImage(dataUrl);
      setStatus("pending");
      poll(data.token, data.pollIntervalMs || 2000);
    } catch {
      setStatus("error");
    }
  }, [clearPoll, poll]);

  useEffect(() => {
    stoppedRef.current = false;
    start();
    return () => {
      stoppedRef.current = true;
      clearPoll();
    };
    // start/clearPoll are stable via useCallback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const expired = status === "expired" || status === "error";

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative w-[240px] h-[240px] rounded-2xl bg-white p-3 flex items-center justify-center overflow-hidden">
        {qrImage && !expired ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrImage}
            alt={gt("QR login code")}
            className="w-full h-full rounded-lg"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="w-full h-full rounded-lg bg-[#111111] flex items-center justify-center">
            {expired ? (
              <span className="text-[#888888] text-sm px-4">
                <T>This code expired</T>
              </span>
            ) : (
              <Loader size={24} />
            )}
          </div>
        )}

        {status === "approved" && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center">
            <CheckCircle2 className="w-16 h-16 text-emerald-400" />
          </div>
        )}
        {(status === "scanned" || expired) && qrImage && !expired && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-white">
              <Smartphone className="w-10 h-10 text-[#8B5CF6]" />
              <span className="text-xs font-medium">
                <T>Confirm on your other device</T>
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 max-w-[280px]">
        <h2 className="text-white font-semibold text-base mb-1">
          <T>Log in with QR code</T>
        </h2>
        <p className="text-[#888888] text-sm leading-relaxed">
          {status === "scanned" ? (
            <T>Approve the login on your other device to continue.</T>
          ) : (
            <T>
              Open SerikaCord on a device where you&apos;re already signed in and
              scan this code, or open the link it points to.
            </T>
          )}
        </p>
      </div>

      {expired && (
        <button
          type="button"
          onClick={start}
          className="mt-4 inline-flex items-center gap-2 text-sm text-[#8B5CF6] hover:text-[#A78BFA] transition-colors font-medium"
        >
          <RefreshCw className="w-4 h-4" />
          <T>Generate a new code</T>
        </button>
      )}
    </div>
  );
}
