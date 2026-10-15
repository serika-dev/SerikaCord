import { buildMetadata } from "@/lib/seo";

// App-only route (device linking): never indexed.
export const metadata = buildMetadata({
  title: "Link a device",
  path: "/e2ee/link",
  noIndex: true,
});

export default function E2eeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
