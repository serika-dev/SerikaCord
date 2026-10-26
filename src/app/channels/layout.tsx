import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "App — SerikaCord",
  description:
    "Open the SerikaCord app. Chat with friends, join servers, explore communities, manage settings, and stay connected in real time.",
  path: "/channels/me",
  // The signed-in app shell is never indexed. Children that are public
  // (Discover, Discovery-listed servers) set their own robots.
  noIndex: true,
  keywords: [
    "SerikaCord app",
    "chat app",
    "messaging",
    "servers",
    "direct messages",
    "community",
  ],
});

export default function ChannelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The app shell is mounted once above /channels and /dm (AppShellProviders)
  // so switching between them keeps it; the startup prefetch is in the root
  // layout's <head>. This layout only carries the metadata.
  return children;
}
