import { buildMetadata } from "@/lib/seo";
import ApplicationDetailLayoutClient from "./ApplicationDetailLayoutClient";

export const metadata = buildMetadata({
  title: "Application Settings",
  description:
    "Manage your SerikaCord application. Configure bot settings, OAuth2, webhooks, emoji, app directory page, analytics, and team members.",
  path: "/developers/applications",
  noIndex: true,
  keywords: [
    "SerikaCord application",
    "bot settings",
    "OAuth2 config",
    "webhooks",
    "app directory",
    "developer portal",
  ],
});

export default function ApplicationDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ApplicationDetailLayoutClient>{children}</ApplicationDetailLayoutClient>;
}
