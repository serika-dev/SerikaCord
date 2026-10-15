import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "Server Widget",
  description:
    "View a SerikaCord server widget with live member count, online users, channels, and recent messages. Discover communities before joining.",
  path: "/widget",
  noIndex: true,
  keywords: [
    "SerikaCord widget",
    "server widget",
    "live server preview",
    "online members",
    "server stats",
  ],
});

export default function WidgetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
