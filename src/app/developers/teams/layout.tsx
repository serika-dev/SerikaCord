import { buildMetadata } from "@/lib/seo";

// App-only route: never indexed.
export const metadata = buildMetadata({
  title: "Teams",
  path: "/developers/teams",
  noIndex: true,
});

export default function NoIndexLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
