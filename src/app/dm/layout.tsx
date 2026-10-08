import { buildMetadata } from "@/lib/seo";
import { BootPrefetch } from "@/components/boot/BootPrefetch";
import DMLayoutClient from "./DMLayoutClient";

export const metadata = buildMetadata({
  title: "Direct Messages",
  description:
    "Open your SerikaCord direct messages. Chat privately with friends, manage conversations, and stay connected one-to-one or in group DMs.",
  path: "/dm",
  keywords: [
    "SerikaCord DMs",
    "direct messages",
    "private chat",
    "one-to-one messaging",
    "friends",
  ],
});

export default function DMLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BootPrefetch />
      <DMLayoutClient>{children}</DMLayoutClient>
    </>
  );
}
