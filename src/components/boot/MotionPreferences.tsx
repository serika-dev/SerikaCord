"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { useTheme } from "@/contexts/ThemeContext";

/**
 * framer-motion animates through JS/WAAPI, so the `html.reduce-motion` CSS
 * rule can't stop it. This applies "Reduced motion" / "Enable animations"
 * to every motion component; otherwise it follows the OS setting.
 */
export function MotionPreferences({ children }: { children: ReactNode }) {
  const { settings } = useTheme();
  const reduce = settings.reducedMotion || !settings.enableAnimations;
  return <MotionConfig reducedMotion={reduce ? "always" : "user"}>{children}</MotionConfig>;
}
