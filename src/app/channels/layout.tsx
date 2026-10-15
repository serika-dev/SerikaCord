import { buildMetadata } from "@/lib/seo";
import { BootPrefetch } from "@/components/boot/BootPrefetch";
import ChannelsLayoutClient from "./ChannelsLayoutClient";

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
  return (
    <>
      <BootPrefetch />
      <ChannelsLayoutClient>{children}</ChannelsLayoutClient>
    </>
  );
}
