import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Direct Messages",
  description:
    "Open your SerikaCord direct messages. Chat privately with friends, manage conversations, and stay connected one-to-one or in group DMs.",
  path: "/dm",
  noIndex: true,
  keywords: [
    "SerikaCord DMs",
    "direct messages",
    "private chat",
    "one-to-one messaging",
    "friends",
  ],
});

export default function DMLayout({ children }: { children: React.ReactNode }) {
  // The app shell is mounted once above /channels and /dm (AppShellProviders)
  // so switching between them keeps it; the startup prefetch is in the root
  // layout's <head>. This layout only carries the metadata.
  return children;
}
