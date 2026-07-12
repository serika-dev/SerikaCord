"use client";

import { useEffect, useState, Suspense } from "react";
import { Check } from "lucide-react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";

function CallbackHandler() {
  const gt = useGT();
  const [status, setStatus] = useState(gt("Processing authorization..."));
  const [complete, setComplete] = useState(false);

  useEffect(() => {
    // Parse token/code from URL hash or query params
    const hash = window.location.hash;
    const search = window.location.search;

    const data: Record<string, string> = {};

    if (hash) {
      const hashParams = new URLSearchParams(hash.substring(1));
      hashParams.forEach((val, key) => {
        data[key] = val;
      });
    }

    if (search) {
      const searchParams = new URLSearchParams(search);
      searchParams.forEach((val, key) => {
        data[key] = val;
      });
    }

    // Post to opener window if exists
    if (window.opener) {
      window.opener.postMessage(
        {
          type: "SERIKACORD_AUTH_CALLBACK",
          data,
        },
        "*"
      );
      setStatus(gt("Authorization details sent. Closing window..."));
      setComplete(true);
      // Don't close window for app authorizations (check for no_close param)
      const noClose = data.no_close === "true" || (search && new URLSearchParams(search).get("no_close") === "true");
      if (!noClose) {
        setTimeout(() => {
          window.close();
        }, 1000);
      } else {
        setStatus(gt("Authorized! You can now return to the app."));
      }
    } else {
      setStatus(gt("Authorized successfully! You can close this tab now."));
      setComplete(true);
    }
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#070708] text-white p-4">
      <div className="max-w-md w-full bg-[#0a0a0a]/90 border border-white/[0.08] rounded-2xl p-8 shadow-2xl shadow-black/60 text-center space-y-4">
        {complete ? (
          <div className="w-12 h-12 bg-green-500/10 border border-green-500/30 rounded-full flex items-center justify-center mx-auto">
            <Check className="w-6 h-6 text-green-400" />
          </div>
        ) : (
          <Loader size={40} className="mx-auto" />
        )}
        <h2 className="text-xl font-bold">{gt("OAuth2 Callback")}</h2>
        <p className="text-[#888888] text-sm font-medium">{status}</p>
      </div>
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#070708] text-white">
        <Loader size={40} />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
