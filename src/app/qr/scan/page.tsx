"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { Camera, X } from "lucide-react";
import { T, useGT } from "gt-next";
import { useAuth } from "@/contexts/AuthContext";
import { Loader } from "@/components/ui/Loader";

type ScanState = "starting" | "scanning" | "denied" | "unsupported" | "found";

/**
 * Native-camera QR scanner used inside the mobile app (and any browser with a
 * camera). It looks for a SerikaCord /qr/<token> URL and, on a hit, navigates to
 * the approval screen. Must be signed in — the approval page enforces that too.
 */
export default function QRScanPage() {
  const gt = useGT();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const [state, setState] = useState<ScanState>("starting");

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Pull the /qr/<token> path out of whatever the QR encodes.
  const extractToken = (raw: string): string | null => {
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/\/qr\/([^/?#]+)/);
      return m ? m[1] : null;
    } catch {
      const m = raw.match(/\/qr\/([^/?#\s]+)/);
      return m ? m[1] : null;
    }
  };

  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (doneRef.current || !video || !canvas) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, {
          inversionAttempts: "dontInvert",
        });
        if (code?.data) {
          const token = extractToken(code.data);
          if (token) {
            doneRef.current = true;
            setState("found");
            stop();
            router.replace(`/qr/${token}`);
            return;
          }
        }
      }
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [router, stop]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play();
      }
      setState("scanning");
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setState("denied");
    }
  }, [tick]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?redirect=${encodeURIComponent("/qr/scan")}`);
      return;
    }
    doneRef.current = false;
    startCamera();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  return (
    <div className="min-h-dvh bg-black flex flex-col">
      <div className="flex items-center justify-between p-4 text-white">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-[#8B5CF6]" />
          <span className="font-semibold">
            <T>Scan to log in</T>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            stop();
            router.back();
          }}
          className="p-2 rounded-full hover:bg-white/10 transition-colors"
          aria-label={gt("Close")}
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          playsInline
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* Framing reticle */}
        {state === "scanning" && (
          <div className="relative z-10 w-64 h-64 rounded-3xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]" />
        )}

        {(state === "starting" || state === "found") && (
          <div className="relative z-10 flex flex-col items-center gap-4 text-white">
            <Loader size={28} />
            <span className="text-sm">
              {state === "found" ? <T>Code found…</T> : <T>Starting camera…</T>}
            </span>
          </div>
        )}

        {(state === "denied" || state === "unsupported") && (
          <div className="relative z-10 max-w-xs text-center text-white px-6">
            <Camera className="w-12 h-12 mx-auto mb-4 text-[#888888]" />
            <p className="text-sm text-[#b5b5c0] leading-relaxed">
              {state === "denied" ? (
                <T>
                  Camera access was denied. Enable camera permission to scan a
                  login code.
                </T>
              ) : (
                <T>This device doesn&apos;t support camera scanning.</T>
              )}
            </p>
          </div>
        )}
      </div>

      {state === "scanning" && (
        <p className="text-center text-[#888888] text-sm p-6">
          <T>Point your camera at the QR code shown on the other device.</T>
        </p>
      )}
    </div>
  );
}
