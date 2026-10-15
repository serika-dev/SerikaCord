"use client";

import { useEffect, type AnimationEvent, type CSSProperties } from "react";
import { useGT } from "gt-next";
import { Loader } from "@/components/ui/Loader";
import { callNative } from "@/lib/native/bridge";
import { cn } from "@/lib/utils";
import "./AppSplash.css";

/**
 * The SerikaCord wordmark: public/logo.svg inlined unchanged (own ids), so it
 * paints with the splash instead of waiting for an image request.
 */
function Wordmark() {
  return (
    <svg className="app-splash__word" xmlns="http://www.w3.org/2000/svg" width="400" height="60" viewBox="0 0 400 60" aria-hidden="true">
      <defs>
        <linearGradient id="splashCordGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <filter id="splashTextGlow" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <text
        x="200"
        y="45"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="48"
        fontWeight="800"
        letterSpacing="-1"
        filter="url(#splashTextGlow)"
      >
        <tspan fill="#ffffff">Serika</tspan>
        <tspan fill="url(#splashCordGradient)">Cord</tspan>
      </text>
    </svg>
  );
}

function tip(i: number): CSSProperties {
  return { "--i": i } as CSSProperties;
}

/**
 * Branded boot screen shown while the session loads. It is server-rendered
 * and styled from AppSplash.css, so it appears instantly with the right theme
 * and never waits on JS. When `exiting` turns on, the app is already mounted
 * underneath: the splash fades out over it and then calls `onExited`.
 */
export function AppSplash({ exiting = false, onExited }: { exiting?: boolean; onExited?: () => void }) {
  const gt = useGT();

  // Android app: hide the native launch screen once this one is up (the
  // inline NativeSplashHide script usually did it already, before React).
  useEffect(() => {
    void callNative("SplashScreen", "hide", { fadeOutDuration: 150 });
  }, []);

  const handleAnimationEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (exiting && e.target === e.currentTarget && e.animationName === "app-splash-out") onExited?.();
  };

  const encryptedTip = gt("New DMs are end-to-end encrypted, so only the people in them can read them.");
  const pointerTips = [
    gt("Press Ctrl+K (⌘K on a Mac) to jump to any server, channel or DM."),
    gt("Press Ctrl+/ to see every keyboard shortcut."),
    gt("Hold Shift while hovering a message for quick actions."),
    gt("Shift-click Reply to reply without pinging."),
    encryptedTip,
  ];
  const touchTips = [
    gt("Swipe a message to the left to reply."),
    gt("Press and hold a message for reactions and more."),
    gt("Swipe right in a chat to go back to your channels."),
    gt("Tap someone's name to see their profile."),
    encryptedTip,
  ];

  return (
    <div
      className={cn("app-splash", exiting && "app-splash--exit")}
      role="status"
      aria-busy={!exiting}
      onAnimationEnd={handleAnimationEnd}
    >
      <span className="sr-only">{gt("Loading SerikaCord...")}</span>

      <div className="app-splash__center" aria-hidden="true">
        <div className="app-splash__mark">
          <span className="app-splash__halo" />
          <div className="app-splash__foil">
            <Loader size={88} />
          </div>
        </div>
        <Wordmark />
        <div className="app-splash__bar">
          <span />
        </div>
      </div>

      <div aria-hidden="true">
        {[
          { key: "fine", tips: pointerTips },
          { key: "touch", tips: touchTips },
        ].map((set) => (
          <ul key={set.key} className={`app-splash__tips app-splash__tips--${set.key}`}>
            {set.tips.map((t, i) => (
              <li key={i} style={tip(i)}>
                <span className="app-splash__tips-label">{gt("Did you know?")}</span>
                {t}
              </li>
            ))}
          </ul>
        ))}
      </div>

      <p className="app-splash__slow">
        {gt("Taking longer than usual?")}{" "}
        <a href="https://status.serika.dev" target="_blank" rel="noopener noreferrer">
          {gt("Check the service status")}
        </a>
      </p>
    </div>
  );
}
