import { Outfit } from "next/font/google";

/**
 * Serika family heading face (Outfit) for the marketing pages (homepage and
 * /compare/*); the app keeps Inter. Other scripts fall back to Inter / Noto
 * Kufi through --hm-display. One instance, so every page shares the files.
 */
export const homeDisplayFont = Outfit({
  subsets: ["latin", "latin-ext"],
  variable: "--font-hm-display",
  display: "swap",
});
